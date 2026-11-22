# Phase S7 (Upload a CSV into the database) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The marketer picks one CSV (calls, campaigns or locations) in the app, sees a preview of what it would add, confirms, and every view reflects it without a restart.

**Architecture:** All upload logic is pure functions of a `DatabaseSync` plus the file's text, in a new `src/db/upload/` folder: detect the file's kind from its header, classify every row against what is stored (read-only, this is the preview), then write the new rows in one transaction (this is the confirm). Confirm is **stateless**: the browser sends the same file again and the server re-classifies inside the write transaction, so a stale preview can never write the wrong thing. The server keeps its `CallStore` in a swappable slot; a successful confirm replaces it (and rebuilds the AI takeaway service so its cache key follows the data). Nothing downstream of `CallStore` changes.

**Tech Stack:** TypeScript (strict), vitest, Node 24 `node:sqlite`, Hono (`hono/body-limit` and `c.req.parseBody()` are in the installed `hono`), React. **No new package.**

**Spec:** `PLAN.md` ("S7: Upload a CSV into the database", section 3.3 caveats, section 5 data rules, section 6 Freshness and Dependencies, section 7 AI cache key, section 8 Testing), `docs/BRIEF.md`, `CLAUDE.md`, `docs/plans/s6-database.md`, and the code it builds on: `src/core/csv.ts`, `reference.ts`, `validate.ts`, `loadExport.ts`, `src/db/seed.ts`, `read.ts`, `cleaned.ts`, `prepare.ts`, `database.ts`, `src/server/app.ts`, `api.ts`, `start.ts`, `src/ai/fromEnv.ts` (`snapshotId`), `src/web/App.tsx`, `components/Header.tsx`, `api.ts`.

## Global Constraints

- Work **one task at a time**. After the last task run `npm test`, `npm run typecheck` and `npm run build`, show the results, then **stop** and wait (CLAUDE.md).
- **No new dependency** (PLAN.md: "Hono's built-in body parsing handles the file, so no new package").
- **Every existing test passes unchanged.** If an existing assertion has to change, stop and tell me; never loosen one. New assertions go in new test files, except where a task names an existing file to **add** to.
- **No schema change.** `SCHEMA_VERSION` stays 1, so a database seeded by S6 keeps working and nobody has to reseed. Uploads reuse the existing tables (Gap 3).
- **No metric, view builder or AI sentence changes.** `src/core/views`, `src/core/metrics*`, `src/ai/checker`, `prompt` and `service` are not edited. The only `src/core` edit is one added field on `Table` (Task 1).
- Data rules stay in the core: uploads validate rows with the existing `validateCall`, `parseCampaigns`, `parseLocations`. No second set of rules.
- **Nothing hard-coded to this dataset.** No campaign, office, id or date in `src/db/upload` or `src/server/upload*`.
- **Every number the user sees comes from code.** The preview counts are computed on the server; the web only formats them.
- **Writes are one transaction.** Anything that can throw (classification, inserts, `cleaned_calls`, rebuilding the store) happens before `COMMIT`; any throw rolls back and the server keeps its old store.
- **Uploads are same-origin only.** The upload routes refuse a cross-site request (a browser sends a `multipart/form-data` POST from any web page without asking first). Reuse the existing `Sec-Fetch-Site` rule.
- **Tests use an in-memory database.** `vitest.config.ts` already sets `DB_PATH=:memory:`; no test touches `data/calls.db`. Only the file-level cases (a failed write leaves the file as it was) use a temp folder from `tests/server/helpers.ts` `tempDir()`.
- No secrets. File names and cell text from an upload are data: bound parameters only, never in SQL text, a path, or a log line.
- Stage files by name, never `git add -A`; run `git status` first and leave the uncommitted `docs/AI_COST_LOG.md` alone. Never read or print `.env`. Do not edit `docs/BRIEF.md`, `PLAN.md`, `CLAUDE.md`; do not write to `docs/AI_COST_LOG.md`.
- Commit after each task, small, message says why, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Prefer simple, readable code; a reviewer will walk through all of it.

## Gaps in PLAN.md this plan fills

PLAN.md's S7 is clear on what and silent on several rules. Each is proposed here. **Please confirm or change them before I build.**

