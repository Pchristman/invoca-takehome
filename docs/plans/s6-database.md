# Phase S6 (Database, seeded from the CSVs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one SQLite file the store of record: `npm run seed` loads an export into it, and the server builds its `CallStore` from it, with every number, view and API response unchanged.

**Architecture:** A new `src/db/` folder holds the only SQLite code. Seeding runs the existing `loadExport` and writes every raw row (good and bad, all versions), the campaigns and locations, and a derived `cleaned_calls` table in one transaction. Reading rebuilds a `LoadedExport` from the raw tables and runs the **existing** `cleanExport`, so the dedupe, validation and data-notes rules stay in one place and the CSV path and the database path cannot drift apart. `start()` takes its store from the database; nothing downstream of `CallStore` changes.

**Tech Stack:** TypeScript (strict), vitest, Node 24's built-in `node:sqlite` (`DatabaseSync`). No new package.

**Spec:** `PLAN.md` ("S6: Database, seeded from the CSVs", section 5 data rules, section 6 "Dependencies" and "Freshness", section 8 Testing, Phase 10 Docker), `docs/BRIEF.md`, `CLAUDE.md`, the Phase 1, 2, 6, 9 and 10 plans in `docs/plans/` (loading, cleaning, server, the `snapshotId` cache key, Docker), `src/core/loadExport.ts`, `clean.ts`, `dedupe.ts`, `types.ts`, `src/node/readDataDir.ts`, `src/server/start.ts`, `cli.ts`, `src/ai/fromEnv.ts` (`snapshotId`), `Dockerfile`, `docker-compose.yml`.

## Global Constraints

