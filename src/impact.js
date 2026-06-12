function buildGraph(relationships) {
  const outgoing = new Map();
  const incoming = new Map();

  for (const edge of relationships) {
    if (!outgoing.has(edge.source_entity_id)) outgoing.set(edge.source_entity_id, []);
    if (!incoming.has(edge.target_entity_id)) incoming.set(edge.target_entity_id, []);
    outgoing.get(edge.source_entity_id).push(edge);
    incoming.get(edge.target_entity_id).push(edge);
  }

  return { outgoing, incoming };
}

function getEntityByIdMap(entities) {
  return new Map(entities.map((entity) => [entity.entity_id, entity]));
}

function pickSeedEntities(entities, relationships) {
  const degree = new Map(entities.map((entity) => [entity.entity_id, 0]));
  for (const edge of relationships) {
    degree.set(edge.source_entity_id, (degree.get(edge.source_entity_id) || 0) + 1);
    degree.set(edge.target_entity_id, (degree.get(edge.target_entity_id) || 0) + 1);
  }
  return entities
    .map((entity) => ({ entity, degree: degree.get(entity.entity_id) || 0 }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 5)
    .map((entry) => entry.entity);
}

function collectImpactForSeed(seedEntityId, graph, entityById) {
  const impacted = [];
  const queue = [{ id: seedEntityId, depth: 0 }];
  const visited = new Set([seedEntityId]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current.depth >= 2) continue;

    const incoming = graph.incoming.get(current.id) || [];
    for (const edge of incoming) {
      const affectedId = edge.source_entity_id;
      if (visited.has(affectedId)) continue;
      visited.add(affectedId);
      queue.push({ id: affectedId, depth: current.depth + 1 });
      impacted.push({
        entity_id: affectedId,
        canonical_name: entityById.get(affectedId)?.canonical_name || affectedId,
        via_relationship: edge.relationship_type,
        confidence: edge.confidence,
        evidence: edge.evidence,
        hop: current.depth + 1,
      });
    }
  }

  return impacted;
}

export function generateImpactReport(entities, relationships) {
  const graph = buildGraph(relationships);
  const entityById = getEntityByIdMap(entities);
  const seedEntities = pickSeedEntities(entities, relationships);

  const scenarios = seedEntities.map((seed) => ({
    changed_entity_id: seed.entity_id,
    changed_entity_name: seed.canonical_name,
    impacted_entities: collectImpactForSeed(seed.entity_id, graph, entityById),
  }));

  return {
    generated_at: new Date().toISOString(),
    summary: {
      total_entities: entities.length,
      total_relationships: relationships.length,
      scenarios_generated: scenarios.length,
    },
    scenarios,
  };
}
