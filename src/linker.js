import { buildLinkingPrompt } from "./prompts.js";
import { generateJson } from "./llm-utils.js";

const ALLOWED_RELATIONSHIPS = new Set([
  "depends_on",
  "inherits_from",
  "references",
  "owned_by",
  "blocks",
]);

function tokenize(text) {
  return new Set(String(text || "").split(/\s+/).filter(Boolean));
}

function overlapScore(a, b) {
  const left = tokenize(`${a.canonical_name} ${a.description}`);
  const right = tokenize(`${b.canonical_name} ${b.description}`);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / Math.min(left.size, right.size);
}

function candidatePairs(entities) {
  const pairs = [];
  for (let i = 0; i < entities.length; i += 1) {
    for (let j = i + 1; j < entities.length; j += 1) {
      const score = overlapScore(entities[i], entities[j]);
      if (score >= 0.15 || entities[i].type === entities[j].type) {
        pairs.push({ a: entities[i], b: entities[j], score });
      }
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  return pairs.slice(0, 250);
}

function buildHeuristicRelationship(a, b) {
  const textA = `${a.canonical_name} ${a.description}`;
  const textB = `${b.canonical_name} ${b.description}`;
  if (/depends on|requires|needs/i.test(textA) && new RegExp(b.canonical_name, "i").test(textA)) {
    return { linked: true, relationship_type: "depends_on", source_entity: "A", target_entity: "B" };
  }
  if (/depends on|requires|needs/i.test(textB) && new RegExp(a.canonical_name, "i").test(textB)) {
    return { linked: true, relationship_type: "depends_on", source_entity: "B", target_entity: "A" };
  }
  if (a.type === "ownership" && b.type !== "ownership") {
    return { linked: true, relationship_type: "owned_by", source_entity: "B", target_entity: "A" };
  }
  if (b.type === "ownership" && a.type !== "ownership") {
    return { linked: true, relationship_type: "owned_by", source_entity: "A", target_entity: "B" };
  }
  if (a.type === b.type && overlapScore(a, b) >= 0.25) {
    return { linked: true, relationship_type: "references", source_entity: "A", target_entity: "B" };
  }
  return { linked: false };
}

async function resolveLink(ai, model, a, b) {
  if (!ai) return null;
  try {
    const prompt = buildLinkingPrompt(a, b);
    const parsed = await generateJson(ai, model, prompt);
    if (!parsed?.linked) return { linked: false };
    if (!ALLOWED_RELATIONSHIPS.has(parsed.relationship_type)) return { linked: false };
    return {
      linked: true,
      relationship_type: parsed.relationship_type,
      confidence: Number(parsed.confidence || 0),
      source_entity: parsed.source_entity === "B" ? "B" : "A",
      target_entity: parsed.target_entity === "B" ? "B" : "A",
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.slice(0, 3) : [],
      reason: String(parsed.reason || ""),
    };
  } catch {
    return null;
  }
}

export async function linkEntities(entities, ai, model) {
  const edges = [];
  const seen = new Set();
  const pairs = candidatePairs(entities);

  for (const pair of pairs) {
    let decision = buildHeuristicRelationship(pair.a, pair.b);
    if (!decision.linked) {
      const llmDecision = await resolveLink(ai, model, pair.a, pair.b);
      if (llmDecision) decision = llmDecision;
    }
    if (!decision.linked) continue;

    const source = decision.source_entity === "B" ? pair.b : pair.a;
    const target = decision.target_entity === "B" ? pair.b : pair.a;
    if (source.entity_id === target.entity_id) continue;

    const dedupeKey = `${source.entity_id}|${decision.relationship_type}|${target.entity_id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    edges.push({
      source_entity_id: source.entity_id,
      target_entity_id: target.entity_id,
      relationship_type: decision.relationship_type,
      confidence: Number(decision.confidence ?? 0.72),
      evidence:
        decision.evidence && decision.evidence.length
          ? decision.evidence
          : [`${source.canonical_name} ${decision.relationship_type} ${target.canonical_name}`],
      document_ids: Array.from(new Set([...source.source_documents, ...target.source_documents])),
      model_version: model,
    });
  }

  return { relationships: edges };
}
