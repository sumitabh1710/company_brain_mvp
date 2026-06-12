import { buildMatchingPrompt } from "./prompts.js";

function tokenize(text) {
  return new Set(String(text || "").split(/\s+/).filter(Boolean));
}

function jaccardSimilarity(a, b) {
  const left = tokenize(a);
  const right = tokenize(b);

  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

function titleSimilarity(oldItem, newItem) {
  return jaccardSimilarity(oldItem.title, newItem.title);
}

function contentSimilarity(oldItem, newItem) {
  return jaccardSimilarity(oldItem.content, newItem.content);
}

function buildCandidateList(oldItem, newItems, matchedNewIndexes) {
  const candidates = [];

  newItems.forEach((candidate, idx) => {
    if (matchedNewIndexes.has(idx)) return;
    if (candidate.type !== oldItem.type) return;

    const tSim = titleSimilarity(oldItem, candidate);
    const cSim = contentSimilarity(oldItem, candidate);
    const titleExact = oldItem.title === candidate.title;

    if (titleExact || tSim >= 0.3) {
      candidates.push({
        idx,
        item: candidate,
        score: titleExact ? 2 + cSim : tSim + cSim,
      });
    }
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function extractJsonObject(text) {
  const cleaned = String(text || "").trim();
  const fenced = cleaned.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  return JSON.parse(fenced);
}

async function askSemanticMatch(ai, model, oldItem, newItem) {
  const prompt = buildMatchingPrompt(oldItem, newItem);
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
  });
  const parsed = extractJsonObject(response.text);
  return {
    same_item: Boolean(parsed.same_item),
    reason: String(parsed.reason || "").trim(),
  };
}

export async function diffKnowledge(oldItems, newItems, ai, model) {
  const added = [];
  const removed = [];
  const modified = [];

  const oldById = new Map(oldItems.map((item, idx) => [item.id, { item, idx }]));
  const newById = new Map(newItems.map((item, idx) => [item.id, { item, idx }]));

  const matchedOldIndexes = new Set();
  const matchedNewIndexes = new Set();

  for (const [id, oldEntry] of oldById) {
    const newEntry = newById.get(id);
    if (!newEntry) continue;
    matchedOldIndexes.add(oldEntry.idx);
    matchedNewIndexes.add(newEntry.idx);
  }

  for (let oldIdx = 0; oldIdx < oldItems.length; oldIdx += 1) {
    if (matchedOldIndexes.has(oldIdx)) continue;
    const oldItem = oldItems[oldIdx];
    const candidates = buildCandidateList(oldItem, newItems, matchedNewIndexes);

    let chosen = null;
    let chosenReason = "";
    for (const candidate of candidates) {
      const result = await askSemanticMatch(ai, model, oldItem, candidate.item);
      if (result.same_item) {
        chosen = candidate;
        chosenReason = result.reason;
        break;
      }
    }

    if (!chosen) continue;

    matchedOldIndexes.add(oldIdx);
    matchedNewIndexes.add(chosen.idx);

    const newItem = chosen.item;
    if (oldItem.content !== newItem.content) {
      modified.push({
        title: newItem.title || oldItem.title,
        type: newItem.type || oldItem.type,
        old_content: oldItem.content,
        new_content: newItem.content,
        change_reason: chosenReason || "semantic content changed",
      });
    }
  }

  oldItems.forEach((item, idx) => {
    if (!matchedOldIndexes.has(idx)) {
      removed.push(item);
    }
  });

  newItems.forEach((item, idx) => {
    if (!matchedNewIndexes.has(idx)) {
      added.push(item);
    }
  });

  return { added, removed, modified };
}
