# Phases 0 and 1: Scaffold, Load and Validate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TypeScript + vitest repo where `npm test` runs, and a pure loader that turns the three CSVs into typed records plus a bad-row report by reason.

**Architecture:** A pure core takes CSV *text* and returns a `LoadedExport`; a thin Node layer reads the files from `DATA_DIR`. Every raw `calls.csv` row yields either a typed `Call` or a `BadRow`, in file order, with duplicates **not** collapsed. Deduping is Phase 2, and it needs to see bad rows too (PLAN.md section 5, rule 2).

**Tech Stack:** Node 24, TypeScript (strict), vitest, csv-parse. No other runtime dependencies.

**Spec:** `PLAN.md` (sections 5 and 9, Phases 0 and 1), `docs/BRIEF.md`, `CLAUDE.md`.

## Global Constraints

- Work **one task at a time**. After the last task, run `npm test`, show the output, then **stop** and wait (CLAUDE.md).
- **Ask before adding each dependency**, at the start of the phase that needs it (CLAUDE.md, PLAN.md section 6). Approved list for this plan: `typescript`, `vitest` (Task 1), `csv-parse` (Task 2). `@types/node` is *not* on PLAN.md's list; it needs a `docs/DECISIONS.md` line (already added) and the user's yes.
- Match CSV columns **by header name**, never position. Extra columns ignored. Missing required column stops startup naming the file and column. (rule 1)
- Bad rows are counted by reason and **never crash** the app. A malformed *file* (missing file, missing column, broken quoting) is a `LoadError` with a clear message. (rules 1 and 3)
- Nothing hard-coded to this dataset: no campaign names, office names, IDs or dates in `src/`. Enums (`outcome`, `marketing_channel`) are the column contract and may live in code. (rule 11)
- Never commit secrets. `.env` is gitignored and **already exists with a real key in it**: never read, print or `git add` it.
- Do not write to `docs/AI_COST_LOG.md` or edit `docs/BRIEF.md`.
- Commit after each task, small, message says why. Every commit message ends with:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- Prefer simple, readable code. No clever abstractions; a reviewer will walk through all of it.

## Issues found in PLAN.md (decide before or during review)

1. **Phase 1 vs rule 2 ordering.** Rule 2 says dedupe happens *before* validation chooses rows, but Phase 1 (validation) comes before Phase 2 (dedupe). Resolution used here: Phase 1 validates **every raw row** and returns all of them (typed or bad, file order, each carrying `callId`, `updatedAt`, `rowNumber`). Phase 2 dedupes first, then looks at whether the winner is bad. So Phase 1's bad-row counts are **per raw row**; Phase 2 must re-report **per call**. "5,411 rows" is a raw row count, so the done-when still holds.
2. **Rule 3 is silent on inputs that would otherwise produce NaN or merge unrelated calls.** I propose three extra reasons, flagged in `docs/DECISIONS.md` as proposed: `missing_call_id` (empty call_id would collapse unrelated calls in Phase 2), `bad_duration` (covers negative *and* empty/non-integer; negative is the case the spec names), `bad_revenue` (non-numeric or negative revenue; empty is fine). Strike any you disagree with.
3. **Timestamp strictness is unspecified.** I use strict ISO 8601 UTC (`...Z` only, real calendar date). Offsets and `2026-02-30` are bad. `ended_at` and `updated_at` that don't parse are **not** bad rows (rule 2 already says unparseable `updated_at` loses a dedupe; `ended_at` feeds nothing).
4. **Campaign/location file problems are unspecified** beyond the invalid IANA zone. I report them as `ReferenceIssue`s and skip the row (see Task 4), instead of crashing.
5. **Phase 0 says `npm test` runs an "empty suite"**, but a gitignore/secret hygiene test is cheap and guards the "never commit secrets" rule. Task 1 first proves the empty suite passes, then adds that one test.
6. **A real `.env` and two unlisted files exist** (`notes.md`, `NOTES.local.md`). `NOTES.local.md` is gitignored. `notes.md` is not, and I have not read it. Task 1 asks you before it is committed.
7. **Clean-clone check** can't be done until something is committed, so Task 1 ends with a `git clone` into a temp dir and `npm ci && npm test` there.

## Review Focus

Inputs the spec implies but doesn't list. Each has a test in the owning task.

