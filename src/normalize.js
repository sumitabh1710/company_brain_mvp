import { createHash } from "node:crypto";

function normalizeCurrency(text) {
  return text
    .replace(/\$/g, " usd ")
    .replace(/₹/g, " inr ")
    .replace(/\bdollars?\b/gi, "usd")
    .replace(/\brupees?\b/gi, "inr");
}

function removeThousandsSeparators(text) {
  return text.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (match) => match.replace(/,/g, ""));
}

export function normalizeText(input) {
  let text = String(input ?? "");
  text = text.toLowerCase();
  text = normalizeCurrency(text);
  text = removeThousandsSeparators(text);
  text = text.replace(/[ \t]+([,.;:!?])/g, "$1");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

export function buildItemId(item) {
  const payload = `${item.type}|${item.title}|${item.content}`;
  return createHash("sha1").update(payload).digest("hex");
}

export function normalizeItem(rawItem) {
  const normalized = {
    type: normalizeText(rawItem.type),
    title: normalizeText(rawItem.title),
    content: normalizeText(rawItem.content),
    confidence: Number(rawItem.confidence),
  };

  normalized.id = buildItemId(normalized);
  return normalized;
}
