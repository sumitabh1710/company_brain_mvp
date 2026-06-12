# PRD Draft - Compare Versions Drawer

page: `/documents/:id/compare`  
status: rough, copy still changing

## Context
people keep asking "what changed in knowledge?" not just text diff.
this drawer should answer that in one place.

## Happy path
1. user on document page clicks `Compare versions`
2. modal opens with left dropdown = old version, right = new version
3. user selects `v3` vs `v4`
4. clicks `Generate knowledge diff`
5. spinner + "Analyzing changes..."
6. sections appear:
   - Added
   - Removed
   - Modified
7. user expands one modified card and sees old/new content

## UI notes
- keep compare CTA near version timeline
- default compare = latest vs previous
- if only one version exists, disable with tooltip
- summary badges at top: `+3`, `-1`, `~2`

## Card behavior (important)
- each change card should show type + title first
- modified card should include "why changed" if model gives reason
- if reason missing, show `reason not provided`
- allow copy JSON for debug

## States
- loading
- empty change set ("No meaningful knowledge changes")
- failed run
- partial run (show warning banner)

## Messy edge cases from team chat
- user compares same version accidentally -> warn and stop
- version metadata missing because old backfill -> still attempt
- old extraction failed but new succeeded -> show "cannot diff"
- model timeout -> retry button in place

## Decisions made already
- wording-only changes should not be shown as modified
- semantic changes (example threshold values) must be shown
- keep this read-only, no edit from compare screen

## Open questions
- do we let user download markdown report?
- should compare auto-run on page load?
- do we show confidence trend (old avg vs new avg)?

## Unresolved conflict notes
- Product wants auto-run compare for speed, infra says manual run to control cost.
- QA asked to allow comparing non-adjacent versions, design says this may confuse users.
- We say "wording-only changes hidden", but legal asked for optional strict diff mode.
- TODO: add explicit warning when old version extraction is missing.
- TBD: compare should maybe include "link changes" not just item changes.