1. **UTF-8 BOM at the start of a file** (Excel "CSV UTF-8" export). First header must still match `call_id`. (Task 2)
2. **Header-only file vs zero-byte file.** Both give zero rows and a note; header-only still checks required columns, zero-byte can't. (Task 2, Task 6)
3. **Impossible or offset timestamps** (`2026-02-30T10:00:00Z`, `...+02:00`, no `Z`) are bad rows, not silently shifted by `Date.parse`. (Task 3)
4. **Padding and case in values** (`" TRUE "`, trailing spaces in `campaign_id`) match as the clean value; no false "unknown campaign". (Tasks 3 and 5)
5. **Bad reference data**: duplicate campaign ids, non-numeric or negative budget, empty location timezone. Reported, never a crash; calls pointing at a dropped campaign become `unknown_campaign`. (Task 4)

---

## File Structure

```
package.json, package-lock.json, tsconfig.json, vitest.config.ts
.env.example, .gitignore (modify), README.md
src/core/types.ts        types + enums: the contract between tasks
src/core/errors.ts       LoadError
src/core/csv.ts          readTable: text -> header-keyed rows, required-column check
src/core/fields.ts       pure field parsers (timestamp, boolean, enum, integer, money, time zone)
src/core/reference.ts    parseCampaigns, parseLocations
src/core/validate.ts     validateCall: one raw row -> Call | BadRow
src/core/loadExport.ts   loadExport: three texts -> LoadedExport (pure)
src/node/readDataDir.ts  readExportFromDir: reads the three files (the only I/O)
tests/repo-hygiene.test.ts
tests/core/*.test.ts     one test file per src/core file
tests/node/readDataDir.test.ts
tests/snapshot/original-export.test.ts
tests/fixtures/original-export/{calls,campaigns,locations}.csv   copy of the shipped export
```

---

### Task 1: Phase 0 scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `README.md`, `tests/repo-hygiene.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm test` (vitest run), `npm run typecheck` (tsc --noEmit). Later tasks put tests in `tests/**/*.test.ts` and source in `src/`.

