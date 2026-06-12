export const ALLOWED_TYPES = [
  "process",
  "decision",
  "risk",
  "ownership",
  "definition",
  "dependency",
  "architecture",
  "action_item",
];

export function buildExtractionPrompt(documentText) {
  return `You are an expert Organizational Knowledge Extraction Engine.

Your task is to identify durable knowledge contained inside company documents.

Durable knowledge means information that remains useful after the document has been closed.

Extract ONLY the following categories:
1. process (workflows, operational procedures, repeatable steps)
2. decision (approval rules, business logic, architectural decisions, operational decision logic)
3. risk (known risks, limitations, failure modes, operational concerns)
4. ownership (responsible teams, systems, or individuals)
5. definition (business or technical definitions)
6. dependency (system dependencies, external dependencies, required integrations)
7. architecture (communication flows, system designs, infrastructure patterns)
8. action_item (future improvements, planned work, unresolved work)

Ignore:
- temporary status updates
- metrics
- logs
- timestamps
- implementation details with no long-term value
- formatting

Return ONLY valid JSON.
Do not explain reasoning.
Do not summarize.

Schema:
[
  {
    "type": "",
    "title": "",
    "content": "",
    "confidence": 0.0
  }
]

Rules:
- "type" must be one of: ${ALLOWED_TYPES.join(", ")}
- "confidence" must be a number from 0 to 1
- If no meaningful knowledge exists, return []

Document:
${documentText}`;
}

export function buildMatchingPrompt(oldItem, newItem) {
  return `You are a Knowledge Matching Engine.

Your task is to determine whether two knowledge items represent the same underlying knowledge.

Two items should be considered the same if:
- the intent is the same
- the meaning is the same
- the topic is the same

Even if wording differs.

Return JSON only:
{
  "same_item": true|false,
  "reason": ""
}

Old item:
${JSON.stringify(oldItem, null, 2)}

New item:
${JSON.stringify(newItem, null, 2)}`;
}

export function buildCanonicalizationPrompt(item, candidateEntities) {
  return `You are an Entity Resolution Engine.

Goal:
Decide whether a new knowledge item maps to an existing canonical entity.

Rules:
- Prefer semantic meaning over exact wording.
- Match only if business concept is the same.
- If no confident match exists, create a new entity.
- Return JSON only.

New knowledge item:
${JSON.stringify(item, null, 2)}

Candidate entities:
${JSON.stringify(candidateEntities, null, 2)}

Return exactly:
{
  "match": true|false,
  "entity_id": "",
  "canonical_name": "",
  "confidence": 0.0,
  "reason": ""
}`;
}

export function buildLinkingPrompt(entityA, entityB) {
  return `You are a Knowledge Relationship Discovery Engine.

Task:
Determine whether two canonical entities have a meaningful relationship.

Allowed relationship_type values:
- depends_on
- inherits_from
- references
- owned_by
- blocks

Rules:
- If there is no meaningful relation, return linked=false.
- Confidence must be between 0 and 1.
- Return JSON only.

Entity A:
${JSON.stringify(entityA, null, 2)}

Entity B:
${JSON.stringify(entityB, null, 2)}

Return exactly:
{
  "linked": true|false,
  "relationship_type": "depends_on|inherits_from|references|owned_by|blocks",
  "confidence": 0.0,
  "source_entity": "A|B",
  "target_entity": "A|B",
  "evidence": [""],
  "reason": ""
}`;
}
