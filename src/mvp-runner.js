import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { GoogleGenAI } from "@google/genai";
import { ALLOWED_TYPES, buildExtractionPrompt } from "./prompts.js";
import { normalizeItem } from "./normalize.js";
import { diffKnowledge } from "./diff.js";

const CONFIG = {
  GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY?.trim() || "",
  GEMINI_MODEL: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-pro",
};

const KNOWLEDGE_FILE = resolve(process.cwd(), "knowledge.json");

function usageAndExit() {
  console.error("Usage: node src/mvp-runner.js <path-to-document>");
  process.exit(1);
}

function stripCodeFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function parseJsonWithRetries(text) {
  const cleaned = stripCodeFence(text);
  return JSON.parse(cleaned);
}

function validateItem(item) {
  const requiredFields = ["type", "title", "content", "confidence"];
  for (const field of requiredFields) {
    if (!(field in item)) return `missing field: ${field}`;
  }

  if (!ALLOWED_TYPES.includes(String(item.type).toLowerCase().trim())) {
    return `invalid type: ${item.type}`;
  }

  const confidence = Number(item.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return `invalid confidence: ${item.confidence}`;
  }

  return null;
}

async function callExtraction(ai, model, documentText, retries = 2) {
  let lastError;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const prompt = buildExtractionPrompt(documentText);
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });
      const parsed = parseJsonWithRetries(response.text);
      if (!Array.isArray(parsed)) {
        throw new Error("Extraction response is not a JSON array.");
      }
      return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function loadPreviousKnowledge() {
  if (!existsSync(KNOWLEDGE_FILE)) return null;
  const raw = await readFile(KNOWLEDGE_FILE, "utf8");
  return JSON.parse(raw);
}

async function saveKnowledge(sourcePath, items) {
  const payload = {
    source: sourcePath,
    updated_at: new Date().toISOString(),
    items,
  };
  await writeFile(KNOWLEDGE_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  if (!CONFIG.GOOGLE_AI_API_KEY) {
    throw new Error("Set GOOGLE_AI_API_KEY in .env before running.");
  }

  const inputPath = process.argv[2];
  if (!inputPath) usageAndExit();

  const absoluteInputPath = resolve(process.cwd(), inputPath);
  const documentText = await readFile(absoluteInputPath, "utf8");

  const ai = new GoogleGenAI({ apiKey: CONFIG.GOOGLE_AI_API_KEY });

  const extracted = await callExtraction(ai, CONFIG.GEMINI_MODEL, documentText, 2);

  const validItems = [];
  const validationWarnings = [];
  for (const item of extracted) {
    const error = validateItem(item);
    if (error) {
      validationWarnings.push({ item, error });
      continue;
    }
    validItems.push(normalizeItem(item));
  }

  if (validationWarnings.length > 0) {
    console.log(`Validation warnings: ${validationWarnings.length}`);
    console.log(JSON.stringify(validationWarnings, null, 2));
  }

  console.log(`Extracted valid knowledge items: ${validItems.length}`);
  console.log(JSON.stringify(validItems, null, 2));

  const previous = await loadPreviousKnowledge();
  if (!previous) {
    await saveKnowledge(inputPath, validItems);
    console.log("No previous knowledge.json found. Baseline created.");
    return;
  }

  const oldItems = Array.isArray(previous.items) ? previous.items : [];
  const diff = await diffKnowledge(oldItems, validItems, ai, CONFIG.GEMINI_MODEL);

  console.log(`Loaded previous items: ${oldItems.length}`);
  console.log(`Current items: ${validItems.length}`);
  console.log(
    `Diff => added: ${diff.added.length}, removed: ${diff.removed.length}, modified: ${diff.modified.length}`,
  );
  console.log(JSON.stringify(diff, null, 2));

  await saveKnowledge(inputPath, validItems);
  console.log("knowledge.json updated.");
}

main().catch((error) => {
  console.error("MVP run failed:");
  console.error(error?.stack || error);
  process.exit(1);
});