- [ ] **Step 1: Ask the user to approve dependencies** `typescript`, `vitest`, `@types/node` (dev). Stop if not approved. Also ask what to do with untracked `notes.md` (commit, ignore, or leave out). Do not open `.env`.
- [ ] **Step 2: `git init`, then verify nothing sensitive would be tracked.** Run `git status --short` and `git check-ignore -v .env NOTES.local.md`. Expected: both reported as ignored by `.gitignore`; neither in `git status`.
- [ ] **Step 3: Create `package.json`** (`"private": true`, `"type": "module"`, scripts `test: "vitest run"`, `typecheck: "tsc --noEmit"`; no `start`/`dev` yet because they don't exist) and install the approved devDependencies with `npm install -D typescript vitest @types/node`.
- [ ] **Step 4: Create `tsconfig.json`**: `strict`, `noUncheckedIndexedAccess`, `target ES2023`, `module ESNext`, `moduleResolution Bundler`, `types: ["node"]`, `noEmit`, `include: ["src","tests"]`.
- [ ] **Step 5: Create `vitest.config.ts`** with `test.include = ["tests/**/*.test.ts"]` and `passWithNoTests: true`.
- [ ] **Step 6: Run `npm test`.** Expected: exit 0, "No test files found" (the empty suite Phase 0 asks for).
- [ ] **Step 7: Write the failing hygiene test** `tests/repo-hygiene.test.ts`:

```ts
test('.gitignore covers secrets, caches, logs, build output', () => {
  const lines = readFileSync('.gitignore', 'utf8').split(/\r?\n/).map(l => l.trim());
  for (const entry of ['.env', '.cache/', 'logs/', 'dist/', 'node_modules/']) {
    expect(lines).toContain(entry);
  }
});
test('.env.example documents every variable with no real secret', () => {
  const text = readFileSync('.env.example', 'utf8');
  for (const name of ['ANTHROPIC_API_KEY', 'AI_SPEND_LIMIT_USD', 'DATA_DIR', 'PORT']) {
    expect(text).toMatch(new RegExp(`^${name}=`, 'm'));
  }
  expect(text).not.toMatch(/sk-ant-/);
  expect(text).toMatch(/^ANTHROPIC_API_KEY=\s*$/m);
});
```

- [ ] **Step 8: Run it, expect FAIL** (missing entries / missing `.env.example`).
- [ ] **Step 9: Make it pass.** Append `.cache/`, `logs/`, `dist/`, `node_modules/` to `.gitignore` (keep existing lines). Create `.env.example` with the four variables from PLAN.md section 6, one comment line each, `ANTHROPIC_API_KEY=` empty, `AI_SPEND_LIMIT_USD=5`, `DATA_DIR=`, `PORT=3000`. Create `README.md` stub: what the product is in two sentences, and the commands from PLAN.md section 6 with `npm test` marked available now and `npm start` / `npm run dev` marked "not built yet".
- [ ] **Step 10: Run `npm test` and `npm run typecheck`.** Expected: both pass.
- [ ] **Step 11: Commit** the docs, CSVs, config, README and tests. Run `git ls-files` first and confirm `.env` and `NOTES.local.md` are absent. `git commit -m "chore: scaffold TypeScript + vitest, ignore secrets and build output"`.
- [ ] **Step 12: Clean-clone check.** From a *different* directory: `git clone <repo> $TEMP/invoca-clone && cd $TEMP/invoca-clone && npm ci && npm test`. Expected: passes, and `ls -a` there shows no `.env`. Delete the temp clone.

---

### Task 2: CSV table reader

**Files:**
- Create: `src/core/errors.ts`, `src/core/csv.ts`, `tests/core/csv.test.ts`

**Interfaces:**
- Produces:
  - `class LoadError extends Error` (plain message, no extra fields)
  - `interface Table { file: string; rows: Record<string, string>[]; isEmpty: boolean }`. `rows[i]` is keyed by trimmed header; every required column is present as a key; missing cells are `""`. `isEmpty` is true when there are no data rows.
  - `readTable(text: string, file: string, required: readonly string[]): Table`

- [ ] **Step 1: Ask the user to approve `csv-parse`.** Install on approval: `npm install csv-parse`.
- [ ] **Step 2: Write failing tests** in `tests/core/csv.test.ts` (inline CSV strings, `file = 'calls.csv'`, `required = ['a','b']`):
  - `missing required column names file and column`: header `a,c` → throws `LoadError` whose message contains `calls.csv` and `"b"`.
  - `extra columns are ignored`: `a,b,zzz` → rows have a, b (assert `rows[0]` toMatchObject; `zzz` may be present but is never required).
  - `reordered columns match by name`: header `b,a`, row `2,1` → `{a:'1', b:'2'}`.
  - `zero-byte file is empty, not an error`: `''` → `isEmpty` true, `rows` `[]`.
  - `header-only file is empty` and still checks columns: `'a,b\n'` → isEmpty; `'a\n'` → throws.
  - `quoted field with comma`: `a,b\n"x, y",2` → `a === 'x, y'`.
  - `quoted field with doubled quote and embedded newline` round-trips.
  - `CRLF line endings`: `'a,b\r\n1,2\r\n3,4\r\n'` → two rows, no trailing `\r` in any value.
  - `UTF-8 BOM` (Review Focus 1): `'﻿a,b\n1,2'` → `rows[0].a === '1'`.
  - `padded headers are trimmed`: `' a , b '` works.
  - `short row` gives `""` for the missing cell, no throw; blank lines skipped.
  - `unterminated quote` → throws `LoadError` mentioning `calls.csv` (not a raw csv-parse error).
- [ ] **Step 3: Run, expect FAIL** (module not found).
- [ ] **Step 4: Implement `readTable` and `LoadError`.** Use `csv-parse/sync` with `bom: true`, `skip_empty_lines: true`, `relax_column_count: true`, `columns` as a function that trims headers (and records them so required columns can be checked even when there are no data rows), `trim` off for values (trimming is the field parsers' job). Wrap csv-parse errors in `LoadError` with the file name. Zero-byte or whitespace-only text returns `isEmpty` without a column check.
- [ ] **Step 5: Run, expect PASS.** `npx vitest run tests/core/csv.test.ts`.
- [ ] **Step 6: Commit.** `git commit -m "feat: read CSV by header name with clear file/column errors"`

---

### Task 3: Field parsers and shared types

**Files:**
- Create: `src/core/types.ts`, `src/core/fields.ts`, `tests/core/fields.test.ts`

**Interfaces:**
- Produces in `types.ts` (used by every later task):

```ts
export const OUTCOMES = ['booked','qualified_lead','not_qualified','missed','voicemail'] as const;
export const CHANNELS = ['paid_search','social','display','organic','direct','referral'] as const;
export type Outcome = (typeof OUTCOMES)[number];
export type Channel = (typeof CHANNELS)[number];
export interface Campaign { id: string; name: string; channel: string; dailyBudgetUsd: number }
export interface Location { id: string; name: string; timezone: string; timezoneValid: boolean }
export type BadReason =
  | 'missing_call_id' | 'bad_timestamp' | 'unknown_location' | 'invalid_timezone'
  | 'unknown_campaign' | 'bad_boolean' | 'bad_outcome' | 'bad_channel'
  | 'bad_duration' | 'bad_revenue';
export interface Call {
  rowNumber: number;            // 1-based data row in calls.csv, header excluded
  callId: string; startedAt: Date; endedAt: Date | null; durationSeconds: number;
  callerHash: string; trackingNumber: string;
  campaignId: string | null;    // null = empty in the file (Unattributed in Phase 2)
  channel: Channel; locationId: string; answered: boolean;
  outcome: Outcome | null; revenueUsd: number | null; agentId: string | null;
  updatedAt: Date | null;       // null = unparseable; loses any dedupe (rule 2)
}
export interface BadRow {
  rowNumber: number; callId: string; updatedAt: Date | null;
  reason: BadReason; detail: string;
}
export type RowResult = { ok: true; call: Call } | { ok: false; bad: BadRow };
export interface ReferenceIssue {
  file: 'campaigns.csv' | 'locations.csv'; rowNumber: number; reason: string; detail: string;
}
export interface LoadedExport {
  campaigns: Campaign[]; locations: Location[];
  rows: RowResult[];            // one per raw calls row, file order, duplicates kept
  rowsRead: number;             // === rows.length
  badByReason: Record<BadReason, number>;  // per RAW row, all reasons present (0 if none)
  referenceIssues: ReferenceIssue[];
  notes: string[];              // human-readable, e.g. "calls.csv is empty"
}
```

- Produces in `fields.ts` (all trim their input; none throw):
  - `parseTimestamp(s: string): Date | null`
  - `parseBoolean(s: string): boolean | null`
  - `parseEnum<T extends string>(s: string, allowed: readonly T[]): T | null`
  - `parseInteger(s: string): number | null` (digits with optional leading `-`)
  - `parseMoney(s: string): number | null` (plain decimal like `432.50`, optional leading `-`; no thousands separators, no `NaN`/`Infinity`/exponent)
  - `isValidTimeZone(tz: string): boolean`

- [ ] **Step 1: Write failing table-driven tests** in `tests/core/fields.test.ts`:
  - `parseTimestamp` valid: `'2026-09-01T00:39:12Z'` → that instant (`.toISOString()` equals input); `'2026-09-01T00:39:12.500Z'` valid; `'  2026-09-01T00:39:12Z '` valid.
  - `parseTimestamp` → `null` for: `''`, `'garbage'`, `'2026-09-01 00:39:12'`, `'2026-09-01T00:39:12'` (no Z), `'2026-09-01T00:39:12+02:00'`, `'2026-02-30T10:00:00Z'`, `'2026-13-01T00:00:00Z'`, `'2026-09-01T24:00:00Z'`, `'2026-09-01'`.
  - `parseBoolean`: `'true'`, `'TRUE'`, `' false '` parse; `''`, `'yes'`, `'1'`, `'t'`, `'null'` → `null`.
  - `parseEnum`: exact value passes after trim; `'Booked'` → `null` (enums are case-sensitive, they are the documented contract); `''` → `null`.
  - `parseInteger`: `'97'`, `'0'` ok; `'-5'` → `-5`; `''`, `'1.5'`, `'abc'`, `'1e3'` → `null`.
  - `parseMoney`: `'89'`, `'432.50'`, `'0'` ok; `''`, `'$5'`, `'1,200'`, `'NaN'`, `'Infinity'` → `null`.
  - `isValidTimeZone`: `'America/Phoenix'`, `'America/New_York'`, `'UTC'` true; `'Mars/Olympus'`, `''`, `'   '` false. Do not assert on legacy aliases like `EST`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Create `types.ts`** exactly as above.
- [ ] **Step 4: Implement `fields.ts`.** Timestamp: match `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/`, build the `Date`, then reject unless `toISOString()` round-trips the same Y-M-D-h-m-s (this catches `02-30` and `24:00`). Do not rely on `Date.parse` alone (it accepts many formats and shifts impossible dates). Time zone: `try { new Intl.DateTimeFormat('en-US',{timeZone:tz}); return true } catch { return false }`, with empty/blank false up front.
- [ ] **Step 5: Run, expect PASS.**
- [ ] **Step 6: Commit.** `git commit -m "feat: strict field parsers and shared types for the loader"`

---

### Task 4: Campaigns and locations

**Files:**
- Create: `src/core/reference.ts`, `tests/core/reference.test.ts`

**Interfaces:**
- Consumes: `Table` (Task 2), `Campaign`, `Location`, `ReferenceIssue` (Task 3), `parseMoney`, `isValidTimeZone`.
- Produces:
  - `CAMPAIGN_COLUMNS = ['campaign_id','name','channel','daily_budget_usd'] as const`, `LOCATION_COLUMNS = ['location_id','name','timezone'] as const` (callers pass these to `readTable`)
  - `parseCampaigns(table: Table): { campaigns: Campaign[]; issues: ReferenceIssue[] }`
  - `parseLocations(table: Table): { locations: Location[]; issues: ReferenceIssue[] }`

Rules: ids and names are trimmed. A campaign row is skipped (one issue) when its id is empty, its id repeats an earlier row (first wins), or its budget isn't a non-negative number (`parseMoney` null or < 0). Budget `0` is valid (Organic/Direct). A location row is skipped when its id is empty or repeats. A location with an empty or invalid IANA zone is **kept** with `timezoneValid: false`, so its calls become `invalid_timezone` and not `unknown_location`.

- [ ] **Step 1: Write failing tests** (small inline tables built as `Table` objects):
  - `valid campaigns parse with numeric budget`: `daily_budget_usd '150.00'` → `150`.
  - `zero budget is valid`.
  - `duplicate campaign id keeps first and reports second` (issue has `rowNumber`, file `'campaigns.csv'`).
  - `empty campaign id skipped and reported`.
  - `non-numeric and negative budgets skipped and reported` (Review Focus 5).
  - `valid locations parse with timezoneValid true` (use `America/Phoenix`).
  - `invalid and empty timezone kept, timezoneValid false, one issue each`.
  - `duplicate and empty location id skipped and reported`.
  - `ids are trimmed`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the two functions per the rules above; row numbers are 1-based data rows.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat: parse campaigns and locations, reporting bad reference rows"`

---

### Task 5: Call row validation

**Files:**
- Create: `src/core/validate.ts`, `tests/core/validate.test.ts`

**Interfaces:**
- Consumes: `Call`, `RowResult`, `BadReason`, enums (Task 3), field parsers (Task 3), `Campaign`, `Location` (Task 3).
- Produces:
  - `CALL_COLUMNS` (the 14 columns from BRIEF.md, as a `readonly string[]`; required: all of them)
  - `interface References { campaignIds: ReadonlySet<string>; locations: ReadonlyMap<string, Location> }`
  - `buildReferences(campaigns: Campaign[], locations: Location[]): References`
  - `validateCall(raw: Record<string, string>, rowNumber: number, refs: References): RowResult`

**Check order (first failure wins, so reason counts sum to bad rows):** `missing_call_id`, `bad_timestamp` (`started_at`), `unknown_location`, `invalid_timezone`, `unknown_campaign`, `bad_boolean` (`answered`), `bad_outcome`, `bad_channel`, `bad_duration`, `bad_revenue`.

Rules: empty `campaign_id` is valid (`campaignId: null`). Non-empty and not in `campaignIds` is `unknown_campaign`. Empty `outcome` is valid (`null`); non-empty must be in `OUTCOMES`. `marketing_channel` must be in `CHANNELS` (empty is bad). `duration_seconds` must be a non-negative integer. `revenue_usd` empty is valid (`null`); otherwise a non-negative money value. Empty `agent_id` → `null`. `ended_at` and `updated_at` that don't parse → `null`, never bad. A `BadRow` always carries `callId` (as trimmed, possibly `""`) and the parsed `updatedAt`, so Phase 2 can dedupe it.

- [ ] **Step 1: Write failing tests.** Use a `goodRow()` helper (one valid raw record, invented ids, not tied to the shipped data) and `refs` built from two campaigns and two locations (one Phoenix, one Denver). Table-driven, one case per line, each asserting `ok === false`, `bad.reason`, `bad.callId`, and `bad.updatedAt` is a `Date`:
  - `unparseable started_at` → `bad_timestamp` (`'garbage'`, `''`, `'2026-02-30T10:00:00Z'`).
  - `unknown location` → `unknown_location`.
  - `invalid IANA zone location` → `invalid_timezone`.
  - `unknown non-empty campaign` → `unknown_campaign` (and it is **not** unattributed).
  - `bad answered` (`'maybe'`, `''`) → `bad_boolean`.
  - `bad outcome enum` (`'won'`) → `bad_outcome`; `bad marketing_channel` (`'tv'`, `''`) → `bad_channel`.
  - `negative duration` (`'-3'`) → `bad_duration`; also `''` and `'1.5'`.
  - `bad revenue` (`'abc'`, `'-10'`) → `bad_revenue`.
  - `empty call_id` → `missing_call_id`.
  - `multiple problems report the first in check order` (bad timestamp + unknown location → `bad_timestamp`).
  - Valid cases (`ok === true`): `empty campaign_id gives campaignId null`; `empty outcome gives null` (answered true, pending); `empty revenue gives null`; `unanswered with empty agent_id`; `padded values are trimmed` (`' true '`, `' cmp_a '`, Review Focus 4); `bad updated_at gives updatedAt null but row stays ok`; `bad ended_at gives endedAt null`; `revenue on a non-booked row is kept as parsed` (ignoring it is Phase 2); `extra keys in raw are ignored`.
  - `startedAt` is the exact UTC instant; `rowNumber` is passed through.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `buildReferences` and `validateCall`**, returning on the first failing check. Build `Call` only after every check passes.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat: validate each call row, reporting the first failing rule"`

---

### Task 6: Assemble the loader and read from DATA_DIR

**Files:**
- Create: `src/core/loadExport.ts`, `src/node/readDataDir.ts`, `tests/core/loadExport.test.ts`, `tests/node/readDataDir.test.ts`

**Interfaces:**
- Consumes: `readTable`, `LoadError` (Task 2), `LoadedExport` etc. (Task 3), `parseCampaigns`, `parseLocations`, `CAMPAIGN_COLUMNS`, `LOCATION_COLUMNS` (Task 4), `CALL_COLUMNS`, `buildReferences`, `validateCall` (Task 5).
- Produces:
  - `loadExport(texts: { calls: string; campaigns: string; locations: string }): LoadedExport`
  - `readExportFromDir(dir?: string): LoadedExport`. Default `dir` is `process.env.DATA_DIR` if non-empty, else `process.cwd()` (the repo root; PLAN.md rule 1).

`loadExport` order: read campaigns and locations tables, build references, read calls table, validate each row in file order. `badByReason` has a key for **every** `BadReason` (0 when none). `notes` gets `"calls.csv is empty: starting with zero calls"` (same wording per file) when a table `isEmpty`. A required column missing in any file throws `LoadError` (from `readTable`).

`readExportFromDir` throws `LoadError` for a missing directory or a missing file, naming the path. It reads UTF-8.

- [ ] **Step 1: Write failing tests** in `tests/core/loadExport.test.ts` (small inline CSVs, invented names):
  - `three rows for one call_id are all kept, in file order` (`rows.length === 3`, `rowsRead === 3`).
  - `bad latest row is kept with callId and updatedAt` (so Phase 2 can see it).
  - `badByReason counts per raw row and sums to the bad rows`; all keys present; a mixed fixture with one row per reason checks every count equals 1 (`missing_call_id` through `bad_revenue`).
  - `empty calls.csv gives zero rows and a note`; zero-byte `campaigns.csv` gives zero campaigns, a note, and every call with a campaign becomes `unknown_campaign` while calls with empty campaign stay ok.
  - `header-only calls.csv gives zero rows and a note`.
  - `missing required column in locations.csv throws LoadError naming locations.csv`.
  - `reordered and extra columns in calls.csv still load`.
  - `reference issues flow through` (duplicate campaign id appears in `referenceIssues`; a call using the skipped second copy's *distinct* id is `unknown_campaign`).
  - `CRLF and quoted comma in a campaign name load` end to end.
  - In `tests/node/readDataDir.test.ts`, using `mkdtempSync` in `os.tmpdir()`: `reads the three files from an explicit dir`; `missing directory throws LoadError naming the path`; `missing calls.csv throws LoadError naming calls.csv`; `empty DATA_DIR env falls back to cwd` (set/restore `process.env.DATA_DIR`, assert via an explicit dir argument vs unset using `vi.stubEnv`).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `loadExport` and `readExportFromDir`** per the interfaces above. `rowsRead === rows.length`. Keep `loadExport` free of `fs` and `process`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat: assemble loader; read the three CSVs from DATA_DIR"`

---

### Task 7: Shipped-export snapshot and wrap-up

**Files:**
- Create: `tests/fixtures/original-export/calls.csv`, `.../campaigns.csv`, `.../locations.csv` (byte copies of the repo-root files), `tests/snapshot/original-export.test.ts`
- Modify: `README.md`, `docs/DECISIONS.md` (only if a new real decision appears while building)

**Interfaces:**
- Consumes: `readExportFromDir` (Task 6).

- [ ] **Step 1: Copy** the three root CSVs into `tests/fixtures/original-export/` unchanged (BRIEF.md: keep a copy as the regression fixture). Do not modify the root files.
- [ ] **Step 2: Write the test** `tests/snapshot/original-export.test.ts`:
  - `shipped export loads: 5,411 raw rows`: `rowsRead === 5411`, `rows.length === 5411`, `campaigns.length === 12`, `locations.length === 8`, `referenceIssues` `[]`, `notes` `[]`.
  - `shipped export has no bad rows`: every `badByReason` value is `0`. BRIEF.md says the data is already consistent. **If this fails, stop and report the reasons; do not loosen a rule to make it pass.**
  - `default DATA_DIR (repo root) loads the same row count`: with `DATA_DIR` unstubbed to empty, `readExportFromDir()` from the repo root gives `rowsRead === 5411`.
  - `campaigns with a zero budget are present`: at least one campaign has `dailyBudgetUsd === 0` (guards the Organic/Direct case without naming them).
  - `Phoenix is a valid zone in the export`: at least one location has `timezone === 'America/Phoenix'` and `timezoneValid`. (Allowed: the BRIEF records this zone as part of the data contract; it is a test assertion, not code.)
- [ ] **Step 3: Run `npm test` and `npm run typecheck`.** Expected: every file passes. Paste the summary into the review message.
- [ ] **Step 4: Update `README.md`** with a short "Data" paragraph: the three CSVs, `DATA_DIR` (default repo root), and what the loader reports. Add a `docs/DECISIONS.md` line for anything new decided while building.
- [ ] **Step 5: Hard-coding check.** `git grep -n -E "cmp_[0-9]|loc_[0-9]|Phoenix|Northside" -- src` returns nothing.
- [ ] **Step 6: Commit.** `git commit -m "test: snapshot the shipped export through the loader"`
- [ ] **Step 7: STOP.** Show the user the `npm test` output and the list of commits. Say plainly what is *not* done (dedupe, localization, revenue rule: Phase 2). Wait for review.

---

## Self-review notes

- **Spec coverage, Phase 0:** git repo (Task 1 step 2), TypeScript + vitest (steps 3-6), `.env.example`, `.gitignore` entries (step 9), empty suite (step 6), README stub (step 9), `.env` confirmed ignored (steps 2 and 7-8), clean clone (step 12).
- **Spec coverage, Phase 1 edge cases:** missing column (T2, T6); extra and reordered columns (T2, T6); empty file (T2, T6); quoted commas (T2, T6); CRLF (T2, T6); unparseable timestamps (T3, T5); unknown location (T5); unknown non-empty campaign (T5); bad boolean or enum (T3, T5); negative duration (T5); invalid IANA zone (T3, T4, T5). "5,411 rows" (T7).
- **Types:** `Table`, `References`, `RowResult`, `LoadedExport` names are identical wherever they're used. `readTable` takes `required` so Tasks 4-6 pass the `*_COLUMNS` constants.
- **Known hand-off to Phase 2:** `badByReason` here is per raw row. Phase 2 must dedupe first and report per call.
