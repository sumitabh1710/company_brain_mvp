# Company Brain MVP and MVP-2 (Node + Gemini)

This repository contains:

- MVP-1 single-document extraction and diff (`src/mvp-runner.js`)
- MVP-2 batch extraction + canonicalization + linking + impact (`src/batch-runner.js`)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create env file:

   ```bash
   cp .env.example .env
   ```

3. Edit `.env` and set:
   - `GOOGLE_AI_API_KEY`
   - `GEMINI_MODEL` (optional, default `gemini-2.5-pro`)

## MVP-1 (single document)

Run:

```bash
npm run mvp -- <path-to-document>
```

Example:

```bash
npm run mvp -- test_data/docs/doc01_engineering_platform.md
```

Output behavior:

- prints normalized extracted items
- creates or updates `knowledge.json`
- compares previous snapshot and prints `added`, `removed`, `modified`

## MVP-2 (batch + entities + graph artifacts)

Run:

```bash
npm run mvp2 -- test_data/docs
```

Per-doc logs:

- `[1/N] file.md: extracted=..., valid=..., warnings=...`

Final summary logs:

- total docs processed
- total knowledge items extracted
- total canonical entities created
- total relationships created

## MVP-2 Output Artifacts

- `batch_knowledge.json`:
  - all normalized extracted items with `document_id` and `document_version`
  - per-document extraction summary
- `entities.json`:
  - canonical entities with aliases, supporting item ids, and source docs
  - compression metric (`items -> entities`)
- `item_entity_map.json`:
  - mapping from extracted `item_id` to canonical `entity_id`
- `relationships.json`:
  - entity-to-entity links with `relationship_type`, `confidence`, and `evidence`
- `impact_report.json`:
  - dependency impact scenarios showing what could be affected if an entity changes

## Test Data

- `test_data/docs/` contains 10 seed docs for MVP-2 ingestion.
- each document is long-form and structured for durable knowledge extraction.

## Notes

- Both runners now read credentials from `.env` via `dotenv`.
- `src/batch-runner.js` requires a real Gemini API key and does not silently fall back.
- `.env` is gitignored; use `.env.example` as template.
