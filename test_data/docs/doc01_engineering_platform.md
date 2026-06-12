# PRD (rough) - Upload Documents Page

page: `/workspace/upload`  
status: draft with unresolved stuff  
owner-ish: product + platform + design (not locked)

## User story (messy)
- user wants to drop docs fast
- user should not think about file format details
- but we still need versioning from day 1

## Main UI steps
1. user lands on Upload page
2. sees empty state + `Upload docs` CTA
3. clicks CTA -> file picker modal
4. picks `.md`, `.pdf`, `.txt` (for now)
5. clicks `Start ingest`
6. row appears in table: `processing`
7. when done row changes to `extracted`
8. user can click `View extraction`

## UI elements
- top CTA button: `Upload docs`
- drag area with helper text
- file table columns:
  - file_name
  - source
  - uploaded_by
  - uploaded_at
  - status
  - actions
- action kebab:
  - reprocess
  - mark archived
  - open extracted knowledge

## Behavior notes
- If user uploads same file name:
  - still create new document version (do not overwrite)
- show toast:
  - success: `File queued for extraction`
  - error: `Upload failed, try again`
- batch upload maybe 20 files max? open question

## Edge cases (from QA chat)
- file is empty -> reject with clear error
- unsupported extension -> reject
- duplicate click on Start ingest -> disable button while request in-flight
- network drop during upload -> keep retry option

## Data points we need to persist
- document_id
- document_version
- original_file_name
- source_type (manual_upload now)
- upload_status

## Dependencies called from this page
- upload service API
- extraction job queue
- document metadata store

## Decisions already said in meeting
- always version documents, never overwrite
- extraction starts async immediately after upload
- user can leave page and come back; status should persist

## Open questions
- should failed rows auto-retry?
- can users upload zip?
- should we allow doc-level tags now or later?

## Future note
- once integrations exist, this page will also show:
  - `Ingest from Notion`
  - `Sync from Google Drive`

## Loose notes from thread (not cleaned)
- PM said max upload maybe 20 files, eng said maybe 50 if async queue is healthy.
- We wrote "do not overwrite", but design asked if replacing typo file should be allowed.
- Someone suggested auto-tag by filename, no decision.
- TODO: decide if drag-drop should start upload instantly or wait for confirm click.
- TODO: if user uploads same file twice in 30s, should we collapse rows?
- TBD with backend: status values currently `processing|extracted|failed`, maybe add `queued`.
