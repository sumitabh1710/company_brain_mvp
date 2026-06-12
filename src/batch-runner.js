import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, extname, basename } from "node:path";
import { GoogleGenAI } from "@google/genai";
import { ALLOWED_TYPES, buildExtractionPrompt } from "./prompts.js";
import { normalizeItem } from "./normalize.js";
import { parseJsonResponse } from "./llm-utils.js";
import { canonicalizeKnowledgeItems } from "./canonicalize.js";
import { linkEntities } from "./linker.js";
import { generateImpactReport } from "./impact.js";

const CONFIG = {
  GOOGLE_AI_API_KEY: "AIzaSyAf-vA7icut_Op6wHZhPwiOdPf8stIYvhY",
  GEMINI_MODEL: "gemini-2.5-pro",
  ENABLE_FALLBACK_EXTRACTION: false,
};

const OUTPUT_FILES = {
  batchKnowledge: resolve(process.cwd(), "batch_knowledge.json"),
  entities: resolve(process.cwd(), "entities.json"),
  itemEntityMap: resolve(process.cwd(), "item_entity_map.json"),
  relationships: resolve(process.cwd(), "relationships.json"),
  impact: resolve(process.cwd(), "impact_report.json"),
  knowledge: resolve(process.cwd(), "knowledge.json"),
};

function usageAndExit() {
  console.error("Usage: node src/batch-runner.js <path-to-docs-folder>");
  process.exit(1);
}

function validateItem(item) {
  const required = ["type", "title", "content", "confidence"];
  for (const key of required) {
    if (!(key in item)) return `missing field: ${key}`;
  }
  const type = String(item.type || "").toLowerCase().trim();
  if (!ALLOWED_TYPES.includes(type)) return `invalid type: ${item.type}`;
  const confidence = Number(item.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return `invalid confidence: ${item.confidence}`;
  }
  return null;
}

function parseSectionType(sectionHeading) {
  const lower = sectionHeading.toLowerCase();
  if (lower.includes("process")) return "process";
  if (lower.includes("decision")) return "decision";
  if (lower.includes("risk")) return "risk";
  if (lower.includes("owner")) return "ownership";
  if (lower.includes("definition")) return "definition";
  if (lower.includes("depend")) return "dependency";
  if (lower.includes("architecture")) return "architecture";
  if (lower.includes("action")) return "action_item";
  return null;
}

function fallbackExtract(documentText) {
  const lines = documentText.split("\n");
  let currentType = null;
  const items = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("##")) {
      const heading = line.replace(/^##+\s*/, "");
      currentType = parseSectionType(heading);
      continue;
    }
    if ((line.startsWith("- ") || line.match(/^\d+\./)) && currentType) {
      const content = line.replace(/^- /, "").replace(/^\d+\.\s*/, "").trim();
      if (content.length < 12) continue;
      const title = content.split(".")[0].slice(0, 80);
      items.push({
        type: currentType,
        title,
        content,
        confidence: 0.72,
      });
    }
  }

  return items;
}

async function callExtraction(ai, model, documentText, retries = 2) {
  if (!ai) return fallbackExtract(documentText);
  let lastError;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const prompt = buildExtractionPrompt(documentText);
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });
      const parsed = parseJsonResponse(response.text);
      if (!Array.isArray(parsed)) throw new Error("Extraction response is not an array");
      return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  if (CONFIG.ENABLE_FALLBACK_EXTRACTION) {
    return fallbackExtract(documentText);
  }
  throw lastError;
}

async function discoverDocs(folderPath) {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && [".md", ".txt"].includes(extname(entry.name).toLowerCase()))
    .map((entry) => resolve(folderPath, entry.name))
    .sort();
  return files;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function nowMs() {
  return Date.now();
}

function logStageStart(name) {
  const start = nowMs();
  console.log(`\n[stage:start] ${name}`);
  return start;
}

function logStageEnd(name, startMs, extra = "") {
  const durationMs = nowMs() - startMs;
  const suffix = extra ? ` | ${extra}` : "";
  console.log(`[stage:done] ${name} | ${durationMs}ms${suffix}`);
}