- Work **one task at a time**. After the last task run `npm test`, `npm run typecheck` and `npm run build`, show the results, then **stop** and wait (CLAUDE.md).
- **No new dependency.** The driver is `node:sqlite`. Task 1 proves it does the job; if it cannot, stop and ask before adding `better-sqlite3` (PLAN.md section 6).
- **Every existing test passes unchanged.** The only existing files changed are `vitest.config.ts` (an env value), `.gitignore`, `.env.example`, `Dockerfile`, `docker-compose.yml`, `src/node/readDataDir.ts`, `src/server/start.ts`, `src/server/cli.ts`, `src/server/config.ts`, `package.json` (one script) and the README. If `tests/docker/files.test.ts` or `tests/repo-hygiene.test.ts` need a line for the new files, **add** assertions; never loosen one, and say so in the report.
- **No metric, view builder, API shape or sentence changes.** `src/core/views`, `metrics`, `src/ai` and `src/web` are not edited.
- Data rules stay in the core: the database code never dedupes, validates or localizes by itself except to write the derived `cleaned_calls` table from `cleanExport`'s output.
- **Tests use an in-memory database, never the real file.** `vitest.config.ts` sets `DB_PATH` to `:memory:` so even the spawned `cli.ts` tests cannot create `data/calls.db`. A few file-level edge cases (corrupt file, old schema, restart, zero-byte file) need a real file; they use a temp folder from `tempDir()`, never `data/calls.db`.
- No secrets. `data/calls.db` and its journal are gitignored; the database holds call data, not keys.
- Nothing hard-coded to this dataset: no names, ids, or dates in `src/db`.
- A database the app did not create in this run is **never deleted or overwritten** by the app (a user's later uploads, S7, would live in it).
- Stage files by name, never `git add -A`; run `git status` first and leave the uncommitted `docs/AI_COST_LOG.md` alone. Never read, print or add `.env`. Do not edit `docs/BRIEF.md`, `PLAN.md`, `CLAUDE.md`, and do not write to `docs/AI_COST_LOG.md`.
- Commit after each task, small, message says why, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Prefer simple, readable code; a reviewer will walk through all of it.

## Gaps in PLAN.md this plan fills

PLAN.md's S6 is clear on what and silent on several how-and-what-if points. Each is proposed here. **Please confirm or change them before I build.**

1. **What the server reads.** PLAN.md lists a `cleaned calls` table and also says the server builds its `CallStore` from the database. If the server read `cleaned_calls` directly, the data-notes numbers (ties, outcome lag, bad calls, unparseable dates) would need a second implementation or a second stored copy. **Proposal:** the server reads the raw tables, rebuilds a `LoadedExport` and runs the existing `cleanExport`. `cleaned_calls` is still written at seed time (it is what you query in SQL, and the snapshot totals can be read from it) but the app does not read it. A test proves the two agree. Rejected: reading `cleaned_calls` directly.
2. **Row identity for "the same export twice changes nothing".** CSV rows have no key; a call has several rows. **Proposal:** a row's identity is a SHA-256 of its fields plus the number of earlier identical rows **in the same file**. The same file gives the same identities, so a second seed adds nothing; a file that holds two identical rows keeps both (so `duplicateRowsCollapsed` matches the CSV path). A newer export adds only rows whose identity is new. Rejected: unique on `(call_id, updated_at)` (collapses a real tie, which the data notes count) and unique on `call_id` (loses versions).
3. **"Later row in the file wins" across seeds.** A `seq` number, assigned in insert order and shared by good and bad rows, replaces file position. Reading in `seq` order reproduces file order, so ties, first-appearance order of calls, and the AI `snapshotId` (a hash that includes call order) are unchanged.
4. **Campaigns and locations on a re-seed.** PLAN.md is silent (S7 defines conflicts for uploads). **Proposal:** upsert by id, the newer seed wins; ids missing from the newer export are kept, because stored calls still point at them. Rejected: refusing a changed budget (a budget edit is normal) and deleting absent ids (orphans calls).
5. **`npm start` after the data folder changed.** PLAN.md seeds only "when no database exists". So `DATA_DIR=data/extended npm start` next to an existing database built from the shipped export would silently show the shipped data, and in Docker a named volume does the same. This breaks the "never silently wrong data" spirit and the README's documented extended-export commands. **Proposal:** each seed records a SHA-256 of the three CSV files; at startup, if the data folder is readable and no recorded seed matches it, print one warning line (not an error) naming the fix. Rejected: reseeding automatically (mixes exports and breaks "nothing changes"), failing to start (a user may want the database as is).
6. **`start({ dataDir })` and `DB_PATH=:memory:`.** Existing tests call `start({ dataDir })` and spawn `cli.ts` with only `DATA_DIR`. **Proposal:** `start({ dataDir })` with no `dbPath` seeds a private in-memory database from that folder and reads from it, so all existing server tests now go through the database path; `DB_PATH=:memory:` means the same for `npm start`. The default `data/calls.db` is used only when neither is given.
7. **No reset flag.** An old-schema or corrupt file stops startup with a message that says to move the file aside and reseed. The app never deletes it. Exception: a file this run created and then failed to seed (bad CSV) is removed, so the next start tries again instead of finding an empty database.
8. **Empty states are not errors.** A seeded export with zero calls serves zero calls with a note (the same rule as an empty `calls.csv`). A file with zero bytes, or a valid SQLite file with no tables and `user_version` 0, holds nothing, so `npm start` seeds it. Only a file with data that cannot be trusted stops startup.

## Review Focus

Inputs the spec implies but no listed edge case names. Each has a test in the owning task.

1. **An export that contains two identical rows**, seeded twice: nothing is added the second time, and the first time stores both so the data notes match the CSV path. (Task 2)
2. **Empty versus zero versus missing values**: `revenue_usd` empty on a booked call vs `0`; empty `caller_number_hash` and `tracking_number` vs missing; unparseable `ended_at` and `updated_at`; names with quotes, commas, accents and SQL characters. They must come back exactly. (Tasks 2, 3)
3. **An export with zero calls, or a header-only calls file**: seeds, serves zero calls with a note, never crashes. (Task 5)
4. **A re-seed that fails halfway** (a bad CSV, or an error while writing): the existing database is byte-for-byte what it was, and no half-made file is left behind. (Tasks 2, 5)
5. **The AI cache after the switch**: `snapshotId` of the database store equals that of the CSV store, so cached takeaways stay valid. (Task 6)

---

## File Structure

```
src/db/database.ts     (create)  SCHEMA_VERSION, openDatabase, openExistingDatabase, schema DDL
src/db/seed.ts         (create)  seedExport, SeedSource, SeedReport
src/db/read.ts         (create)  readLoadedExport, readStore
src/db/cleaned.ts      (create)  refreshCleanedCalls
src/db/prepare.ts      (create)  loadStore (auto-seed, errors, stale-seed warning)
src/db/seedCommand.ts  (create)  runSeed(argv, env): the testable body of `npm run seed`
scripts/seed.ts        (create)  thin entry: loads .env, calls runSeed, sets the exit code
src/node/readDataDir.ts (modify) split out readExportTexts(dir) so seeding can hash the file text
src/server/config.ts   (modify)  parseDbPath
src/server/start.ts    (modify)  take the store from loadStore; RunningServer gains notices
src/server/cli.ts      (modify)  print notices
vitest.config.ts       (modify)  env DB_PATH ':memory:'
tests/db/*.test.ts, tests/server/start-db.test.ts, tests/snapshot/database-totals.test.ts (create)
```

---

### Task 1: Open the database, the schema version, and a driver that does the job

**Files:**
- Create: `src/db/database.ts`
- Test: `tests/db/database.test.ts`

**Interfaces:**
- Produces:
  - `const SCHEMA_VERSION = 1`
  - `openDatabase(path: string): DatabaseSync` opens (creating if needed) and prepares a database for seeding: `:memory:` or a file path, parent folder created, `PRAGMA foreign_keys = ON`, `PRAGMA busy_timeout = 5000`. When the file is empty (zero bytes, or `user_version` 0 with no tables) it creates the schema and sets `user_version = SCHEMA_VERSION` **inside one transaction**. Otherwise it checks the version and runs `PRAGMA quick_check`.
  - `openExistingDatabase(path: string): DatabaseSync` same checks, but a missing file or an empty one throws `LoadError` instead of creating it.
  - All failures are `LoadError` (from `src/core/errors`) with the messages below.
- Tables (all `STRICT`): `seeds`, `campaigns`, `locations`, `raw_calls`, `bad_rows`, `reference_issues`, `cleaned_calls`. Columns are fixed in Tasks 2 and 4; create the whole schema here.

- [ ] **Step 1: Write the failing tests** (`tests/db/database.test.ts`)
  - `driver: node:sqlite does the job on this Node` , in one in-memory database: a `STRICT` table with `INTEGER`, `REAL`, `TEXT` and NULL columns round-trips `0.1`, `''`, `NULL` and a 20-character name with `'`, `"`, `;` and an accent through bound parameters; a transaction that throws rolls back; a `UNIQUE` violation throws and the table is unchanged; `PRAGMA user_version` set and read back; `DatabaseSync.close()` then deleting a temp file succeeds on Windows.
  - `openDatabase(':memory:')` has all seven tables and `user_version` equals `SCHEMA_VERSION`.
  - `a zero-byte file is treated as empty and seeded with the schema`.
  - `a valid SQLite file with no tables is treated as empty` (create it with `new DatabaseSync(file)`, `exec('select 1')`, close).
  - `creates the parent folder` (temp folder + `a/b/calls.db`).
  - `a file that is not SQLite` (write `"hello, this is a csv"`) throws `LoadError` matching `/not a valid SQLite/`; the file is unchanged afterwards.
  - `an older schema` (a seeded temp file whose `user_version` is then set to 0 while the tables stay) throws `LoadError` matching `/schema version 0/` and `/move|delete/i` and `/reseed|npm run seed/`.
  - `a newer schema` (`user_version = 99`) throws matching `/newer version/`.
  - `a damaged file` (seed a temp file with a few rows, close it, flip bytes in the middle of the second page, reopen) throws `LoadError` matching `/damaged/`. If the flipped bytes do not trigger `quick_check` on this SQLite build, truncate the file to half its length instead.
  - `openExistingDatabase` on a missing path throws `LoadError` matching `/not found/`, and creates nothing.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run tests/db/database.test.ts` · Expected: FAIL (module not found). The `driver` test is the first to pass once the file exists; if `import 'node:sqlite'` itself fails under vitest, stop and report; that is the "driver does not do the job" case.

- [ ] **Step 3: Implement `src/db/database.ts`.** One DDL string; create-and-set-version in one `BEGIN IMMEDIATE ... COMMIT`. Messages (the path is shown as given):
  - not SQLite: `Cannot read the database ${path}: it is not a valid SQLite file. Move it aside and restart to build a new one from the CSVs.`
  - damaged: `The database ${path} is damaged (${detail}). Move it aside and restart to build a new one from the CSVs.`
  - older: `The database ${path} has schema version ${n}; this app needs ${SCHEMA_VERSION}. Move or delete the file, then run "npm run seed" (or restart) to build a new one.`
  - newer: `The database ${path} was made by a newer version of this app (schema version ${n}). Use that version, or move the file aside.`
  - not found (existing only): `Database not found: ${path}`.
  Catch `node:sqlite` errors at the open-and-first-statement boundary and convert; a message must never be an unhandled stack trace.

- [ ] **Step 4: Run the file's tests.** Expected: PASS.

- [ ] **Step 5: Commit** (if Step 2 shows the driver falls short, stop and ask instead)

```bash
git add src/db/database.ts tests/db/database.test.ts
git commit -m "feat: SQLite store opens with a schema version and refuses files it cannot trust"
```

---

### Task 2: Seed rows into the database, safe to repeat

**Files:**
- Create: `src/db/seed.ts`
- Test: `tests/db/seed.test.ts`, helper `tests/db/helpers.ts` (`csvTexts(rows)` builds the three CSV texts from small arrays; `memoryDb()` returns `openDatabase(':memory:')`)

**Interfaces:**
- Consumes: `openDatabase` (Task 1); `LoadedExport`, `RowResult`, `Call`, `BadRow` (`src/core/types`).
- Produces:
  - `interface SeedSource { label: string; hashes: { calls: string; campaigns: string; locations: string } }` (`label` is the folder as shown to the user; hashes are SHA-256 hex of each file's text, or empty strings for a test source).
  - `interface SeedReport { seedId: number; rowsRead: number; newRows: number; duplicateRows: number; newVersions: number; badRowsNew: number }` (`newRows` counts good and bad; `newVersions` counts new rows whose `call_id` already had a stored row before this seed).
  - `seedExport(db: DatabaseSync, loaded: LoadedExport, source: SeedSource, now?: Date): SeedReport` runs in **one** `BEGIN IMMEDIATE` transaction and rolls back on any throw. It writes: one `seeds` row; `campaigns` and `locations` upserted by id; `raw_calls` and `bad_rows` rows keyed by `row_key = sha256(JSON of the row's fields) + '#' + occurrence` with `INSERT ... ON CONFLICT(row_key) DO NOTHING`; `reference_issues` (unique on file, row number, reason, detail). `seq` is `max(seq over both tables) + 1`, in file order. Dates are stored as `toISOString()` text or NULL; booleans as 0/1; `revenue_usd` as REAL or NULL; empty strings stay `''`.
  - `raw_calls` columns: `seq INTEGER PRIMARY KEY, row_key TEXT UNIQUE NOT NULL, seed_id INTEGER NOT NULL, row_number INTEGER NOT NULL, call_id, started_at, ended_at NULL, duration_seconds INTEGER, caller_hash, tracking_number, campaign_id NULL, channel, location_id, answered INTEGER, outcome NULL, revenue_usd NULL, agent_id NULL, updated_at NULL`.
  - `bad_rows` columns: `seq PRIMARY KEY, row_key UNIQUE NOT NULL, seed_id, row_number, call_id, updated_at NULL, reason, detail`.

- [ ] **Step 1: Write the failing tests** (`tests/db/seed.test.ts`; fixtures are 3 to 8 rows, readable)
  - `seeding the same export twice adds nothing`: second report has `newRows` 0, `duplicateRows` equal to `rowsRead`; row counts in `raw_calls`, `bad_rows`, `campaigns`, `locations` are identical before and after; a second `seeds` row exists.
  - `an export with two identical rows keeps both, and a second seed still adds nothing` (Review Focus 1): `raw_calls` has 2 rows after the first seed, 2 after the second.
  - `a newer export adds only the new versions`: seed 3 rows (one call with one row); seed a file with those 3 plus a later row for the same `call_id` (later `updated_at`, outcome now `booked`, revenue 120); report `newRows` 1, `newVersions` 1; `raw_calls` has 4 rows and `seq` increases in file order.
  - `all versions are kept` (count of rows per `call_id` equals the file's).
  - `bad rows are stored with their reason and never in raw_calls`: a row with an unknown location and a row with a bad timestamp end up in `bad_rows` with `reason` `unknown_location` and `bad_timestamp` and a non-empty `detail`; `raw_calls` has none of their ids unless another good row shares the id.
  - `bad rows are not duplicated by a second seed`.
  - `campaign values are upserted: the newer seed wins, ids missing from it are kept`: seed budget 100 for `cmp_a` and `cmp_b`; seed `cmp_a` at 150 only; `cmp_a` is 150 and `cmp_b` still exists.
  - `reference issues (a skipped campaign row) are stored once`.
  - `null, empty and zero come back exactly` (Review Focus 2, stored side): a booked call with empty revenue stores NULL, a booked call with `0` stores `0.0` (distinct), empty `caller_hash` stores `''`, an unparseable `ended_at` and `updated_at` store NULL; a campaign named `O'Brien; DROP TABLE x -- "Café, Ltd"` is stored verbatim.
  - `a failure partway rolls everything back` (Review Focus 4): pass a `LoadedExport` whose second row has a `channel` that violates a `CHECK` (or a `Call` with `NaN` duration, which a STRICT `INTEGER` column rejects), call `seedExport` inside `expect(...).toThrow()`, then assert every table is exactly as before (counts, and the `seeds` row count).
  - `two seeds in a row after a failed one still work` (the failed one leaves no `seeds` row).

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run tests/db/seed.test.ts` · Expected: FAIL (module not found).

- [ ] **Step 3: Implement `seedExport`.** Prepared statements with bound parameters only; never build SQL from data. Occurrence counting is a `Map<string, number>` over the file's rows in order. Row field serialization for the hash must be the exact stored values (so a re-read file hashes the same); `rowNumber` is **not** part of the hash. Add a `CHECK(channel IN (...))` and `CHECK(outcome IS NULL OR outcome IN (...))` in the DDL from `CHANNELS` and `OUTCOMES` so a bad value cannot be stored. (Edit `database.ts` DDL accordingly.)

- [ ] **Step 4: Run the file's tests.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/seed.ts src/db/database.ts tests/db/seed.test.ts tests/db/helpers.ts
git commit -m "feat: seed raw rows into SQLite with a stable row identity so repeat seeds change nothing"
```

---

### Task 3: Read the database back into the same `LoadedExport`

**Files:**
- Create: `src/db/read.ts`
- Test: `tests/db/read.test.ts`

**Interfaces:**
- Consumes: `seedExport`, `SeedSource` (Task 2); `loadExport`, `cleanExport`.
- Produces:
  - `readLoadedExport(db: DatabaseSync): LoadedExport`: `rows` are `raw_calls` and `bad_rows` merged and ordered by `seq` (`RowResult`: dates revived with `new Date(text)`, NULL back to `null`, `0/1` to boolean); `campaigns` and `locations` in first-insert order; `rowsRead = rows.length`; `badByReason` counted from `bad_rows` with every reason present; `unparseableUpdatedAt` and `unparseableEndedAt` counted as `loadExport` counts them; `referenceIssues` in insert order; `notes` is `["The database holds no calls: starting with zero calls"]` when there are no rows at all, else `[]`.
  - `readStore(db: DatabaseSync): CallStore` is `cleanExport(readLoadedExport(db))`.

- [ ] **Step 1: Write the failing tests** (`tests/db/read.test.ts`)
  - `round trip equals the CSV path on a hand-written messy export`: a fixture with a three-row call arriving out of order, an `updated_at` tie, a bad latest row over a good older row, an empty campaign, revenue on a non-booked row, a booked call with empty revenue, a pending call, a call at 02:00 UTC, Phoenix and Denver offices, an unknown location, a bad timestamp, an unparseable `updated_at` and `ended_at`, and the `O'Brien...` campaign name. Assert `expect(readStore(db)).toEqual(cleanExport(loadExport(texts)))` (whole `CallStore`, `dataNotes` included).
  - `empty values come back as empty values` (Review Focus 2, read side): the booked call with empty revenue has `revenueUsd` 0 and `dataNotes.bookedWithoutRevenueCalls` 1; a booked call with `0` is not counted there.
  - `a database seeded twice reads the same as seeded once` (`toEqual`).
  - `rows come back in file order across two seeds` (call ids in `store.calls` equal first-appearance order).
  - `a newer version wins` (seed, then seed a newer row for one call; the call's outcome and revenue are the newer ones; `duplicateRowsCollapsed` is 1).
  - `a bad latest row after a good one makes the call bad, across two seeds` (the rule survives the split).
  - `a database with no rows reads as zero calls with the note`.
  - `the shipped export: readStore equals cleanExport` (use `tests/fixtures/original-export`, `readExportTexts` is not available yet; read the three files with `readFileSync` in the test) and the same for `data/extended`. `toEqual` on the whole store.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run tests/db/read.test.ts` · Expected: FAIL (module not found).

- [ ] **Step 3: Implement `readLoadedExport` and `readStore`.** One query per table, `ORDER BY seq`; wrap any `node:sqlite` error from the reads in a `LoadError` with the "damaged" message from Task 1.

- [ ] **Step 4: Run the file's tests.** Expected: PASS. If the `toEqual` on a real export fails, the difference is the bug (likely a date, a `null` vs `''`, or order); fix the read, not the test.

- [ ] **Step 5: Commit**

```bash
git add src/db/read.ts tests/db/read.test.ts
git commit -m "feat: rebuild the loaded export from SQLite so cleanExport stays the one cleaning code path"
```

---

### Task 4: The derived `cleaned_calls` table

**Files:**
- Create: `src/db/cleaned.ts`
- Modify: `src/db/seed.ts` (call it as the last step inside the seed transaction)
- Test: `tests/db/cleaned.test.ts`

**Interfaces:**
- Consumes: `readStore` (Task 3).
- Produces: `refreshCleanedCalls(db: DatabaseSync): number` deletes and refills `cleaned_calls` from `readStore(db).calls` and returns the row count. Columns: `call_id TEXT PRIMARY KEY, started_at, duration_seconds, caller_hash, tracking_number, campaign_id NULL, unattributed, channel, location_id, answered, outcome NULL, booked, pending, revenue_usd REAL, agent_id NULL, local_date, local_hour, local_weekday` (booleans 0/1). `SeedReport` gains `callsAfter: number` (the returned count).

- [ ] **Step 1: Write the failing tests** (`tests/db/cleaned.test.ts`)
  - `one row per call_id: the latest updated_at wins` (a call with three rows seeded out of order; one row, the latest outcome).
  - `bad calls are never in cleaned_calls` (a call whose latest row is bad is absent; a call with an unknown location is absent).
  - `a newer seed replaces the row for a call and adds new calls` (count and values after the second seed).
  - `seeding twice leaves cleaned_calls unchanged` (rows compared before and after, `toEqual`).
  - `cleaned_calls matches readStore(db).calls field for field on the messy fixture from Task 3` (compare the SQL rows mapped to `CleanCall` against `store.calls`, including `local_date`, `local_hour`, `local_weekday`, Phoenix and the 02:00 UTC call).
  - `revenue is counted only on booked calls` (`SELECT SUM(revenue_usd) FROM cleaned_calls WHERE booked = 0` is 0, though a raw row carried revenue).
  - `unattributed calls are kept with campaign_id NULL`.
  - `the totals on the shipped export, read by SQL`: `COUNT(*)` 5000, bookings 1204, `SUM(revenue_usd)` 432894, unattributed 144.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run tests/db/cleaned.test.ts` · Expected: FAIL.

- [ ] **Step 3: Implement `refreshCleanedCalls`** and call it at the end of `seedExport` before `COMMIT`, filling `callsAfter`.

- [ ] **Step 4: Run all `tests/db`.** Expected: PASS (Task 2 and 3 tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/db/cleaned.ts src/db/seed.ts tests/db/cleaned.test.ts
git commit -m "feat: keep a queryable cleaned_calls table, written in the same transaction as the seed"
```

---

### Task 5: Load the store at startup: seed when missing, clear errors otherwise

**Files:**
- Create: `src/db/prepare.ts`
- Modify: `src/node/readDataDir.ts` (add `readExportTexts(dir?: string): ExportTexts` and `interface ExportTexts { calls: string; campaigns: string; locations: string; folder: string }`; `readExportFromDir` calls it; behaviour and messages unchanged)
- Test: `tests/db/prepare.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 4; `readExportTexts`; `loadExport`.
- Produces:
  - `seedFromTexts(db: DatabaseSync, texts: ExportTexts): SeedReport` hashes the three texts, runs `loadExport`, calls `seedExport` with `source = { label: texts.folder, hashes }`.
  - `interface LoadedStore { store: CallStore; notices: string[] }`
  - `loadStore(options: { dbPath: string; dataDir?: string }): LoadedStore`:
    - `dbPath === ':memory:'`: open, seed from the data folder, read, close.
    - Otherwise, file missing, zero bytes, or empty (Task 1's rule): create and seed from the data folder, read, close. Notice `Seeded ${dbPath} from ${folder}: ${calls} calls.` If seeding throws and **this call created the file**, remove the file, then rethrow.
    - Otherwise: `openExistingDatabase`, read, close. The data folder is **not** needed; a missing data folder with an existing database is fine.
    - A zero-call result adds the note from `readLoadedExport` to `store.dataNotes.notes` (it already does through `cleanExport`) and prints nothing else.
    - Always closes the database, also on error (Windows file locks).
    - A missing data folder with no database throws the existing `LoadError` (`Data folder not found: ...`), so the existing one-line `Cannot start:` output is unchanged.

- [ ] **Step 1: Write the failing tests** (`tests/db/prepare.test.ts`; temp folders from `tests/server/helpers.ts` `tempDir()` for file cases, CSV folders written with `csvTexts`)
  - `:memory: seeds from the folder and returns its store` (equals `cleanExport(readExportFromDir(dir))`).
  - `a missing file is created and seeded; a second loadStore reads it without seeding` (spy: the second call's `notices` has no "Seeded" line, and the `seeds` table still has one row, checked by reopening read-only).
  - `a restart sees an upload-sized change: a row added to the file by seedExport after the first start shows on the next start` (open, `seedExport` a newer export, close; `loadStore` returns the new call).
  - `a zero-byte file is seeded` and `a SQLite file with no tables is seeded`.
  - `an export with zero calls (header-only calls.csv) seeds and serves zero calls with the note` (Review Focus 3). A `calls.csv` with no header at all is still a `LoadError` (missing column), as in the CSV path; assert that on a first seed it removes the file this run created (Review Focus 4).
  - `a bad CSV on first seed leaves no database file behind`.
  - `an existing database is never touched by a failed start`: write a seeded file, copy its bytes, call `loadStore` with a `dataDir` whose `calls.csv` lacks a column (it must not even read it), assert bytes equal.
  - `a corrupt file is a LoadError with the message from Task 1, and is not overwritten`.
  - `an older-schema file is a LoadError and is not overwritten`.
  - `an existing database with a missing data folder starts fine`.
  - `no database and no data folder is the existing Data folder not found error`.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run tests/db/prepare.test.ts tests/node/readDataDir.test.ts` · Expected: prepare tests FAIL; `readDataDir` tests still PASS.

- [ ] **Step 3: Implement** `readExportTexts`, `seedFromTexts` and `loadStore`. Remove-on-failure only when `existsSync(path)` was false (or size 0) **before** this call.

- [ ] **Step 4: Run both files.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/prepare.ts src/node/readDataDir.ts tests/db/prepare.test.ts
git commit -m "feat: startup seeds a missing database and refuses, never overwrites, one it cannot trust"
```

---

### Task 6: Wire the server to the database, with the stale-seed warning

**Files:**
- Modify: `src/db/prepare.ts` (stale check), `src/server/config.ts` (`parseDbPath`), `src/server/start.ts`, `src/server/cli.ts`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Test: `tests/db/stale.test.ts`, `tests/server/start-db.test.ts`, `tests/snapshot/database-totals.test.ts`, `tests/server/config-db.test.ts`; add assertions to `tests/repo-hygiene.test.ts`

**Interfaces:**
- Consumes: `loadStore` (Task 5).
- Produces:
  - `parseDbPath(value: string | undefined): string` in `config.ts`: unset or blank gives `data/calls.db`; otherwise the trimmed text (`:memory:` allowed).
  - `StartOptions.dbPath?: string`. Resolution in `start()`: `options.dbPath`, else `:memory:` when `options.dataDir` is given and not blank, else `parseDbPath(process.env.DB_PATH)`.
  - `RunningServer.notices: string[]` (from `loadStore`, plus the stale warning). `cli.ts` prints them after the "Serving" line.
  - `staleSeedWarning(db, texts: ExportTexts, dbPath: string): string | null` (inside `loadStore`'s existing-file branch): if the data folder's three files can be read and no `seeds` row has all three hashes equal, return `The CSVs in ${folder} are not what ${dbPath} was seeded from, so the app is showing the database. Run "npm run seed" to add them, or move ${dbPath} aside to start fresh.`; if the files cannot be read, return `null`. A first-seed run never warns.
  - `.gitignore` gains `data/*.db` and `data/*.db-journal`; `.env.example` gains `DB_PATH=` with a one-line comment (default `data/calls.db`; `:memory:` seeds from the CSVs on every start).
  - `vitest.config.ts` `test.env` gains `DB_PATH: ':memory:'`, with a comment saying no test may touch the real file.

- [ ] **Step 1: Write the failing tests**
  - `tests/server/config-db.test.ts`: unset, blank and spaces give `data/calls.db`; `:memory:` and `tmp/x.db` pass through trimmed.
  - `tests/db/stale.test.ts` (temp files): `no warning when the folder's files are what was seeded`; `a warning naming the folder and the fix when the folder holds a different export`; `no warning when the folder is missing` (Docker without a mount); `no warning after a second seed of the other export` (any recorded seed matches); `the warning does not stop the load` (store still returned).
  - `tests/server/start-db.test.ts`:
    - `start({ dataDir })` with no `dbPath` uses an in-memory database: `data/calls.db` is not created (assert `existsSync('data/calls.db')` is the same before and after; the test also fails on a poisoned `process.env.DB_PATH` set to a temp file path: after `start({ dataDir })` that file does not exist).
    - `start({ dbPath: tempFile, dataDir })` seeds the file, serves `/api/overview` with the same JSON as a server started the CSV way would (`createApp(cleanExport(readExportFromDir(dir)))`), and a second `start({ dbPath })` with **no** `dataDir` and a missing data folder serves the same JSON without reseeding.
    - `RunningServer.notices` carries the stale warning.
    - `start` rejects with `LoadError` for a corrupt `dbPath`, and the file is not changed.
  - `tests/snapshot/database-totals.test.ts` (the Done-when line): for the shipped export and for `data/extended`, `readStore` through an in-memory seeded database `toEqual` the CSV store; the totals equal 5,000 / 1,204 / $432,894 / 144 (shipped) and `EXTENDED_TOTALS` (extended: calls 6400, bookings 1470, revenue 531431); and `/api/overview` served from the database store equals the CSV one for the three presets. This covers "snapshot totals match exactly".
  - `snapshotId(readStore(db))` equals `snapshotId(cleanExport(csv))` on both exports (Review Focus 5; import from `src/ai/fromEnv`).
  - `repo-hygiene.test.ts`: `.gitignore` contains `data/*.db` and `data/*.db-journal`; `.env.example` has `^DB_PATH=` and documents it; no file under `tests/` mentions `data/calls.db` (read every test file as text).

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run tests/server/config-db.test.ts tests/db/stale.test.ts tests/server/start-db.test.ts tests/snapshot/database-totals.test.ts tests/repo-hygiene.test.ts` · Expected: FAIL.

- [ ] **Step 3: Implement** the options, `parseDbPath`, the stale check and the `cli.ts` printing; edit `vitest.config.ts`, `.gitignore` and `.env.example`.

- [ ] **Step 4: Run the whole suite.**

  Run: `npm test` · Expected: PASS, with no change to any existing test file (verify with `git diff --stat tests/` showing only the new files and the `repo-hygiene.test.ts` additions). Confirm `ls data/` shows no `calls.db` afterwards.

- [ ] **Step 5: Commit**

```bash
git add src/db/prepare.ts src/server/config.ts src/server/start.ts src/server/cli.ts vitest.config.ts .gitignore .env.example tests/db/stale.test.ts tests/server/config-db.test.ts tests/server/start-db.test.ts tests/snapshot/database-totals.test.ts tests/repo-hygiene.test.ts
git commit -m "feat: the server builds its CallStore from the database; a changed data folder is warned about, not ignored"
```

---

### Task 7: `npm run seed`

**Files:**
- Create: `src/db/seedCommand.ts`, `scripts/seed.ts`
- Modify: `package.json` (script `"seed": "tsx scripts/seed.ts"`)
- Test: `tests/db/seedCommand.test.ts`

**Interfaces:**
- Consumes: `openDatabase`, `readExportTexts`, `seedFromTexts` (Tasks 1, 5), `parseDbPath` (Task 6).
- Produces: `runSeed(args: string[], env: NodeJS.ProcessEnv): { exitCode: 0 | 1; lines: string[] }`. The folder is the first non-flag argument, else `DATA_DIR`, else the current folder; the file is `parseDbPath(env.DB_PATH)`. `:memory:` is refused (`Cannot seed: DB_PATH is :memory:, so there is no file to seed. Set DB_PATH to a file.`). Success prints, in one block: `Seeded ${dbPath} from ${folder} (seed #${id}).`, `${rowsRead} rows read: ${newRows} new, ${duplicateRows} already stored, ${newVersions} new versions of existing calls, ${badRowsNew} bad.`, `${callsAfter} calls in the database.` and the line `A running server keeps the data it started with; restart it to see this.`. A `LoadError` or database error prints one `Cannot seed: ...` line and exit code 1. `scripts/seed.ts` calls `loadDotEnv()`, then `runSeed(process.argv.slice(2), process.env)`, prints, sets `process.exitCode`.

- [ ] **Step 1: Write the failing tests** (`tests/db/seedCommand.test.ts`; temp files)
  - `the first seed reports every row as new and the second as already stored` (exact numbers on a 6-row fixture).
  - `a newer export reports new versions` and the database now has them.
  - `seeding while a server holds its snapshot`: `start({ dbPath, dataDir })`, run `runSeed` against the same file, assert the running server's `/api/overview` is unchanged, then a second `start({ dbPath })` shows the new call (the README line is a tested fact).
  - `DB_PATH=:memory: is refused with exit code 1`.
  - `a missing data folder is one Cannot seed line, exit 1, and no file created`.
  - `a bad CSV on a re-seed leaves the existing file byte-for-byte unchanged`.
  - `a corrupt database file is a Cannot seed line and is not modified`.
  - `the folder argument beats DATA_DIR`.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run tests/db/seedCommand.test.ts` · Expected: FAIL.

- [ ] **Step 3: Implement** `runSeed` and the entry script.

- [ ] **Step 4: Run the file's tests, then try it by hand** in a temp folder: `DB_PATH=%TEMP%\s6.db npm run seed -- data/base`, run it again (all rows "already stored"), then `DB_PATH=... npm start` and open `http://127.0.0.1:3000` (do not leave a `data/calls.db` behind; delete the temp file after). Expected: PASS and the two outputs in the report.

- [ ] **Step 5: Commit**

```bash
git add src/db/seedCommand.ts scripts/seed.ts package.json tests/db/seedCommand.test.ts
git commit -m "feat: npm run seed loads or tops up the database from a CSV folder and says what changed"
```

---

### Task 8: Docker and README

**Files:**
- Modify: `Dockerfile`, `docker-compose.yml`, `README.md`; `tests/docker/files.test.ts` (add assertions only)

**Interfaces:**
- Dockerfile runtime stage: `ENV DB_PATH=/app/db/calls.db`, `COPY src/db ./src/db`, and `RUN mkdir -p .cache logs db && chown node:node .cache logs db` (the existing `mkdir` line is extended). Compose: a named volume `calls-db:/app/db` beside `ai-cache` and `ai-logs`; `DB_PATH` is **not** passed through from `.env` (same reason as `HOST`, `PORT`, `DATA_DIR`).

- [ ] **Step 1: Write the failing tests** (added to `tests/docker/files.test.ts` using its existing `readText` helper)
  - `Dockerfile copies src/db and creates a db folder owned by the runtime user`.
  - `Dockerfile sets DB_PATH inside the volume folder, and compose mounts a named volume there`.
  - `compose does not pass DB_PATH through`.
  - `nothing the Dockerfile COPYs is excluded by .dockerignore` (the existing test already covers `src/db` once the Dockerfile is edited; confirm it still passes).
  - `.dockerignore still excludes data (the database file never enters the image)`.

- [ ] **Step 2: Run to see them fail**

  Run: `npx vitest run tests/docker/files.test.ts` · Expected: the new tests FAIL.

- [ ] **Step 3: Edit the Dockerfile and compose file** as above, then the README:
  - **What S6 added**: the database file and `DB_PATH` (default `data/calls.db`, gitignored); `npm run seed [folder]`; that `npm start` seeds when the file is missing and reads it afterwards; that re-seeding the same export changes nothing, a newer one adds versions, and the latest `updated_at` wins; the tables (`raw_calls`, `bad_rows`, `campaigns`, `locations`, `reference_issues`, `cleaned_calls`, `seeds`) and that the app reads the raw tables and `cleaned_calls` is a derived copy for SQL.
  - **Limits**: a running server keeps its snapshot until restart (also after `npm run seed`); one process at a time should write; moving to another folder needs `npm run seed <folder>` or moving the file aside, and the startup warning says so; an old-schema or corrupt file stops startup and is never deleted by the app.
  - **Docker**: the file is on the `calls-db` volume and is seeded on first run; `DATA_DIR=data/extended docker compose up --build` after a first run shows the warning in `docker compose logs`; to start fresh, `docker compose down -v` (this also clears the AI cache and call log, so copy `ai-logs` first if you need the spend history).
  - Fix the README lines that say a new export means only a restart, and the extended-export commands (add the first-run vs later-run note).

- [ ] **Step 4: Run the whole suite, typecheck and build.**

  Run: `npm test && npm run typecheck && npm run build` · Expected: all PASS. If Docker is installed, also run `npm run test:docker`, and by hand: `docker compose up --build` then `docker compose down` then `docker compose up` (the second start prints no "Seeded" line) and `docker compose down -v`. If Docker is not installed, say so in the report; do not claim the Docker line verified.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml README.md tests/docker/files.test.ts
git commit -m "docs: S6 in Docker and the README, with the database limits written down"
```

---

## Click-through checklist (run in the browser, show the results)

1. Fresh clone state: delete `data/calls.db` if present, `npm start`: the log says it seeded, all four views load on the shipped export; the totals in the data notes (`?dev`) read 5,000 calls and 144 unattributed.
2. Stop and `npm start` again: no "Seeded" line, same numbers.
3. `npm run seed` twice: the second run says every row is already stored.
4. `DATA_DIR=data/extended npm start` against the existing file: the warning line appears and the app still serves the shipped numbers.
5. `npm run seed data/extended`, restart: Locations flags offices (as in the README), and the data notes show the extended counts.
6. Point `DB_PATH` at a text file: `Cannot start: ...not a valid SQLite file...`, exit code 1, the file is unchanged.
7. Print and the AI marker still work (spot check: nothing in S6 touches them).

## Self-review

**Spec coverage** (PLAN.md S6, line by line):
- SQLite store of record at `DB_PATH` default `data/calls.db`, gitignored: Tasks 1, 6.
- `npm run seed` through the existing load, validate and clean steps; tables for every raw row (all versions), campaigns, locations, bad rows, cleaned calls: Tasks 2 to 4, 7.
- Safe to repeat; newer export adds versions, latest wins: Tasks 2, 3, 4 tests.
- Server builds its `CallStore` from the database; views and API unchanged: Task 6 (JSON equality on three presets).
- `npm start` seeds when no database exists: Tasks 5, 6.
- Driver `node:sqlite` unless it falls short: Task 1 driver test.
- Done-when: snapshot totals on both exports (Task 6), existing tests unchanged (Task 6 step 4), fresh clone seed then restart without reseed (Task 5, checklist), Docker volume seeded on first run (Task 8), README (Task 8).
- Edge cases: same export twice (T2), newer version (T2, T3, T4), bad rows with reason and never in cleaned calls (T2, T4), missing or corrupt file (T1, T5, T6), older schema (T1, T5), seeding while the server runs (T7), in-memory tests (Global Constraints, T6 guard test).

**Type consistency:** `SeedSource`, `SeedReport` (gains `callsAfter` in Task 4), `ExportTexts` (Task 5) and `LoadedStore` are named the same wherever they are used; `loadStore` takes `{ dbPath, dataDir }` in Tasks 5 and 6.

**Proportion:** PLAN.md's S6 is 20 lines; this plan is longer because eight decisions the spec leaves open need your review. Code bodies are absent except the messages the user will read.
