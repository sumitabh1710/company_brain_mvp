import { createHash } from "node:crypto";
import { buildCanonicalizationPrompt } from "./prompts.js";
import { generateJson } from "./llm-utils.js";

function tokenize(text) {
  return new Set(String(text || "").split(/\s+/).filter(Boolean));
}

function conceptKey(text) {
  const stopwords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "and",
    "for",
    "to",
    "of",
    "with",
    "in",
    "on",
    "by",
    "from",
    "before",
    "after",
    "must",
    "should",
    "can",
    "add",
  ]);
  return String(text || "")
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/gi, "").toLowerCase())
    .filter((token) => token && !stopwords.has(token))
    .slice(0, 4)
    .join("_");
}

function jaccard(a, b) {
  const left = tokenize(a);
  const right = tokenize(b);
  if (!left.size && !right.size) return 1;
  if (!left.size || !right.size) return 0;

  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / new Set([...left, ...right]).size;
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function buildEntityId(name, type) {
  const base = `${type}|${name}`;
  const digest = createHash("sha1").update(base).digest("hex").slice(0, 8);
  return `${slugify(name) || "entity"}_${digest}`;
}

function ensureEntityFromItem(item) {
  const canonicalName = item.title;
  return {
    entity_id: buildEntityId(canonicalName, item.type),
    canonical_name: canonicalName,
    type: item.type,
    aliases: [item.title],
    supporting_item_ids: [item.id],
    source_documents: [item.document_id],
    description: item.content,
    concept_key: conceptKey(item.title),
    last_seen_at: new Date().toISOString(),
  };
}

function addItemToEntity(entity, item) {
  if (!entity.aliases.includes(item.title)) entity.aliases.push(item.title);
  if (!entity.supporting_item_ids.includes(item.id)) entity.supporting_item_ids.push(item.id);
  if (!entity.source_documents.includes(item.document_id)) entity.source_documents.push(item.document_id);
  entity.last_seen_at = new Date().toISOString();
}

function rankCandidates(item, entities) {
  const ranked = [];
  const itemConceptKey = conceptKey(item.title);
  for (const entity of entities) {
    if (entity.type !== item.type) continue;
    const nameScore = jaccard(item.title, entity.canonical_name);
    const aliasScore = Math.max(
      0,
      ...entity.aliases.map((alias) => jaccard(item.title, alias)),
    );
    const descScore = jaccard(item.content, entity.description);
    const conceptBoost =
      itemConceptKey && entity.concept_key && itemConceptKey === entity.concept_key ? 0.35 : 0;
    const score = Math.max(nameScore, aliasScore) * 0.65 + descScore * 0.25 + conceptBoost;
    if (score > 0.2) {
      ranked.push({
        entity,
        score,
      });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

async function resolveWithLlm(ai, model, item, candidateEntities) {
  if (!ai || !candidateEntities.length) return null;
  try {
    const payload = candidateEntities.map((entry) => ({
      entity_id: entry.entity.entity_id,
      canonical_name: entry.entity.canonical_name,
      type: entry.entity.type,
      aliases: entry.entity.aliases,
      description: entry.entity.description,
      score_hint: Number(entry.score.toFixed(3)),
    }));
    const prompt = buildCanonicalizationPrompt(item, payload);
    const result = await generateJson(ai, model, prompt);
    if (result && result.match && result.entity_id) {
      return {
        match: true,
        entity_id: String(result.entity_id),
        confidence: Number(result.confidence || 0),
      };
    }
    return { match: false };
  } catch {
    return null;
  }
}

export async function canonicalizeKnowledgeItems(items, ai, model) {
  const entities = [];
  const item_entity_map = [];
  const entityById = new Map();

  for (const item of items) {
    const candidates = rankCandidates(item, entities);
    const strong = candidates.find((c) => c.score >= 0.62);
    if (strong) {
      addItemToEntity(strong.entity, item);
      item_entity_map.push({ item_id: item.id, entity_id: strong.entity.entity_id });
      continue;
    }

    let resolved = null;
    const softCandidates = candidates.slice(0, 5);
    if (softCandidates.length > 0) {
      resolved = await resolveWithLlm(ai, model, item, softCandidates);
    }

    if (resolved?.match) {
      const matchedEntity = entityById.get(resolved.entity_id);
      if (matchedEntity) {
        addItemToEntity(matchedEntity, item);
        item_entity_map.push({ item_id: item.id, entity_id: matchedEntity.entity_id });
        continue;
      }
    }

    const newEntity = ensureEntityFromItem(item);
    entities.push(newEntity);
    entityById.set(newEntity.entity_id, newEntity);
    item_entity_map.push({ item_id: item.id, entity_id: newEntity.entity_id });
  }

  return {
    entities: entities.map((entity) => {
      const { concept_key, ...rest } = entity;
      return rest;
    }),
    item_entity_map,
    metrics: {
      total_items: items.length,
      total_entities: entities.length,
      compression_ratio: items.length ? Number((items.length / entities.length).toFixed(2)) : 0,
    },
  };
}