async function main() {
  const runStart = nowMs();
  const docsFolderArg = process.argv[2];
  if (!docsFolderArg) usageAndExit();
  const docsFolder = resolve(process.cwd(), docsFolderArg);

  const discoverStart = logStageStart("discover_docs");
  const files = await discoverDocs(docsFolder);
  if (files.length === 0) {
    throw new Error(`No .md or .txt files found in ${docsFolderArg}`);
  }
  logStageEnd("discover_docs", discoverStart, `files=${files.length}`);

  const authStart = logStageStart("resolve_api_key");
  const resolvedApiKey =
    process.env.GOOGLE_AI_API_KEY && process.env.GOOGLE_AI_API_KEY.trim()
      ? process.env.GOOGLE_AI_API_KEY.trim()
      : CONFIG.GOOGLE_AI_API_KEY;

  if (!resolvedApiKey || resolvedApiKey.includes("PASTE_YOUR")) {
    throw new Error(
      "Batch runner requires a real Gemini API key. Set CONFIG.GOOGLE_AI_API_KEY in src/batch-runner.js or export GOOGLE_AI_API_KEY.",
    );
  }
  logStageEnd("resolve_api_key", authStart, "api_key=configured");

  const aiInitStart = logStageStart("init_gemini_client");
  const ai = new GoogleGenAI({ apiKey: resolvedApiKey });
  logStageEnd("init_gemini_client", aiInitStart, `model=${CONFIG.GEMINI_MODEL}`);

  const allItems = [];
  const perDocSummary = [];

  const extractionStart = logStageStart("extract_documents");
  for (let idx = 0; idx < files.length; idx += 1) {
    const absolutePath = files[idx];
    const relativeName = basename(absolutePath);
    const documentText = await readFile(absolutePath, "utf8");

    const extracted = await callExtraction(ai, CONFIG.GEMINI_MODEL, documentText, 2);
    const validItems = [];
    const warnings = [];

    for (const raw of extracted) {
      const validationError = validateItem(raw);
      if (validationError) {
        warnings.push({ raw, error: validationError });
        continue;
      }
      const normalized = normalizeItem(raw);
      normalized.document_id = relativeName;
      normalized.document_version = 1;
      validItems.push(normalized);
      allItems.push(normalized);
    }

    perDocSummary.push({
      document_id: relativeName,
      extracted_count: extracted.length,
      valid_count: validItems.length,
      warnings: warnings.length,
    });

    console.log(
      `[${idx + 1}/${files.length}] ${relativeName}: extracted=${extracted.length}, valid=${validItems.length}, warnings=${warnings.length}`,
    );
  }
  logStageEnd(
    "extract_documents",
    extractionStart,
    `docs=${files.length}, items=${allItems.length}`,
  );

  const writeExtractionStart = logStageStart("write_extraction_artifacts");
  const batchPayload = {
    generated_at: new Date().toISOString(),
    model_version: CONFIG.GEMINI_MODEL,
    total_documents: files.length,
    total_items: allItems.length,
    documents: perDocSummary,
    items: allItems,
  };
  await writeJson(OUTPUT_FILES.batchKnowledge, batchPayload);
  await writeJson(OUTPUT_FILES.knowledge, {
    source: docsFolderArg,
    updated_at: batchPayload.generated_at,
    items: allItems,
  });
  logStageEnd("write_extraction_artifacts", writeExtractionStart);

  const canonicalizeStart = logStageStart("canonicalize_items");
  const { entities, item_entity_map, metrics } = await canonicalizeKnowledgeItems(
    allItems,
    ai,
    CONFIG.GEMINI_MODEL,
  );
  logStageEnd(
    "canonicalize_items",
    canonicalizeStart,
    `entities=${entities.length}, compression=${metrics.compression_ratio}`,
  );

  const writeCanonicalStart = logStageStart("write_canonical_artifacts");
  await writeJson(OUTPUT_FILES.entities, {
    generated_at: new Date().toISOString(),
    model_version: CONFIG.GEMINI_MODEL,
    metrics,
    entities,
  });

  await writeJson(OUTPUT_FILES.itemEntityMap, {
    generated_at: new Date().toISOString(),
    item_entity_map,
  });
  logStageEnd("write_canonical_artifacts", writeCanonicalStart);

  const linkingStart = logStageStart("link_entities");
  const linkResult = await linkEntities(entities, ai, CONFIG.GEMINI_MODEL);
  logStageEnd("link_entities", linkingStart, `relationships=${linkResult.relationships.length}`);

  const writeLinksStart = logStageStart("write_relationships_artifact");
  await writeJson(OUTPUT_FILES.relationships, {
    generated_at: new Date().toISOString(),
    model_version: CONFIG.GEMINI_MODEL,
    total_relationships: linkResult.relationships.length,
    relationships: linkResult.relationships,
  });
  logStageEnd("write_relationships_artifact", writeLinksStart);

  const impactStart = logStageStart("generate_impact_report");
  const impactReport = generateImpactReport(entities, linkResult.relationships);
  logStageEnd(
    "generate_impact_report",
    impactStart,
    `scenarios=${impactReport.summary?.scenarios_generated ?? 0}`,
  );

  const writeImpactStart = logStageStart("write_impact_artifact");
  await writeJson(OUTPUT_FILES.impact, impactReport);
  logStageEnd("write_impact_artifact", writeImpactStart);

  const totalDuration = nowMs() - runStart;

  console.log("\n[summary]");
  console.log(`Batch docs processed: ${files.length}`);
  console.log(`Knowledge items extracted: ${allItems.length}`);
  console.log(`Canonical entities created: ${entities.length}`);
  console.log(`Relationships created: ${linkResult.relationships.length}`);
  console.log(`Total run time: ${totalDuration}ms`);
  console.log("Artifacts written: batch_knowledge.json, entities.json, item_entity_map.json, relationships.json, impact_report.json");
}

main().catch((error) => {
  console.error("MVP-2 run failed:");
  console.error(error?.stack || error);
  process.exit(1);
});