1. **Bad rows from an upload are reported, not stored.** PLAN.md says bad rows are "reported by reason" and that a call naming an unknown campaign or office gets "a hint to upload campaigns or locations first". If bad rows were written to `bad_rows` (as S6 does), the identity of that row would then exist, and uploading the campaigns and then the same calls again would find them "already stored" and leave them bad for good. So: bad rows are counted and listed in the preview and the result, and written nowhere. The header's "N rows skipped" keeps counting only what a seed stored. Rejected: storing them (blocks the fix the hint tells the user to make).
2. **What "the same row" means for calls.** PLAN.md: the same `call_id` and `updated_at` already stored is a duplicate. Followed literally, including when the other values differ (the stored row stays, the uploaded one is not written). The preview shows a hint with the number of such rows ("N rows match a stored call and time but have different values; skipped") so it is never silent. A call whose `updated_at` is empty or unparseable has no time to match, so for those the whole row has to be identical to count as a duplicate. **Question for you:** would you rather the "same key, different values" case be a **conflict** (like campaigns and locations) instead of a duplicate? PLAN.md's wording says duplicate; I followed it.
3. **No schema change: each confirmed upload adds one `seeds` row.** `raw_calls.seed_id` is `NOT NULL REFERENCES seeds`. The upload gets its own `seeds` row: `label` is `upload: <file name>`, the hash column of its own kind holds the SHA-256 of the file text, the other two are empty, `rows_read` is the rows in the file. That row can never equal the three hashes of a data folder, so S6's stale-folder warning is unaffected. Rejected: a new `uploads` table (a schema bump would refuse every existing database).
4. **Campaigns and locations are never edited by an upload.** Same id, same values: duplicate. Same id, different values: conflict, reported, **not written**. (S6's `npm run seed` still upserts; that is a different, deliberate command.) So a budget cannot be changed by upload; editing campaigns is a PLAN.md non-goal. For a conflict inside one file, the first row wins (as `parseCampaigns` already does for repeated ids) and later different rows are conflicts.
5. **A campaign or location row with any validation issue is bad and not written**, including a location whose time zone is not valid IANA. (The loader keeps such a location so its calls are reported `invalid_timezone`; for an upload that would silently turn every later call to that office bad, so the preview rejects the row instead.)
6. **What counts as "new rows" and "new versions".** A call row whose `call_id` is not stored is a **new row** (several versions of one new call in the same file are all new rows). A row whose `call_id` is stored with a different `updated_at` is a **new version**, written even when older than the stored latest (the latest still wins, as PLAN.md says). Campaigns and locations only have new rows.
7. **Confirm is stateless.** The browser still holds the selected `File` and posts it again to `/api/upload/commit`. The server re-classifies inside the transaction and reports what it really wrote. The preview is advice, not a token. Rejected: the server holding pending uploads (state to expire, size to cap, lost on restart).
8. **The upload control is a panel, not a view.** A button in the header opens a panel above the nav (like the dev data notes panel). It is not in the URL: a half-chosen file is not a screen to link to. After a successful confirm, the button "See the new data" does a full page load of `defaultsHref` (same view, default range) so meta, the date span, the pickers, every view and every takeaway are fetched fresh and an old custom range can never point outside the new span.
9. **Size limit: 10 MB** (the shipped `calls.csv` is 0.8 MB; the extended one 1.0 MB), a constant `UPLOAD_MAX_BYTES` in `src/server/config.ts`, enforced by Hono's `bodyLimit` before the body is read. Larger: 413 with the limit in the message.
10. **`:memory:` databases accept uploads** (the server keeps that one connection open), so tests and `DB_PATH=:memory:` work; the data is gone on exit, as it always is for that setting. A server built with `createApp(store)` and no database (existing tests) answers upload routes with `upload_unavailable` (409).
11. **Takeaway service after an upload.** The service is rebuilt from the new store (`createAiFromEnv`) so its `snapshotId` and known names follow the data (PLAN.md: "cache key includes the data"). Spend is read from the call log, so it carries over; the in-memory counters on the dev data notes panel (cache hits, checker failures) restart at 0. Stated in the README.
12. **Docker needs no change.** The image already copies `src/db` and `src/server`, runs as the user that owns `/app/db`, and mounts the data folder read-only (uploads never write to it). One assertion pins this (Task 7).

## Review Focus

Inputs the spec implies but no listed edge case names. Each has a test in the owning task.

1. **Confirm pressed twice, or two uploads of the same file at once.** The second imports nothing; nothing is stored twice. (Task 4 and Task 5)
2. **A cross-site POST** to either upload route is refused (403) and writes nothing. (Task 5)
3. **A stale preview.** The database changes between preview and confirm (another upload, or `npm run seed`): confirm reports what it actually wrote, never what the preview said. (Task 4)
4. **The data span moves.** After an upload the as-of date and span change; `/api/meta` and every view reflect it on the next request, and the web's "See the new data" link leaves the old range behind. (Tasks 5, 6)
5. **Hostile text in an upload** (a file name or an id with `<script>`, quotes, a comma, a newline, `'; DROP TABLE`): stored verbatim, shown escaped in the preview, never used as a path, never breaks SQL. (Tasks 3, 4, 6)

---

## File Structure

```
src/core/csv.ts                (modify)  Table gains `header: string[]`
src/db/upload/types.ts         (create)  UploadKind, UPLOAD_COLUMNS, UploadPreview, UploadPlan, UploadRejected, UploadFailed
src/db/upload/detect.ts        (create)  readUpload(fileName, text): ParsedUpload
src/db/upload/planReference.ts (create)  planReferenceUpload: campaigns and locations
src/db/upload/planCalls.ts     (create)  planCallsUpload
src/db/upload/plan.ts          (create)  planUpload: picks the planner, builds hints
src/db/upload/commit.ts        (create)  commitUpload: one transaction, rebuilds the store
src/db/upload/service.ts       (create)  createUploadService(handle): the server-facing pair preview / commit
src/db/handle.ts               (create)  DatabaseHandle: how the server reaches the database after startup
src/db/read.ts                 (modify)  export readCampaigns, readLocations (extracted, unchanged)
src/db/seed.ts                 (modify)  export rowHash and prepareRowInserts (extracted, unchanged)
src/db/prepare.ts              (modify)  LoadedStore gains `database: DatabaseHandle`
src/server/api.ts              (modify)  new error codes, 413, upload response types
src/server/config.ts           (modify)  UPLOAD_MAX_BYTES
src/server/app.ts              (modify)  swappable current store/span/ai; mount upload routes
src/server/uploadRoutes.ts     (create)  POST /api/upload/preview and /api/upload/commit
src/server/start.ts            (modify)  build the upload service and the AI rebuild; close the handle
src/web/api.ts                 (modify)  postUpload
src/web/models/uploadModel.ts  (create)  text, order, blanks and states of the panel (pure)
src/web/components/UploadPanel.tsx (create)
src/web/components/Header.tsx  (modify)  "Upload data" button
src/web/App.tsx                (modify)  panel state, like the data notes panel
tests/db/upload/*.test.ts, tests/server/upload-endpoint.test.ts, tests/web/uploadModel.test.ts, tests/web/render-upload.test.tsx, tests/snapshot/upload-totals.test.ts (create)
```

Test helpers: reuse `tests/db/helpers.ts` (`csvTexts`, `callLine`, `campaignLine`, `locationLine`, `memoryDb`, `count`, `noSource`, `messyTexts`) and `tests/server/helpers.ts` (`tempDir`, `get`). Task 1 adds `tests/db/upload/helpers.ts` with `seeded(parts?)` (an in-memory database seeded through `seedFromTexts` from `csvTexts(parts)`) and `csvOf(header, lines)` (a CSV text from a header and data lines).

---

### Task 1: Read an upload and detect what it is

**Files:**
- Modify: `src/core/csv.ts` (add `header: string[]` to `Table`; the zero-byte early return gets `header: []`)
- Create: `src/db/upload/types.ts`, `src/db/upload/detect.ts`, `tests/db/upload/helpers.ts`
- Test: `tests/db/upload/detect.test.ts`; add to `tests/core/csv.test.ts` (new `it` only)

**Interfaces:**
- Produces (`types.ts`):
  - `type UploadKind = 'calls' | 'campaigns' | 'locations'`
  - `const UPLOAD_COLUMNS: Record<UploadKind, readonly string[]>` built from `CALL_COLUMNS`, `CAMPAIGN_COLUMNS`, `LOCATION_COLUMNS`
  - `type UploadRejectReason = 'empty' | 'not_csv' | 'unknown_columns' | 'ambiguous_columns' | 'bad_csv' | 'too_large' | 'no_file'`
  - `class UploadRejected extends Error { reason: UploadRejectReason }` (message is the full sentence for the user)
  - `class UploadFailed extends Error` (a write that rolled back; message says nothing was stored)
- Produces (`detect.ts`): `interface ParsedUpload { kind: UploadKind; fileName: string; table: Table; textSha256: string }` and `readUpload(fileName: string, text: string): ParsedUpload`, which throws `UploadRejected`.

- [ ] **Step 1: Write the failing tests** (`tests/db/upload/detect.test.ts`)
  - `a calls file is detected as calls` / `campaigns` / `locations` (each from the three `csvTexts` outputs).
  - `column order does not matter` (reverse each header and its rows).
  - `extra columns are fine` (add `notes` to each kind).
  - `a byte order mark and Windows line endings are fine` (`'﻿' + text.replaceAll('\n', '\r\n')` for each kind).
  - `a header-only file is still detected` (kind `calls`, `table.rows` empty, `table.isEmpty` true).
  - `header names are matched after trimming spaces` (`" call_id , started_at"`).
  - `an empty file is rejected` and `a file of only spaces and newlines is rejected` (`reason` `'empty'`, message mentions "empty").
  - `a file that is not CSV is rejected with the columns it expected`: `readUpload('notes.txt', 'hello, this is not a csv')` and a PDF-like `'%PDF-1.4\n\u0000\u0001'` both throw `reason` `'unknown_columns'`; the message contains all three required column lists, e.g. `call_id, started_at, ...` for calls, `campaign_id, name, channel, daily_budget_usd` and `location_id, name, timezone`.
  - `a file that matches none lists the columns it found` (`"a,b,c"`: message contains `a, b, c`).
  - `a file that matches more than one is rejected` (header = calls columns + `name,timezone,channel,daily_budget_usd` matches all three): `reason` `'ambiguous_columns'`, message names the kinds it matches.
  - `a calls file missing one column is not a calls file` (drop `outcome`: rejected, and the message says which required column of the **closest** kind is missing: `calls (missing: outcome)`. The closest kind is the one missing the fewest columns).
  - `a repeated column is rejected` (`call_id` twice, `reason` `'bad_csv'`, message from `readTable`'s own text, naming the uploaded file name).
  - `a quote that never closes is rejected` (`reason` `'bad_csv'`).
  - `the message names the uploaded file, not calls.csv` (file name `my export (1).csv`).
  - `textSha256 is the SHA-256 of the text and ignores nothing` (same text same hash; one character changed, different hash).
  - In `tests/core/csv.test.ts`: `exposes the trimmed header, in file order` (`readTable('b, a\n2,1', file, required).header` equals `['b', 'a']`; zero-byte gives `[]`).

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run tests/db/upload/detect.test.ts tests/core/csv.test.ts` · Expected: FAIL (module not found; `header` undefined).

- [ ] **Step 3: Implement `readUpload`.** Parse once with `readTable(text, fileName, [])` to get the header; a blank text or an empty header is `empty`. A kind matches when every required column is in the header. One match: re-run `readTable(text, fileName, UPLOAD_COLUMNS[kind])` so a repeated column and broken quoting come back as the existing `LoadError` messages, and wrap a `LoadError` as `UploadRejected('bad_csv', error.message)`. Zero matches: `unknown_columns`; if the header holds none of the three kinds' columns at all, say it is not a calls, campaigns or locations file. Messages (exact text the tests above use, `<name>` is the file name):
  - empty: `<name> is empty. Choose a calls, campaigns or locations CSV.`
  - none: `<name> is not a calls, campaigns or locations file. It has the columns: <header, comma separated>. A calls file needs: <calls columns>. A campaigns file needs: <campaigns columns>. A locations file needs: <locations columns>.` (When a kind is only a little short, append ` The closest is calls (missing: outcome).`)
  - several: `<name> matches more than one kind (<kinds>). Upload each kind as its own file.`
  Never put a file's cell text in a message, only its header (header cells are cut to 40 characters with `shorten` from `src/server/api.ts`'s rule, reimplemented locally if importing from server would invert the layering: `src/db` must not import `src/server`).

- [ ] **Step 4: Run them to see them pass**, plus `npx vitest run tests/core`. Expected: PASS, no existing core test changed.

- [ ] **Step 5: Commit**

```bash
git add src/core/csv.ts src/db/upload/types.ts src/db/upload/detect.ts tests/db/upload/helpers.ts tests/db/upload/detect.test.ts tests/core/csv.test.ts
git commit -m "feat: an uploaded CSV is recognised by its header columns, whatever their order"
```

---

### Task 2: Classify a campaigns or locations upload against the database

**Files:**
- Modify: `src/db/read.ts` (export `readCampaigns(db): Campaign[]` and `readLocations(db): Location[]`, extracted from `readTables`; no behavior change)
- Modify: `src/db/upload/types.ts` (the preview and plan types)
- Create: `src/db/upload/planReference.ts`
- Test: `tests/db/upload/planReference.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type RowClass = 'new' | 'new_version' | 'duplicate' | 'conflict' | 'bad'`
  - `interface UploadExample { row: number; id: string; note: string }` (`row` is the 1-based data row in the uploaded file, header excluded; `id` is the call, campaign or location id, shortened to 40 characters; `note` is a short sentence)
  - `const EXAMPLES_PER_CLASS = 5`
  - `interface UploadCounts { rowsRead: number; newRows: number; newVersions: number; duplicates: number; conflicts: number; bad: number }` (the five classes add up to `rowsRead`)
  - `interface UploadPreview { kind: UploadKind; fileName: string; counts: UploadCounts; examples: Record<RowClass, UploadExample[]>; badByReason: Record<string, number>; hints: string[] }`
  - `type UploadPlan = { preview: UploadPreview } & ({ kind: 'calls'; calls: Call[] } | { kind: 'campaigns'; campaigns: Campaign[] } | { kind: 'locations'; locations: Location[] })` (the rows to write, in file order)
- Produces (`planReference.ts`): `planReferenceUpload(db: DatabaseSync, upload: ParsedUpload): UploadPlan` for kinds `campaigns` and `locations`. Read-only: it never writes.

- [ ] **Step 1: Write the failing tests** (`tests/db/upload/planReference.test.ts`; `seeded()` gives `cmp_a` Alpha/social/100, `cmp_b` Beta/display/50, `loc_a` Office A/America/Phoenix, `loc_b` Office B/America/Denver)
  - `a new campaign is a new row`: upload `cmp_c,Gamma,paid_search,75`; counts `{rowsRead:1,newRows:1,newVersions:0,duplicates:0,conflicts:0,bad:0}`, plan `campaigns` has it.
  - `the same campaign with identical values is a duplicate` (`cmp_a,Alpha,social,100`; `100.00` and ` Alpha ` with spaces also duplicate: values compare after parsing).
  - `the same campaign id with different values is a conflict and is not planned for writing` (change name; change budget; change channel; one test each; the example note names the field and both values, e.g. `budget is 100 in the database, 120 in this file`).
  - `the same location with identical values is a duplicate; a different name or time zone is a conflict` (a zone alias that normalises to the stored zone is a duplicate).
  - `a duplicate inside the file is caught` (two identical new rows: first `new`, second `duplicate` with note `repeated in this file (row 1)`).
  - `the same new id twice with different values: the first row is new, the second a conflict` (note names row 1).
  - `bad rows are reported by reason and never planned` (one row each: empty id, bad budget `abc`, negative budget, unknown channel; `badByReason` is `{ empty_id:1, bad_budget:2, bad_channel:1 }`).
  - `a location with an invalid time zone is bad, not written` (`Mars/Olympus`; reason `invalid_timezone`; absent from the plan).
  - `a mixed file adds up`: rows for each class; `newRows + newVersions + duplicates + conflicts + bad === rowsRead`.
  - `examples are capped at 5 per class and carry the file row number` (8 new rows: 5 examples, `counts.newRows` 8; example `row` values are 1..5).
  - `an id with markup, quotes, a comma and a newline is carried through unchanged` (`id` is `<script>"x,y\nz`; planned verbatim; the example `id` is the same text, shortened only by length). (Review Focus 5)
  - `an empty file of the right kind (header only) is zero rows, nothing planned` (counts all 0, `rowsRead` 0).
  - `it never writes`: `count(db, 'campaigns')`, `count(db, 'seeds')` unchanged after planning.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run tests/db/upload/planReference.test.ts` · Expected: FAIL (module not found).

- [ ] **Step 3: Implement `planReferenceUpload`.** Run each data row through `parseCampaigns` / `parseLocations` on its own, as a one-row `Table` (`{ file, rows: [row], isEmpty: false }`), so the existing validation is reused unchanged and each row's own issue comes back; the issue's `rowNumber` is always 1, so map it to the row's real number yourself. Any issue (Gap 5) makes the row `bad` with `issue.reason` and `issue.detail`. Then compare by id: stored ids from `readCampaigns` / `readLocations`, ids seen earlier in this file in a `Map<string, { row: number; values }>`. Do not touch `reference_issues`.

- [ ] **Step 4: Run them to see them pass**, plus `npx vitest run tests/db`. Expected: PASS (S6's `read` tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/db/read.ts src/db/upload/types.ts src/db/upload/planReference.ts tests/db/upload/planReference.test.ts
git commit -m "feat: a campaigns or locations upload is classified against the database before anything is written"
```

---

### Task 3: Classify a calls upload against the database

**Files:**
- Modify: `src/db/seed.ts` (export `rowHash(row: RowResult): string`, the SHA-256 part of today's `row_key`, and `prepareRowInserts(db): { insertGood: StatementSync; insertBad: StatementSync }`, extracted from `writeSeed`; `writeSeed` calls them; no behavior change)
- Create: `src/db/upload/planCalls.ts`, `src/db/upload/plan.ts`
- Test: `tests/db/upload/planCalls.test.ts`

**Interfaces:**
- Consumes: `readCampaigns`, `readLocations` (Task 2), `buildReferences`, `validateCall` (`src/core/validate`), `UploadPlan` and friends (Task 2).
- Produces:
  - `planCallsUpload(db: DatabaseSync, upload: ParsedUpload): UploadPlan` (kind `calls`; `calls` holds the rows to write, in file order, new rows and new versions together). Read-only.
  - `planUpload(db: DatabaseSync, upload: ParsedUpload): UploadPlan` in `plan.ts`: calls the right planner and fills `preview.hints` (below). This is the one function Tasks 4 and 5 use.
- Hints (exact text; `n` is a count, `<kind>` as stated): `<n> rows name a campaign that is not in the database. Upload campaigns.csv first, then upload this file again.` (any `unknown_campaign`); `<n> rows name an office that is not in the database. Upload locations.csv first, then upload this file again.` (any `unknown_location`; `invalid_timezone` rows get no hint, their row detail already says what is wrong); `<n> rows match a stored call and time but have different values. They were skipped.` (Gap 2); and for a calls file with zero rows: none.

- [ ] **Step 1: Write the failing tests** (`tests/db/upload/planCalls.test.ts`; the database is `seeded({ calls: [callLine({ call_id: 'c_1' }), callLine({ call_id: 'c_2', updated_at: '2026-09-01T17:00:00Z' })] })`)
  - `the same file again: every row is a duplicate` (upload exactly the two lines: `duplicates` 2, nothing planned).
  - `a new call_id is a new row`; `a stored call_id with a new updated_at is a new version` (counts and the planned `Call`'s fields).
  - `a version older than the stored latest is still a new version` (planned; it will not win, Task 4 proves that).
  - `a repeat inside the file is a duplicate` (same call_id and updated_at twice: first new, second duplicate, note `repeated in this file (row 1)`).
  - `two versions of one new call in the file are both new rows` (different `updated_at`).
  - `the same call_id and updated_at with different values is a duplicate, skipped, and hinted` (Gap 2: stored `c_1` at the stored time with outcome `booked` in the upload: `duplicates` 1, planned empty, the third hint present with `n` 1, the example note says `already stored, but its other values differ`).
  - `a row with no usable updated_at is a duplicate only when the whole row is identical` (stored row with `updated_at: 'garbage'`; upload the identical line: duplicate; upload it with a different `duration_seconds`: new version).
  - `a call whose latest stored row is bad does not block its corrected row` (database seeded with `c_bad` at `loc_nope` -> in `bad_rows`; upload the corrected line (same id and time, `loc_a`): it is a new row, since stored bad rows are not stored calls).
  - `rows are validated against the stored campaigns and locations, not the file's`: an unknown campaign → bad `unknown_campaign`; unknown office → bad `unknown_location`; bad timestamp, bad boolean, bad outcome, negative duration, missing call_id: one row each with the matching reason in `badByReason`. Hints for the first two present with exact text; absent when there are no such rows.
  - `bad rows are never planned` (planned `calls` has no bad rows; `counts.bad` matches).
  - `whitespace around ids does not hide a duplicate` (` c_1 ` with spaces is the stored `c_1`: `validateCall` trims; assert duplicate).
  - `a call that names a campaign the database has only after a campaigns upload` (before: bad; after committing campaigns with `seedExport` in the test: same file is new). Proves the hint's advice works.
  - `an unattributed call (empty campaign_id) is fine` (new row).
  - `a mixed file adds up` (`newRows + newVersions + duplicates + conflicts + bad === rowsRead`, conflicts always 0 for calls).
  - `examples are capped at 5 per class, carry the row number and the call id` and `text in ids and names is carried through unchanged` (a `call_id` of `<img src=x onerror=alert(1)>'; DROP TABLE raw_calls;--`: planned verbatim; `count(db, 'raw_calls')` unchanged). (Review Focus 5)
  - `it never writes` (all table counts unchanged).
  - `the shipped export uploaded into a database seeded from it: every row is a duplicate` (use `tests/fixtures/original-export` through `seedFromTexts` and `readUpload`; `counts` is `{ rowsRead: 5411, newRows: 0, newVersions: 0, duplicates: 5411, conflicts: 0, bad: 0 }`). This is a Done-when line. The same for the extended folder `data/extended`, `rowsRead` 6911.
  - `planUpload on a campaigns file uses the reference planner` (dispatch).

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run tests/db/upload/planCalls.test.ts` · Expected: FAIL (module not found).

- [ ] **Step 3: Implement `planCallsUpload`.** Load once: stored `raw_calls` as `Map<call_id, Map<updated_at | null, string[] /* row hashes */>>`, the set of stored row hashes (from `row_key` before the `#`), the stored campaigns and locations for `buildReferences`. Per row, in order: `validateCall(raw, rowNumber, refs)`; bad → `bad`. Else with `hash = rowHash(row)`: has `updatedAt` → stored duplicate when `(call_id, updated_at)` is stored (note: same-values vs differing decided by whether `hash` is among that key's stored hashes); no `updatedAt` → duplicate only when `hash` is stored. Then the same two checks against what this file already planned. Else `new_version` when the `call_id` is stored, otherwise `new`. Add every planned row's key to the in-file sets. `row_key` has the form `hash#occurrence`; match on the part before `#`.

- [ ] **Step 4: Run them to see them pass**, plus `npx vitest run tests/db`. Expected: PASS (all S6 seed tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/db/seed.ts src/db/upload/planCalls.ts src/db/upload/plan.ts tests/db/upload/planCalls.test.ts
git commit -m "feat: a calls upload is classified row by row, so the preview can say exactly what would be added"
```

---

### Task 4: Write an upload in one transaction and rebuild the store

**Files:**
- Create: `src/db/upload/commit.ts`
- Test: `tests/db/upload/commit.test.ts`

**Interfaces:**
- Consumes: `planUpload` (Task 3), `prepareRowInserts` (Task 3), `refreshCleanedCalls` (`src/db/cleaned`), `readStore` (`src/db/read`), `convertDatabaseError` (`src/db/database`).
- Produces: `interface UploadCommit { preview: UploadPreview; written: number; store: CallStore | null }` and `commitUpload(db: DatabaseSync, upload: ParsedUpload, now?: Date): UploadCommit`.
  - Inside one `BEGIN IMMEDIATE`: plan again (`planUpload`: the plan inside the lock is the only one that counts, Review Focus 3), and when there is nothing to write, end the transaction and return `{ preview, written: 0, store: null }` (no `seeds` row, no store rebuild). Otherwise insert one `seeds` row (Gap 3), write the planned rows (`campaigns` / `locations` plain `INSERT`; calls with `seq = max(seq over both tables) + 1` in file order through `prepareRowInserts().insertGood`, with `row_key = rowHash + '#0'`), `refreshCleanedCalls(db)` for calls, then `readStore(db)`, then `COMMIT`. `written` is `counts.newRows + counts.newVersions`.
  - Any throw rolls back (`if (db.isTransaction) db.exec('ROLLBACK')`) and is rethrown as `UploadFailed('The upload failed and nothing was stored: <detail>')` where `<detail>` is `convertDatabaseError(...)`'s message, without file contents.

- [ ] **Step 1: Write the failing tests** (`tests/db/upload/commit.test.ts`)
  - `new calls are written and the returned store contains them` (`written` 1; `store.calls` has the new id; `count(db,'raw_calls')` +1; `count(db,'cleaned_calls')` +1; `count(db,'seeds')` +1 with `label` `upload: <name>`; `calls_sha256` equals `textSha256`, the other two hashes are `''`).
  - `the same file twice: the second imports nothing` (second `commitUpload`: `written` 0, `store` null, no new `seeds` row, counts all duplicates). Done-when: "the same file uploaded twice (the second upload imports nothing)".
  - `confirm twice in a row writes once` (Review Focus 1).
  - `a new version wins when it is the latest and loses when it is older` (stored `c_1` missed at 16:02; upload a `booked` $300 row at 18:00: `store` call is booked, revenue 300; then upload an older row at 15:00: stored (`written` 1), `store` call still booked 300).
  - `a call's new version changes the numbers the views read` (build `buildOverview(store, ...)` before and after with the existing builder; bookings and revenue rise by exactly the new version's amounts).
  - `an upload of new calls moves the data span` (`dataSpan(store.calls)` end later than before; Review Focus 4).
  - `campaigns and locations are written and the store lists them` (`store.campaigns` includes the new one; `store.locations` likewise; `cleaned_calls` untouched).
  - `a campaigns upload makes calls that were bad valid: upload campaigns, then the calls file that named them` (first the calls: all bad, `written` 0; then the campaigns: written; then the same calls: written, appear in `store`). The hint's advice works end to end.
  - `a stale preview does not write what it promised` (Review Focus 3): `planUpload` for file X (3 new rows); then commit file Y that contains 2 of the same rows; then `commitUpload(X)`: `written` 1, `preview.counts.duplicates` 2; `raw_calls` has no repeats.
  - `a failure partway rolls everything back` (Review Focus 1, file case): create a trigger in the test database, `CREATE TRIGGER boom BEFORE INSERT ON raw_calls WHEN NEW.call_id = 'c_boom' BEGIN SELECT RAISE(ABORT, 'boom'); END`, upload `c_ok`, `c_boom`, `c_ok2`: `commitUpload` throws `UploadFailed` with a message containing `nothing was stored`; every table's row count, including `seeds`, equals what it was; `c_ok` is absent. Then drop the trigger and the same upload succeeds in full.
  - `a failure while rebuilding the store also rolls back` (trigger on `cleaned_calls` insert).
  - `nothing in a failed message is file content` (the id `c_boom` does not appear in the `UploadFailed` message; the SQLite detail may).
  - `a file-backed database keeps its bytes when the write fails` (temp file from `tempDir()`; read the file bytes before; trigger failure; bytes after equal before; the connection closes and the file can be deleted on Windows).
  - `existing S6 behaviour: a later npm run seed of the same export still adds nothing after an upload` (seed export A; upload new calls; `seedFromTexts` A again: `newRows` 0, `duplicateRows` equals its `rowsRead`).
  - `hostile text is stored verbatim` (a campaign named `O'Brien; DROP TABLE x -- "Café, Ltd"` and an id `<b>x</b>`: read back from the database equal to what was uploaded). (Review Focus 5)
  - `an upload of only duplicates and bad rows writes nothing and reports why` (counts and `store` null).

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run tests/db/upload/commit.test.ts` · Expected: FAIL (module not found).

- [ ] **Step 3: Implement `commitUpload`** as specified. Build `readStore` **before** `COMMIT` so a failure to rebuild rolls the write back. `now` only feeds `seeded_at`.

- [ ] **Step 4: Run all `tests/db`.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/upload/commit.ts tests/db/upload/commit.test.ts
git commit -m "feat: confirming an upload writes every new row in one transaction, or none"
```

---

### Task 5: The server: swap the store, serve preview and commit

**Files:**
- Create: `src/db/handle.ts`, `src/db/upload/service.ts`, `src/server/uploadRoutes.ts`
- Modify: `src/db/prepare.ts` (`LoadedStore.database`), `src/server/api.ts`, `src/server/config.ts`, `src/server/app.ts`, `src/server/start.ts`
- Test: `tests/server/upload-endpoint.test.ts`, `tests/server/upload-start.test.ts`, `tests/db/handle.test.ts`, `tests/server/config-upload.test.ts`.

**Interfaces:**
- Consumes: `readUpload`, `planUpload`, `commitUpload` (Tasks 1 to 4), `createAiFromEnv`, `dataSpan`.
- Produces:
  - `interface DatabaseHandle { use<T>(fn: (db: DatabaseSync) => T): T; close(): void }` (`handle.ts`). `createFileHandle(path: string): DatabaseHandle` opens with `openExistingDatabase(path)` for each `use` and closes in `finally`. `createMemoryHandle(db: DatabaseSync): DatabaseHandle` keeps one connection; `close()` closes it. `loadStore` returns `database` (file: a file handle; `:memory:`: a memory handle that keeps the seeded connection open instead of closing it).
  - `interface UploadService { preview(fileName: string, text: string): UploadPreview; commit(fileName: string, text: string): UploadCommit }` and `createUploadService(handle: DatabaseHandle): UploadService` (`service.ts`; both call `readUpload` first, so both throw `UploadRejected`; `commit` may throw `UploadFailed`).
  - `AppOptions` gains `uploads?: UploadService` and `rebuildAi?: (store: CallStore) => TakeawayService`. `createApp` keeps its signature and behavior; internally the store, the data span and the AI service live in one `current` object that every route reads **at request time**, and a successful commit with a non-null store replaces all three (`ai` via `rebuildAi` when given, else unchanged).
  - `src/server/api.ts`: `ApiErrorCode` gains `'bad_upload' | 'too_large' | 'upload_unavailable' | 'upload_failed'`; `statusFor`: `too_large` 413, `upload_unavailable` 409, `upload_failed` 500, `bad_upload` 400 (the return type gains `413`). `interface UploadPreviewResponse { preview: UploadPreview }` and `interface UploadCommitResponse { preview: UploadPreview; written: number; meta: Meta }` (`meta` is the fresh `/api/meta` body so the page does not need a second request to show the new span).
  - `config.ts`: `export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024`.
  - Routes (`uploadRoutes.ts`, mounted by `createApp`): `POST /api/upload/preview` and `POST /api/upload/commit`, body `multipart/form-data` with one file field `file`. Order: cross-site check (`Sec-Fetch-Site`, same rule as the paid routes) → `bodyLimit({ maxSize: UPLOAD_MAX_BYTES, onError })` → `c.req.parseBody()` → exactly one `File` named `file` → `await file.text()` → service. Responses: preview `200 { preview }`; commit `200 { preview, written, meta }`. Errors are the usual `{ error: { code, message, field: 'file' } }`: not multipart, no `file`, several files, or `UploadRejected` → 400 `bad_upload` with the rejection's own message; over the limit → 413 `too_large` (`The file is larger than 10 MB.`); no `uploads` option → 409 `upload_unavailable` (`This server has no database to store uploads in.`); `UploadFailed` → 500 `upload_failed` with the failure message (it is already fixed text). The file name used is `file.name`, cut to 100 characters and never used as a path.
  - `start()` builds the handle from `loadStore`, passes `uploads: createUploadService(handle)` and `rebuildAi: (s) => createAiFromEnv(s, process.env)` to `createApp`, and closes the handle in `RunningServer.close()`.

- [ ] **Step 1: Write the failing tests**
  - `tests/server/config-upload.test.ts`: `UPLOAD_MAX_BYTES` is 10485760; `statusFor('too_large')` 413, `'upload_unavailable'` 409, `'upload_failed'` 500, `'bad_upload'` 400.
  - `tests/db/handle.test.ts`: a file handle opens per use and closes after (the temp file can be deleted afterwards on Windows); a memory handle keeps data between two `use` calls; `use` on a corrupt or missing file throws the `LoadError` from S6; `close()` twice is safe.
  - `tests/server/upload-endpoint.test.ts` (in-process through `app.request`, a small helper `post(app, path, parts: { file?: { name, text }, extra?: ... }, headers?)` builds the `FormData`; the app is `createApp(store, { uploads, rebuildAi })` over `seeded()`-style data via `loadStore({ dbPath: ':memory:', dataDir })` so the handle and store agree):
    - `preview of a valid calls file returns counts, examples and hints, and writes nothing` (`count(raw_calls)` unchanged; `/api/meta` `callCount` unchanged).
    - `commit writes, and /api/meta, /api/overview and /api/campaigns reflect it on the next request` (Review Focus 4: `meta.span.end` later, `callCount` +n; overview totals changed by exactly the new calls; a new campaign appears in `meta.campaigns`).
    - `the commit response carries the new meta` (equal to a following `GET /api/meta`).
    - `a second commit of the same file imports nothing` and `two commits of the same file at once import once` (`Promise.all([post, post])`: `written` values are `[n, 0]` in some order; `raw_calls` +n). (Review Focus 1)
    - `a cross-site POST is refused and writes nothing` (`Sec-Fetch-Site: cross-site` and `same-site`: 403 `forbidden` on both routes; `same-origin`, `none` and no header pass). (Review Focus 2)
    - `no file field`, `a field named something else`, `two files`, `a text field instead of a file`, `a JSON body`, `no body`: 400 `bad_upload`, `field: 'file'`, nothing written.
    - `an empty file`, `a header-only file` (preview: 0 rows, ok; commit: `written` 0), `a PDF`, `an image`, `a text file`, `a file that matches no kind`, `matches more than one`: each a 400 `bad_upload` whose message includes the expected columns (not for header-only, which is 200 with all-zero counts).
    - `a file over the limit is 413 and nothing is read` (build a body of `UPLOAD_MAX_BYTES + 1` bytes; 413 `too_large`; the message says 10 MB). A file of exactly the limit is accepted by the limit check (a header-only file padded with a trailing comment is not valid CSV, so build it as a valid calls file of that size from repeated duplicate rows and assert only that the status is not 413).
    - `a file name with a path, markup or 300 characters is accepted and never used as a path` (`../../x<script>.csv`: the preview's `fileName` is cut to 100 characters, no file is created anywhere, `seeds.label` holds the text).
    - `a server with no uploads option answers upload_unavailable (409)` (`createApp(store)` only).
    - `a failed write is 500 upload_failed, the store is unchanged, a later commit works` (the trigger trick from Task 4 through the handle's database; `/api/meta` before and after equal).
    - `takeaways follow the data` (Review Focus 4 and Gap 11): with a fake `rebuildAi` that records the stores it was given and returns a fake service, a commit with new rows calls it once with the new store; a commit that writes nothing does not.
    - `routes other than the upload ones are still GET only` (`POST /api/overview` is not 200; the JSON 404 for an unknown API path is unchanged).
    - `an upload does not disturb a takeaway or view request already running` (start `/api/takeaway/overview` and a commit together: both finish, no 500).
  - `tests/server/upload-start.test.ts`: `start({ dataDir })` (in-memory) accepts an upload and serves it, over a real port with `fetch` and `FormData`; `start({ dbPath: tempFile, dataDir })` keeps it across a restart (`start({ dbPath: tempFile })` without `dataDir` serves the uploaded call); `RunningServer.close()` releases the file (delete works on Windows); existing `tests/server/start*.test.ts` unchanged and green.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run tests/server/config-upload.test.ts tests/db/handle.test.ts tests/server/upload-endpoint.test.ts tests/server/upload-start.test.ts` · Expected: FAIL.

- [ ] **Step 3: Implement** the handle, the service, the swappable `current` in `createApp`, the routes, the codes, the constant and the `start()` wiring. In `createApp`, replace the closed-over `store`, `span` and `ai` with reads of `current` inside each handler (no logic change); `errorResponse`, `crossSite` and `VIEW_TABLE` stay as they are. Run the **whole** server suite after the `current` refactor and before adding the routes, to show it is behavior-preserving.

- [ ] **Step 4: Run the whole suite.**

  Run: `npm test` · Expected: PASS, with no existing test file changed (`git diff --stat tests/` shows only new files).

- [ ] **Step 5: Commit**

```bash
git add src/db/handle.ts src/db/upload/service.ts src/db/prepare.ts src/server/uploadRoutes.ts src/server/api.ts src/server/config.ts src/server/app.ts src/server/start.ts tests/db/handle.test.ts tests/server/config-upload.test.ts tests/server/upload-endpoint.test.ts tests/server/upload-start.test.ts
git commit -m "feat: POST /api/upload previews and confirms an upload, and the server swaps its store without a restart"
```

---

### Task 6: The upload panel in the app

**Files:**
- Create: `src/web/models/uploadModel.ts`, `src/web/components/UploadPanel.tsx`
- Modify: `src/web/api.ts` (`postUpload`), `src/web/components/Header.tsx` (an "Upload data" button, props `onToggleUpload`, `uploadOpen`), `src/web/App.tsx` (panel state, like `dataNotesToggled`)
- Test: `tests/web/uploadModel.test.ts`, `tests/web/render-upload.test.tsx`, `tests/web/upload-api.test.ts`

**Interfaces:**
- Consumes: `UploadPreviewResponse`, `UploadCommitResponse`, `UploadPreview` (Task 5, Task 2), `fetchApi`-style error reading in `src/web/api.ts`, `defaultsHref` (`urlState.ts`).
- Produces:
  - `postUpload(mode: 'preview' | 'commit', file: File, signal?: AbortSignal, fetchFn?: typeof fetch): Promise<ApiResult<UploadPreviewResponse | UploadCommitResponse>>` (never throws; a dead server is the usual `network` error; the server's `bad_upload`, `too_large`, `upload_failed`, `forbidden` messages come back as they are).
  - `type UploadState = { step: 'choose' } | { step: 'checking'; fileName: string } | { step: 'preview'; fileName: string; preview: UploadPreview } | { step: 'saving'; fileName: string; preview: UploadPreview } | { step: 'done'; fileName: string; preview: UploadPreview; written: number } | { step: 'error'; fileName: string | null; message: string }` and a pure reducer `uploadReducer(state, action)` in `uploadModel.ts`.
  - `uploadModel(state: UploadState): UploadView` returns what to draw: `title`, `rows: { label: string; count: string; examples: string[] }[]` (the order is fixed: New calls (or New campaigns / New locations), New versions (calls only), Already stored, Conflicts (campaigns and locations only), Bad rows), `hints: string[]`, `badReasons: string[]` (e.g. `unknown campaign: 12`), `canConfirm: boolean` (true only in `preview` with `newRows + newVersions > 0`), `confirmLabel` (`Add 40 calls`; `Add 3 campaigns`), `emptyMessage` (shown when nothing can be added: `Nothing to add: every row is already stored.` / `Nothing to add: no row in this file can be stored.` / `This file has no rows.`), `done` text (`Added 40 new calls to the database.`), `seeNewDataHref` (`defaultsHref` of the current state, passed in).

- [ ] **Step 1: Write the failing tests**
  - `tests/web/uploadModel.test.ts` (pure): the order of `rows` per kind; counts formatted with thousands separators (`5,411`); `canConfirm` false for all-duplicates, header-only, and all-bad; true for 1 new row; the three `emptyMessage` cases; `confirmLabel` singular and plural (`Add 1 call`, `Add 2 calls`, `1 campaign`, `1 location`); `badReasons` sorted by count then name; `hints` passed through unchanged; `done` text; every example line reads `row 3: c_77 (new call)` style and shortens long ids; the reducer: `choose → checking → preview → saving → done`, `error` from each step, `reset` back to `choose`, choosing a new file while `preview` discards the old preview; a second `confirm` while `saving` is ignored (double click, Review Focus 1).
  - `tests/web/upload-api.test.ts`: `postUpload` sends a `POST` with a `FormData` holding the file under `file` to `/api/upload/preview` and `/api/upload/commit`; a 200 is `ok: true` with the body; a 400 `bad_upload` carries the server's message and `status`; a 413; a network failure is the usual `network` message; a non-JSON reply is `bad_response`.
  - `tests/web/render-upload.test.tsx` (`react-dom/server`, no DOM): the panel in `choose` has a file input that accepts `.csv,text/csv` and one button; `preview` shows the five labelled counts, the hints, the examples and a confirm button labelled `Add 40 calls`; the confirm button is **absent** (not just disabled) when `canConfirm` is false and the empty message shows; `saving` shows a busy message and no confirm button; `done` shows the added text and a link whose `href` equals `defaultsHref(state)` (it keeps `view` and `dev`, drops range and campaign: parse it with `parseUrlState`); `error` shows the message in an element with `role="alert"`; **text from the file is escaped**: a preview with id `<script>alert(1)</script>` and a file name `a"b<c>.csv` renders `&lt;script&gt;` and no raw `<script` (Review Focus 5); a very long file name and id do not appear in full (shortened); the header with `uploadOpen` false has no panel and with `true` has it; the print page (`state.print`) has no upload button (render `PrintShell` is not changed, assert the Header only is where the button lives by rendering `Header`); `Header` renders the button in normal mode and in dev mode.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run tests/web/uploadModel.test.ts tests/web/upload-api.test.ts tests/web/render-upload.test.tsx` · Expected: FAIL.

- [ ] **Step 3: Implement.** `uploadModel.ts` and the reducer are pure (no React, no `File`). `UploadPanel` is thin: a `<input type="file" accept=".csv,text/csv">`, on choose it posts `preview`, on confirm it posts `commit` with the **same `File` object**, and on `done` shows the link. Its link is a **plain `<a>`** (a full page load, Gap 8), not the in-app `Link`. Mount it in `ReadyShell` inside `RevealPresence` like the data notes panel, id `upload`, and focus the header button when it closes. Keep the file name out of the URL and out of `localStorage`. No arithmetic in the web: every count is formatted from the response.

- [ ] **Step 4: Run the new tests, then the whole suite and the build.**

  Run: `npm test && npm run typecheck && npm run build` · Expected: PASS. Existing web tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/web/models/uploadModel.ts src/web/components/UploadPanel.tsx src/web/api.ts src/web/components/Header.tsx src/web/App.tsx tests/web/uploadModel.test.ts tests/web/upload-api.test.ts tests/web/render-upload.test.tsx
git commit -m "feat: an upload panel shows what a CSV would add and only writes after confirm"
```

---

### Task 7: Done-when checks on the real exports, README, Docker pin

**Files:**
- Modify: `README.md`, `tests/docker/files.test.ts` (add assertions only)
- Test: `tests/snapshot/upload-totals.test.ts`

- [ ] **Step 1: Write the failing tests** (`tests/snapshot/upload-totals.test.ts`; in-memory database from `loadStore`, the HTTP app from Task 5, no real file)
  - `uploading the shipped calls.csv into a database seeded from it imports nothing and reports every row as a duplicate` (through `POST /api/upload/commit`: `written` 0, counts `{ rowsRead: 5411, duplicates: 5411, newRows: 0, newVersions: 0, conflicts: 0, bad: 0 }`; the store's totals still 5,000 calls, 1,204 bookings, $432,894, 144 unattributed). Done-when line 1.
  - `the same on the extended export` (`rowsRead: 6911`, totals `EXTENDED_TOTALS` from the existing snapshot test: import it, do not retype the numbers).
  - `uploading the extended calls.csv into a database seeded from the shipped one adds the new rows and the new versions` (counts: `newRows` + `newVersions` + `duplicates` = 6,911; duplicates 5,411; after commit the totals equal `EXTENDED_TOTALS` exactly and `readStore` equals `cleanExport` of the extended export field for field: the upload path and the CSV path cannot drift). Done-when line 2: new calls show in every view: assert `/api/overview`, `/api/campaigns`, `/api/locations`, `/api/missed-calls` JSON equal those of a server built from the extended export, for the three presets.
  - `the campaigns and locations files of the shipped export, uploaded into a database seeded from the same, are all duplicates` (12 and 8 rows).
  - `the AI snapshot id follows the upload` (`snapshotId(store)` before ≠ after the extended upload, and equals `snapshotId(cleanExport(extended))`; a cached takeaway keyed on the old id is not reused: use the fake model and cache from the existing AI tests: ask before, upload, ask after: the model is called again). Done-when edge case: "AI takeaways for ranges the upload changed are not reused from the cache".
  - `the same file uploaded twice imports nothing the second time` (extended, then extended again).
  - `a file written with a different column order, extra columns, a BOM and CRLF imports the same rows` (rewrite the extended `calls.csv` that way in memory; same counts as the original upload).
  - `docker`: in `tests/docker/files.test.ts` add `the image already holds what uploads need` (the Dockerfile copies `src/db` and `src/server`, creates `/app/db` owned by the runtime user, and `docker-compose.yml` mounts the data folder read-only and the `calls-db` volume read-write: assert each line; nothing else about the image changes).

- [ ] **Step 2: Run them to see them fail**, then **Step 3: make them pass.** The code needs no change here; a failure is a bug in Tasks 1 to 6, so fix it **there** (reopen that task's test first), not here.

  Run: `npx vitest run tests/snapshot/upload-totals.test.ts tests/docker/files.test.ts` · Expected: after fixes, PASS.

- [ ] **Step 4: README.** Add a section **Upload a CSV** after **Database**, and fix the lines it makes untrue ("Every route is GET only" becomes "Every route is GET only except the two upload routes"; the API table gains the two routes; the line that a new export means a restart gains "or an upload"):
  - what it takes: one CSV at a time, calls, campaigns or locations, found from the header columns, any order, extra columns fine, BOM and Windows line endings fine, **10 MB** limit;
  - the preview and the five counts, and that nothing is written until **Add**;
  - the order to use: **campaigns, locations, then calls** (a call naming one the database lacks is reported as bad, not stored, so the same file can be uploaded again after the fix);
  - the rules: calls match on `call_id` and `updated_at` (a stored match is a duplicate even if its other values differ, and the preview says how many); a new `updated_at` is a new version and the latest wins; campaigns and locations match on id, the same values are a duplicate, **different values are a conflict and are not written** (upload cannot change a budget); repeats inside the file are caught;
  - one transaction: a failure stores nothing;
  - views and takeaways update without a restart; the page reloads to the default range; the AI counters on the dev panel restart, spend does not;
  - bad rows from an upload are reported and not stored, so the header's skipped-rows count is unchanged by it;
  - **safety:** uploads are safe only because the server listens on localhost and there is no login; same-origin requests only; do not expose the port (the Docker compose file publishes only on 127.0.0.1);
  - with `DB_PATH=:memory:` an upload lasts until the server stops.

- [ ] **Step 5: Run everything and commit.**

  Run: `npm test && npm run typecheck && npm run build` · Expected: all PASS. Confirm `git status` shows no `data/calls.db`.

```bash
git add README.md tests/snapshot/upload-totals.test.ts tests/docker/files.test.ts
git commit -m "docs: S7 upload in the README, with the shipped export proven to import as all duplicates"
```

---

## Click-through checklist (run in the browser, show the results)

Start with `DB_PATH` pointing at a temp file seeded from `data/base` (`npm run seed -- data/base`, then `npm start`).

1. Header shows **Upload data**; the panel opens and closes; Escape or the button returns focus to the button. The print page has no upload button.
2. Choose `data/base/calls.csv`: the preview says calls, 5,411 rows, all already stored, no confirm button, "Nothing to add: every row is already stored."
3. Choose `data/extended/calls.csv`: calls, 1,500 new, 5,411 already stored (check the exact split against the test), the confirm button reads `Add 1,500 calls` (or the tested number). Press it twice fast: one import. The link "See the new data" loads the Overview at the default range; the as-of date, the totals and Locations flags match the extended export (README: four flags).
4. Choose `data/base/campaigns.csv`: all 12 already stored.
5. Choose a campaigns file where one id has a different budget: the conflict is listed with both values, not written.
6. Choose a calls file naming an unknown campaign: bad rows by reason `unknown_campaign` and the hint "Upload campaigns.csv first". Upload the campaigns, then the calls again: now they import.
7. Choose a `.png`, an empty file and a 12 MB file: each gives one plain message, nothing is stored.
8. Stop the server mid-way (kill it) and press confirm: the panel shows the network message, nothing breaks. Restart: the data is whatever the last confirmed upload left.
9. Dev mode (`?dev`): data notes show the new counts; the AI line shows the counters back at 0 after an upload and spend unchanged.

## Self-review

**Spec coverage** (PLAN.md S7, line by line):
- Upload control, one CSV at a time: Task 6 (panel, one `file` field; two files rejected, Task 5).
- Detect calls/campaigns/locations from header columns, any order; none or several rejected with the columns expected: Task 1.
- Existing validation per row, bad rows by reason: Tasks 2 and 3 (reuse `parseCampaigns`, `parseLocations`, `validateCall`).
- Duplicate checks before writing: calls by `call_id`+`updated_at` and new versions (Task 3, Gaps 2 and 6); campaigns and locations duplicate and conflict (Task 2, Gaps 4 and 5); duplicates inside the file (Tasks 2 and 3).
- Preview with the detected type, five counts, examples, nothing written until confirm: Tasks 3, 5, 6 (preview routes write nothing, tested).
- One transaction; the server rebuilds its `CallStore` without a restart: Tasks 4 and 5.
- Hono body parsing, no new package: Task 5 (`parseBody`, `hono/body-limit`).
- Done-when: shipped `calls.csv` into a seeded database imports nothing, every row a duplicate (Tasks 3 and 7); new calls show in every view right after confirm (Tasks 5 and 7); fixture tests for detection, every duplicate and conflict rule and the preview counts (Tasks 1 to 3); README (Task 7).
- Edge cases: column order, extra columns, BOM, CRLF (Tasks 1 and 7); empty, header-only, not CSV, over the limit (Tasks 1 and 5); unknown campaign or office with hint (Task 3); same file twice (Tasks 4 and 7); failure partway rolls back (Task 4, trigger-based, file and memory); AI cache not reused (Task 7); localhost-only safety in the README (Task 7) plus the same-origin check (Task 5).

**Step scan:** no step says "handle edge cases" or "add validation" without the case named; bodies appear only for exact user-facing messages and hints.

**Type consistency:** `UploadKind`, `ParsedUpload`, `UploadPlan`, `UploadPreview`, `UploadCounts`, `RowClass`, `UploadCommit`, `UploadService`, `DatabaseHandle`, `UploadRejected`, `UploadFailed` are defined once (Tasks 1, 2, 4, 5) and used with the same names. `planUpload` is the single planning entry for Tasks 4 and 5. `src/db` never imports `src/server` or `src/web`.

**Proportion:** PLAN.md's S7 is about 25 lines; this plan is longer because twelve rules the spec leaves open need your review, and the test lists are the deliverable you asked for. Code bodies are absent.
