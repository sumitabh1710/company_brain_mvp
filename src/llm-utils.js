export function stripCodeFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

export function parseJsonResponse(text) {
  return JSON.parse(stripCodeFence(text));
}

export async function generateJson(ai, model, prompt) {
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
  });
  return parseJsonResponse(response.text);
}
