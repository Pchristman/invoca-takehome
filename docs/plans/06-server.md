# Phase 6 (Server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local Hono server that loads the export once at startup and serves the four views, data notes, a template-only takeaway, the callback list as CSV, and (when it exists) the built web app, with clear errors instead of crashes.

**Architecture:** The server is a thin shell over Phase 5's pure builders. One pure function parses and validates the query string into `(range, previous?, options)`; each route calls a builder and returns its JSON untouched, so the server adds no arithmetic. `createApp(store)` returns a Hono app that tests call in-process; `start()` is the only code that reads files, opens a port or touches `process.env`.

**Tech Stack:** Node 24, TypeScript (strict), vitest, plus three dependencies that need your yes first (Task 0): `hono`, `@hono/node-server`, `tsx`.

**Spec:** `PLAN.md` (sections 2, 3.1-3.4, 4.4, 6 "Server", 8 "Server", Phase 6 in section 9), `docs/BRIEF.md`, `CLAUDE.md`, `docs/plans/05-view-builders.md` for the builders and their types.

## Global Constraints

- Work **one task at a time**. After the last task run `npm test` and `npm run typecheck`, show the output, then **stop** and wait (CLAUDE.md).
- **Ask before adding the three dependencies** (Task 0). Nothing else new.
- Phase 6 done-when, verbatim from PLAN.md: "in-process endpoint tests pass, and `npm start` serves JSON for every view on the shipped data."
- Every number comes from code. The server computes nothing: it returns builder output as-is. (CLAUDE.md)
- The app works with AI off and the key missing. Phase 6 never reads `ANTHROPIC_API_KEY`; takeaways are template text. (CLAUDE.md, PLAN.md section 9)
- Bad query parameters return 400 with a message and never crash. Bad rows, an empty export and a missing data folder never produce a stack trace for the user. (PLAN.md section 6, CLAUDE.md)
- Nothing hard-coded to this dataset. `tests/core/different-names.test.ts` scans `src/` recursively, so **comments and messages in `src/server/` must write `YYYY-MM-DD`, never a real date, and name no campaign, office or tracking number.**
- Thresholds, ranges and views come from Phase 3 to 5 code; the server repeats none of them as a literal except the three preset names and the default preset in `src/server/api.ts`.
- Never read, print or `git add` `.env`. Do not write to `docs/AI_COST_LOG.md` (it has uncommitted edits of yours; leave them) or edit `docs/BRIEF.md`.
- Commit after each task, small, message says why, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stage files by name, never `git add -A`.
- Prefer simple, readable code; a reviewer will walk through all of it.

## Issues found in PLAN.md (decide before or during review)

Each is proposed in `docs/DECISIONS.md` (rows dated 2026-11-19, "Phase 6 (proposed)") and needs your yes or no.

1. **`npm start` can't build a web app yet.** PLAN.md section 6 says `npm start` builds the web app and serves it; there is no web app until Phase 7. Proposed: Phase 6's `npm start` runs only the server and serves `dist/` if a build exists; Phase 7 adds the build step.
2. **Node can't run `src/` directly.** Imports are extensionless (decision of 2026-11-19, the generator row), so `node src/server/cli.ts` fails. Proposed: `tsx`, which is on PLAN.md's expected list, as a runtime dependency.
3. **No URL contract.** PLAN.md says state lives in the URL and "one JSON endpoint per view, taking range A and optional range B" but names no parameters and no default range. Proposed: `range=last7|last28|all` or `start`+`end`; `compareStart`+`compareEnd`; `campaign`; `location`; default `last28`.
4. **An extra endpoint.** The date control and the empty-export message need the data span and the campaign and office lists before any range is chosen. Proposed: `GET /api/meta`.
5. **What an empty export returns.** PLAN.md says start with zero calls and say so, but there is no range to resolve. Proposed: `/api/meta` says `hasData: false` with the load note; view endpoints return 409 `no_data`.
6. **Bad vs unavailable comparison.** A malformed or inverted compare range is a 400; one that is the wrong length or outside the data is a normal 200 whose view says "No like-for-like comparison" / "No full previous period" (Phase 5 builds that reason).
7. **Unknown ids.** Phase 5 left "unknown campaign / office id" to this phase. Proposed: 400, not an empty view.
8. **CSV details.** PLAN.md lists the columns but not the encoding. Proposed: UTF-8 with a byte-order mark and CRLF so a spreadsheet opens non-ASCII names correctly, and cells starting with `=`, `+`, `-`, `@`, tab or CR get a leading `'` so a spreadsheet cannot run them as formulas. **Cost:** tracking numbers start with `+`, so they appear as `'+1-555-0190`. Leaving them alone risks a spreadsheet reading the number as a formula (I haven't verified how Excel treats it), which would corrupt the field the marketer matches on.
9. **Local only.** Proposed: listen on `127.0.0.1`, not all interfaces, because the callback list carries caller hashes.

## Review Focus

Inputs the spec implies but no listed edge case names. Each has a test in the owning task.

1. **An empty export** (header-only `calls.csv`): the server starts, `/api/meta` says there is no data and why, every view says 409 `no_data`, nothing throws. (Tasks 1, 3, 6)
2. **An unexpected exception inside a builder**: the response is a generic JSON 500 with no message, stack or file path from the error, it is logged server-side, and the next request still works. (Task 3)
3. **CSV cells a spreadsheet would run or garble**: a tracking number starting `+`, a campaign named `=HYPERLINK(...)`, a name with a comma, a quote and a line break, a non-ASCII name. (Tasks 2, 4)
4. **URL text echoed back**: a 5,000-character parameter value or one containing `<script>` must be shortened in the message and returned as JSON only; a static request such as `/../package.json` must never return a file outside the web folder. (Tasks 1, 5)
5. **A bad or busy `PORT`, and who can connect**: `PORT=abc`, `PORT=0`, `PORT` already in use, each a clear message and exit 1; the server listens on loopback only. (Task 6)

---

## File Structure

```
src/server/api.ts             ApiErrorCode, ApiError, Meta, AiStatus, DataNotesResponse, TakeawayResponse, PRESETS, DEFAULT_PRESET, statusFor, shorten
src/server/params.ts          Query, Parsed, ViewQuery, ViewQueryWants, parseViewQuery
src/server/csv.ts             csvCell, toCsv, callbacksToCsv
src/server/app.ts             AppOptions, createApp
src/server/staticFiles.ts     serveWebApp (the built front end, SPA fallback, placeholder)
src/server/config.ts          ConfigError, parsePort
src/server/start.ts           StartOptions, RunningServer, start
src/server/cli.ts             the `npm start` entry: print the address or "Cannot start: ..." and exit 1
tests/server/helpers.ts       serverFixture, get, tempDir
tests/server/params.test.ts
tests/server/csv.test.ts
tests/server/app.test.ts      meta, the four views, errors
tests/server/endpoints.test.ts data notes, takeaway, callbacks CSV
tests/server/static.test.ts
tests/server/start.test.ts
tests/server/cli.test.ts
tests/snapshot/original-export-server.test.ts
tests/snapshot/extended-export-server.test.ts
tests/core/different-names.test.ts  (modify) the server on the other export
package.json, package-lock.json     (modify) three dependencies, `start` script
README.md                      (modify) commands, endpoints, parameters
docs/DECISIONS.md              (modify) already holds this plan's proposed rows
```

`src/server/api.ts` holds only types and constants so Phase 7's web app can import them without pulling in Hono.

## The API (one table, so every task reads the same contract)

| Route | Query parameters | 200 body |
| --- | --- | --- |
| `GET /api/meta` | none | `Meta` |
| `GET /api/overview` | range, compare | `OverviewView` |
| `GET /api/campaigns` | range, compare, `campaign` | `CampaignsView` |
| `GET /api/locations` | range, compare | `LocationsView` |
| `GET /api/missed-calls` | range, compare, `location` | `MissedCallsView` |
| `GET /api/missed-calls/callbacks.csv` | range, compare, `location` | CSV file |
| `GET /api/takeaway/:view` | as that view | `TakeawayResponse` |
| `GET /api/data-notes` | none | `DataNotesResponse` (always available; `?dev` only hides the panel in the UI) |

- **Range:** `range=last7|last28|all`, **or** `start=YYYY-MM-DD&end=YYYY-MM-DD`. Neither given means `last28`. An empty value (`range=`) counts as not given.
- **Compare (optional):** `compareStart` and `compareEnd` together.
- **Ignored:** parameters a route doesn't use (the UI keeps `view` and `dev` in the same URL).
- **Errors:** every error is `{ "error": { "code": ApiErrorCode, "message": string, "field"?: string } }` with status 400, except `no_data` (409), `not_found` (404) and `internal` (500).
- Every route is GET only.

---

### Task 0: Approve and install the dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`, `docs/DECISIONS.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `hono`, `@hono/node-server`, `tsx` importable; `npm start` script (`tsx src/server/cli.ts`).

- [ ] **Step 1: Ask the user** (CLAUDE.md: ask before adding a dependency; PLAN.md: at the start of the phase that needs it). Name the three packages, why each is needed, and that `tsx` goes under `dependencies` because `npm start` runs through it. **Do not install anything until they say yes.** If they decline one, stop and report what that changes.

- [ ] **Step 2: Install**

  Run: `npm install hono @hono/node-server tsx`
  Expected: three packages added under `dependencies`; `package-lock.json` updated.

- [ ] **Step 3: Check they work with this repo's imports**

  Run: `node -e "import('hono').then(m => console.log(typeof m.Hono))"`
  Expected: `function`

  Run: `npx tsx -e "import('./src/node/readDataDir.ts').then(m => console.log(typeof m.readExportFromDir))"`
  Expected: `function` (this proves `tsx` resolves the extensionless imports Node can't).

- [ ] **Step 4: Add the `start` script** to `package.json`: `"start": "tsx src/server/cli.ts"`.

- [ ] **Step 5: Confirm nothing broke**

  Run: `npm run typecheck` then `npm test`
  Expected: no type errors; every existing test passes.

- [ ] **Step 6: Commit**

  ```bash
  git add package.json package-lock.json docs/DECISIONS.md
  git commit -m "chore: add hono, @hono/node-server and tsx for the server

  All three are on PLAN.md's expected list; tsx is needed because Node cannot resolve the extensionless imports in src/.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 1: API types and query parsing

**Files:**
- Create: `src/server/api.ts`, `src/server/params.ts`, `tests/server/helpers.ts`, `tests/server/params.test.ts`

**Interfaces:**
- Consumes: `CallStore`; `DateRange`, `ResolvedRange`, `RangeErrorCode`, `RangeSpec`, `checkDates`, `resolveRange` (`src/core/ranges.ts`); `makeStore`, `callAt`, `campaign`, `office` (`tests/core/views/fixtures.ts`).
- Produces:
  ```ts
  // api.ts
  export const PRESETS = ['last7', 'last28', 'all'] as const;
  export const DEFAULT_PRESET = 'last28';
  export type ApiErrorCode = RangeErrorCode | 'bad_param' | 'unknown_campaign' | 'unknown_location' | 'unknown_view' | 'not_found' | 'internal';
  export interface ApiError { code: ApiErrorCode; message: string; field?: string }
  export function statusFor(code: ApiErrorCode): 400 | 404 | 409 | 500;   // no_data 409, not_found 404, internal 500, rest 400
  export function shorten(text: string): string;                          // over 40 characters: the first 40 plus "..."; same rule as checkDates

  // params.ts
  export type Query = Record<string, string[]>;                           // what Hono's c.req.queries() returns
  export type Parsed<T> = { ok: true; value: T } | { ok: false; error: ApiError };
  export interface ViewQuery { range: ResolvedRange; previous?: DateRange; campaignId?: string; locationId?: string }
  export interface ViewQueryWants { campaign?: boolean; location?: boolean }
  export function parseViewQuery(store: CallStore, span: DateRange | null, query: Query, wants?: ViewQueryWants): Parsed<ViewQuery>;
  ```
  Checks run in this order and the first failure wins: (1) a known parameter given twice; (2) range form (`range` together with `start`/`end`; one of `start`/`end` alone; unknown preset); (3) the dates' syntax via `checkDates`, for both the range and the compare pair (compare needs both or neither); (4) no data (`no_data`) and outside the data, via `resolveRange`; (5) `campaign` / `location` exist in the store, only when `wants` asks for them and the value isn't empty. Every message names the parameter, and any echoed value goes through `shorten`.

  Test helpers in `helpers.ts` (later tasks use them):
  ```ts
  export function serverFixture(): CallStore;
  //   campaigns cmp_a "Alpha" social $10 and cmp_b "Beta" display $20; offices loc_a "Office A" (America/Phoenix) and loc_b "Office B" (America/Denver).
  //   For each date 2026-09-01 .. 2026-09-14 (day i, 1-14): an answered, booked, $100 call at T16:00Z (Alpha, loc_a, callerHash `ok${i}`)
  //   and an unanswered 'missed' call at T17:00Z (Beta, loc_b, callerHash `miss${i}`). 28 calls; 14 callers never got through.
  export async function get(app: Hono, path: string, init?: RequestInit): Promise<{ status: number; headers: Headers; text: string; json: unknown }>;
  export function tempDir(): string;   // a fresh folder under .cache/ (gitignored), removed by the caller; .cache/ is created if missing
  ```

- [ ] **Step 1: Write the failing tests** in `params.test.ts`, on `serverFixture()` with `span = { start: '2026-09-01', end: '2026-09-14' }`. A `q({ range: 'last7' })` helper wraps values into the `Query` shape.
  - `no parameters means the default preset`: `{}` is ok, `range` is `{ start: '2026-09-01', end: '2026-09-14', days: 14, clamped: true }` (28 days asked, 14 in the data), `previous` undefined. `range: ['']` and `start: [''], end: ['']` also mean the default.
  - `presets`: `last7` gives `2026-09-08..2026-09-14`, `days 7`, `clamped false`; `all` gives the whole span.
  - `custom range`: `start=2026-09-03&end=2026-09-05` gives `days 3`, `clamped false`; `start=2026-09-10&end=2026-09-30` gives `end '2026-09-14'`, `clamped true` (partial overlap is fine).
  - `a compare range is passed through, not judged`: `last7` plus `compareStart=2026-09-01&compareEnd=2026-09-03` gives `previous { start: '2026-09-01', end: '2026-09-03' }` even though the lengths differ (Phase 5 turns that into a "No like-for-like comparison" reason). A compare range wholly outside the data is passed through too.
  - `malformed dates are bad_date, naming the field`: it.each of `2026-02-30`, `banana`, `2026-9-1`, `20260901`, `2026-09-01T00:00:00Z` as `start` (with a good `end`): `{ code: 'bad_date', field: 'start' }`, message contains the value; the same as `end`; the same as `compareStart` gives `field: 'compareStart'`.
  - `start alone or end alone is bad_param`: `{ start: ['2026-09-01'] }` gives `code 'bad_param'`, message contains `start` and `end`; the same for `end` alone and for `compareStart` without `compareEnd`.
  - `an inverted range is start_after_end`: `start=2026-09-10&end=2026-09-05`; the same for the compare pair.
  - `a range outside the data is outside_data`: `start=2027-01-01&end=2027-01-31`: message contains `2026-09-01` and `2026-09-14` (the data span, read from the store, not typed in the source).
  - `range and start/end together is bad_param`; `an unknown preset` (`range=last99`) is `bad_param` and the message lists `last7`, `last28` and `all`.
  - `a repeated parameter is bad_param`: `range: ['last7', 'all']`, and `start` given twice.
  - `a very long or markup value is shortened`: a 5,000-character `range`, `start`, `campaign` (with `wants.campaign`) and `location`: every message is under 200 characters and ends the echoed value with `...`; `<script>` as `range` is echoed (shortened) and nothing is interpreted. (Review Focus 4)
  - `campaign and location are checked only when the route wants them`: `campaign=nope` with `wants {}` is ok and `campaignId` undefined; with `wants { campaign: true }` it is `unknown_campaign`; `campaign=cmp_b` gives `campaignId 'cmp_b'`; `campaign=` (empty) gives `campaignId` undefined; `location=nope` with `wants { location: true }` is `unknown_location`, `location=loc_a` is ok.
  - `an empty export`: `makeStore([])` with `span null`: `{}` is `no_data`; `start=2026-09-01&end=2026-09-05` is `no_data`; but a bad date or an inverted range is still `bad_date` / `start_after_end` (syntax is checked first). (Review Focus 1)
  - `statusFor`: `no_data` is 409, `not_found` 404, `internal` 500, and `bad_param`, `bad_date`, `start_after_end`, `outside_data`, `unknown_campaign`, `unknown_location`, `unknown_view` are 400 (`it.each`).

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/server/params.test.ts`
  Expected: FAIL, cannot resolve `../../src/server/params`.

- [ ] **Step 3: Implement `api.ts`, `params.ts` and `helpers.ts`.** `parseViewQuery` is plain sequential checks; it calls `checkDates` for syntax, then `resolveRange(span, spec)` for the range and maps its `RangeError` to an `ApiError` unchanged (same code, message, field). It never throws. `helpers.ts` builds the fixture with the Phase 5 fixture helpers.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/server/params.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/server/api.ts src/server/params.ts tests/server/helpers.ts tests/server/params.test.ts
  git commit -m "feat: parse and validate view query parameters

  One pure function turns URL text into a range, an optional comparison and ids that exist, or a message; the routes then cannot receive a bad value.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 2: CSV writer

**Files:**
- Create: `src/server/csv.ts`, `tests/server/csv.test.ts`

**Interfaces:**
- Consumes: `CallbackRow` (`src/core/views/callbacks.ts`).
- Produces:
  ```ts
  export function csvCell(value: string | number | null): string;
  //   null -> ''; a number -> String(n), throws on NaN or Infinity; a string is neutralised then escaped (below)
  export function toCsv(columns: readonly string[], rows: readonly (readonly (string | number | null)[])[]): string;
  //   header line, then one line per row, every line ending CRLF; throws if a row's length differs from columns
  export function callbacksToCsv(rows: readonly CallbackRow[]): string;
  //   columns: caller_hash, unanswered_attempts, last_attempt_local, office, campaign, tracking_number, estimated_value_usd
  ```
  Rules for `csvCell` on a string: (1) if it starts with `=`, `+`, `-`, `@`, tab or CR, prefix `'`; (2) if the result contains `,`, `"`, CR or LF, wrap it in double quotes and double every inner quote. Numbers are never prefixed. `callbacksToCsv` writes `estimated_value_usd` as `toFixed(2)` text, `unanswered_attempts` as a number, `last_attempt_local` from `lastAttemptLocal`, `office` from `officeName`, `campaign` from `campaignName`. It does **not** add the byte-order mark; the route does (Task 4).

- [ ] **Step 1: Write the failing tests.**
  - `csvCell` plain: `'abc'` is `abc`; `''` is empty; `null` is empty; `42` is `42`; `0.5` is `0.5`; `-3` (a number) is `-3` with no prefix.
  - Quoting: `'a,b'` is `"a,b"`; `'say "hi"'` is `"say ""hi"""`; `'line1\nline2'`, `'a\r\nb'` and `'a\rb'` are quoted with the break kept; a field with a comma, a quote and a newline together (`'Spring, "Big" Sale\nWeek'`) is `"Spring, ""Big"" Sale\nWeek"`.
  - Formula neutralising (it.each): `'=SUM(A1)'`, `'+1-555-0190'`, `'-2+3'`, `'@cmd'`, `'\tx'`, `'\rx'` each gain a leading `'` (`'=SUM(A1)'` becomes `'=SUM(A1)` and so on; the tab and CR cases are then quoted if they contain a CR); a value that merely contains those characters later (`'a=b'`, `'1-2'`) is unchanged. A formula with a comma, `'=HYPERLINK("x","y")'`, becomes `"'=HYPERLINK(""x"",""y"")"`. (Review Focus 3)
  - Non-ASCII passes through unchanged: `'Café Ñandú 東京'`.
  - `NaN` and `Infinity` throw.
  - `toCsv`: `toCsv(['a','b'], [['1','x,y'], [2, null]])` is `'a,b\r\n1,"x,y"\r\n2,\r\n'`; no rows gives the header line only, `'a,b\r\n'`; a short row throws an `Error` mentioning the row number.
  - `callbacksToCsv`: one `CallbackRow` (hash `h_1`, 3 attempts, `lastAttemptLocal '2026-09-10 09:00'`, office `Office A`, campaign `Spring, "Big" Sale`, tracking `+1-555-0190`, value `20`) gives the header `caller_hash,unanswered_attempts,last_attempt_local,office,campaign,tracking_number,estimated_value_usd` then `h_1,3,2026-09-10 09:00,Office A,"Spring, ""Big"" Sale",'+1-555-0190,20.00`; value `23.3` writes `23.30`; no rows gives the header only.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/server/csv.test.ts`
  Expected: FAIL, cannot resolve `../../src/server/csv`.

- [ ] **Step 3: Implement the three functions** in `src/server/csv.ts`. A comment explains the leading `'` (spreadsheets run cells starting with those characters) and that it also shows on tracking numbers.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/server/csv.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/server/csv.ts tests/server/csv.test.ts
  git commit -m "feat: CSV writer with escaping and spreadsheet-formula guard

  Names come from the export, so a cell can contain commas, quotes, line breaks or a leading = or +; none may break the file or run as a formula.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 3: App skeleton, meta and the four view routes

**Files:**
- Create: `src/server/app.ts`, `tests/server/app.test.ts`

**Interfaces:**
- Consumes: Task 1 (`parseViewQuery`, `statusFor`, `shorten`, types); `buildOverview`, `buildCampaigns`, `buildLocations`, `buildMissedCalls` (`src/core/views/index.ts`); `dataSpan`; `serverFixture`, `get`.
- Produces:
  ```ts
  // api.ts (add)
  export interface Meta {
    hasData: boolean; callCount: number; span: DateRange | null;
    campaigns: { id: string; name: string }[]; locations: { id: string; name: string }[];   // store order
    presets: typeof PRESETS; defaultPreset: typeof DEFAULT_PRESET;
    skippedRows: number;                // store.dataNotes.badRows
    notes: string[];                    // store.dataNotes.notes, e.g. "calls.csv is empty: ..."
  }
  // app.ts
  export interface AppOptions { webRoot?: string }          // used from Task 5
  export function createApp(store: CallStore, options?: AppOptions): Hono;
  ```
  The span is computed once in `createApp`. Each view route reads the query with `c.req.queries()`, calls `parseViewQuery(store, span, query, wants)` (`wants`: Campaigns `{ campaign: true }`, Missed calls `{ location: true }`, others none), builds the view with `(store, range, previous, options)` and returns it with `c.json`. `app.notFound` returns a JSON `not_found` for every path starting `/api/`. `app.onError` logs the error with `console.error` and returns `{ error: { code: 'internal', message: 'Something went wrong on the server.' } }` with 500, never the error's own text.

- [ ] **Step 1: Write the failing tests** in `app.test.ts` on `createApp(serverFixture())`.
  - `meta`: 200, `application/json`; `hasData true`, `callCount 28`, `span { start: '2026-09-01', end: '2026-09-14' }`, `campaigns` `[{ id 'cmp_a', name 'Alpha' }, { id 'cmp_b', name 'Beta' }]`, `locations` the two offices, `presets ['last7','last28','all']`, `defaultPreset 'last28'`, `skippedRows` equal to the fixture's `dataNotes.badRows`, `notes` equal to the fixture's.
  - `each view answers 200 with its own name` (`it.each` over `overview`, `campaigns`, `locations`, `missed-calls`): body `view` equals the route name, `actions` is non-empty, `factSheet` and `notes` are present.
  - `the body is exactly the builder's output`: for each view, `json` equals `JSON.parse(JSON.stringify(buildX(store, range, undefined, options)))` for `range=last7` (so the server adds and changes nothing).
  - `no parameters means the last 28 days, clamped to the data`: `/api/overview` has `range { start '2026-09-01', end '2026-09-14', days 14, clamped true }` and `notes.comparison.available false` with a reason starting `No full previous period`.
  - `last7 compares with the 7 days before`: `/api/overview?range=last7`: `notes.comparison` is available with `previous { start '2026-09-01', end '2026-09-07' }`; `tiles.calls` is `{ current 14, previous 14 }`.
  - `a custom range and an explicit comparison`: `start=2026-09-08&end=2026-09-10&compareStart=2026-09-01&compareEnd=2026-09-03` is available; `compareStart=2026-09-01&compareEnd=2026-09-02` (2 days against 3) is a **200** with `available false` and a reason starting `No like-for-like comparison`; a compare range outside the data is a 200 with `available false`.
  - `a partial overlap is clamped, not refused`: `start=2026-09-10&end=2026-09-30` is 200, `range.end '2026-09-14'`, `range.clamped true`.
  - `bad parameters are 400 with a message` (PLAN.md edge cases, `it.each` over the path and the expected `code`): `?start=2026-09-01` (`bad_param`), `?end=2026-09-05` (`bad_param`), `?start=2026-02-30&end=2026-03-02` (`bad_date`), `?start=banana&end=2026-09-05` (`bad_date`), `?range=last99` (`bad_param`), `?range=last7&start=2026-09-01&end=2026-09-05` (`bad_param`), `?range=last7&range=all` (`bad_param`); each: status 400, `application/json`, body `{ error: { code, message } }` with a non-empty `message`, no `view` key.
  - `an inverted range is 400`: `?start=2026-09-10&end=2026-09-05` gives `start_after_end`, message contains both dates.
  - `a range outside the data is 400`: `?start=2027-01-01&end=2027-01-31` gives `outside_data`, message contains the data span.
  - `an unknown campaign for the weekly chart is 400`: `/api/campaigns?campaign=nope` gives `unknown_campaign`; `?campaign=cmp_b` is 200 with `weekly.campaignId 'cmp_b'`; no parameter gives the campaign with the most calls; `?campaign=` is the same as none. `/api/overview?campaign=nope` is 200 (ignored there).
  - `an unknown office for the missed-calls filter is 400`: `/api/missed-calls?location=nope` gives `unknown_location`; `?location=loc_a` is 200 with `officeFilter { locationId 'loc_a', name 'Office A' }`. `/api/locations?location=nope` is 200 (ignored).
  - `error messages stay short and are JSON`: a 5,000-character `?range=` value gives a message under 200 characters and `content-type` `application/json`; `?range=<script>alert(1)</script>` is a 400 JSON error, no HTML in the response. (Review Focus 4)
  - `an empty export`: `createApp(makeStore([], …))`: `/api/meta` is 200 with `hasData false`, `callCount 0`, `span null` and `notes` carrying the store's note; each view route is 409 with `code 'no_data'` and a message; `?range=bad` is still 400 `bad_param`. (Review Focus 1)
  - `an unknown API route is a JSON 404`: `/api/nope` is 404 `not_found`; `POST /api/overview` is 404 `not_found` (GET only).
  - `an unexpected error is a generic 500 and the server keeps serving` (Review Focus 2): build the app, then make `store.campaigns` a getter that throws `new Error('boom C:\\secret\\path')` while a flag is set. `/api/campaigns` is 500, body exactly `{ error: { code: 'internal', message: 'Something went wrong on the server.' } }`, the response text contains neither `boom` nor `secret`, and `console.error` (spied with `vi.spyOn`, silenced) was called with the error. Clear the flag: the next `/api/campaigns` is 200.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/server/app.test.ts`
  Expected: FAIL, cannot resolve `../../src/server/app`.

- [ ] **Step 3: Implement `createApp`** with `/api/meta` and the four view routes through one small helper (`route(name, wants, build)`) so the parse, error-mapping and JSON code is written once. Map `Parsed` errors with `c.json({ error }, statusFor(error.code))`.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/server/app.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/server/api.ts src/server/app.ts tests/server/app.test.ts
  git commit -m "feat: Hono app with meta and the four view endpoints

  Routes return builder output untouched; bad parameters, an empty export and unexpected errors each get a distinct JSON error instead of a crash.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 4: Data notes, takeaway and the callback CSV

**Files:**
- Modify: `src/server/api.ts`, `src/server/app.ts`
- Create: `tests/server/endpoints.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3; `callbacksToCsv` (Task 2); `DataNotes`; `ViewName`.
- Produces:
  ```ts
  // api.ts (add)
  export interface AiStatus { status: 'on' | 'off' | 'budget_reached'; spendUsd: number; cacheHits: number; checkerFailures: number }
  export interface DataNotesResponse { dataNotes: DataNotes; ai: AiStatus }
  export interface TakeawayResponse { view: ViewName; text: string; source: 'template'; reason: 'ai_off' }
  ```
  - `GET /api/data-notes`: `{ dataNotes: store.dataNotes, ai: { status: 'off', spendUsd: 0, cacheHits: 0, checkerFailures: 0 } }`. The `ai` shape is final so Phase 9 only fills it in. No dev flag is checked.
  - `GET /api/takeaway/:view`: `:view` is one of the four names, else 400 `unknown_view`. Parses the query exactly as that view's own route does, builds that view, returns `{ view, text: view.templateSentence, source: 'template', reason: 'ai_off' }`. Never reads `ANTHROPIC_API_KEY`.
  - `GET /api/missed-calls/callbacks.csv`: parses like Missed calls, builds the view, writes `"\uFEFF" + callbacksToCsv(view.callbacks.rows)` with `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="callbacks-<range.start>-to-<range.end>.csv"` (dates only, so the header can't carry user text). Errors are the normal JSON errors, not CSV.

- [ ] **Step 1: Write the failing tests** in `endpoints.test.ts` on `serverFixture()`.
  - `data notes`: `/api/data-notes` is 200 with `dataNotes` equal to the store's notes (build a store with `dataNotes: { badRows: 12, duplicateRowsCollapsed: 7 }` to prove pass-through) and `ai` equal to `{ status: 'off', spendUsd: 0, cacheHits: 0, checkerFailures: 0 }`; it answers without any `dev` parameter and with `?dev` alike.
  - `takeaway, one per view` (`it.each` over the four names): 200, `{ view, text, source: 'template', reason: 'ai_off' }`; `text` equals `buildX(...).templateSentence` for the same range; no `{` or `}` in `text`.
  - `takeaway follows the query`: `?range=last7` gives the last-7 text for Overview (differs from the default's when the numbers differ, else equals the builder's, assert against the builder in both cases); `/api/takeaway/missed-calls?location=loc_a` equals the filtered view's sentence; `/api/takeaway/campaigns?campaign=nope` is 400 `unknown_campaign`; `?range=bad` is 400; an empty export is 409.
  - `takeaway for an unknown view is 400`: `/api/takeaway/nope` gives `unknown_view`, message lists the four names.
  - `a key in the environment changes nothing`: with `vi.stubEnv('ANTHROPIC_API_KEY', 'not-a-real-key')`, `/api/takeaway/overview` and `/api/data-notes` return the same as without it (`source 'template'`, `ai.status 'off'`).
  - `callbacks CSV, headers`: `/api/missed-calls/callbacks.csv?range=last7`: 200, `content-type` `text/csv; charset=utf-8`, `content-disposition` `attachment; filename="callbacks-2026-09-08-to-2026-09-14.csv"`.
  - `callbacks CSV, body`: the text starts with `\uFEFF` then the header line exactly `caller_hash,unanswered_attempts,last_attempt_local,office,campaign,tracking_number,estimated_value_usd`; lines end CRLF; the number of data lines equals `callbacks.rows.length` from `/api/missed-calls?range=last7` for the same query (7 here), and the first data line's `caller_hash` equals that JSON's first row's `callerHash`.
  - `callbacks CSV follows the office filter`: `?range=all&location=loc_b` has 14 data lines; `location=loc_a` has none (header only, still 200).
  - `callbacks CSV escapes names from the data`: a store whose campaign is named `Spring, "Big" Sale` and whose office is `=HYPERLINK("x")`, with a tracking number `+1-555-0190`: the data line reads `…,'=HYPERLINK(""x"")` correctly quoted, `"Spring, ""Big"" Sale"` and `'+1-555-0190`; a campaign named `Café 東京` appears byte-for-byte after the BOM. (Review Focus 3)
  - `callbacks CSV errors are JSON, not CSV`: `?start=2027-01-01&end=2027-01-31` is 400 `application/json` with `outside_data`; `?location=nope` is 400 `unknown_location`; an empty export is 409 `no_data`.
  - `the CSV and the JSON agree`: for `?range=all`, every `caller_hash` in the CSV is a `callerHash` in the JSON and the totals of `estimated_value_usd` (summed in cents) equal `callbacks.totalValueUsd`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/server/endpoints.test.ts`
  Expected: FAIL (404 `not_found` for the new routes).

- [ ] **Step 3: Implement the three routes** in `createApp`, reusing the Task 3 helper for parsing and errors. The takeaway route picks the builder and `wants` from a small table keyed by view name, the same table the view routes use, so the two can't drift.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/server/endpoints.test.ts tests/server/app.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/server/api.ts src/server/app.ts tests/server/endpoints.test.ts
  git commit -m "feat: data notes, template takeaway and callback CSV endpoints

  The takeaway is the view's template sentence for now and never reads the API key, so the app is whole with AI off; the CSV is the on-screen list in a spreadsheet-safe encoding.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 5: Serving the built web app

**Files:**
- Create: `src/server/staticFiles.ts`, `tests/server/static.test.ts`
- Modify: `src/server/app.ts`

**Interfaces:**
- Consumes: `AppOptions.webRoot` (Task 3); `tempDir` (`tests/server/helpers.ts`).
- Produces:
  ```ts
  export function serveWebApp(webRoot: string): MiddlewareHandler;   // registered last, after every /api route
  ```
  `createApp` uses `options.webRoot ?? 'dist'` (Vite's default output folder, which Phase 7 keeps) and registers `serveWebApp` only for paths not starting `/api/`. Behaviour: if `<webRoot>/index.html` exists at startup, a request for an existing file under `webRoot` returns it with its content type; `/` and any path **without a file extension** return `index.html` (the URL holds view state, so a refresh must work); a path **with** an extension that doesn't exist is a plain-text 404. If there is no `index.html`: `/` is 200 `text/plain` saying the web app isn't built and naming `/api/meta`; every other non-API path is a plain-text 404.

- [ ] **Step 1: Write the failing tests.** Build a web folder with `tempDir()`: `index.html` (`<html>app</html>`), `assets/app.js` (`console.log(1)`), `assets/app.css`; remove it in `afterEach`.
  - `files are served with their content type`: `/assets/app.js` is 200, `content-type` contains `javascript`, body `console.log(1)`; `/assets/app.css` contains `text/css`; `/` is `index.html`.
  - `a refreshed view path returns the app`: `/campaigns` and `/campaigns/anything` return the `index.html` text.
  - `a missing asset is a 404, never the app`: `/assets/missing.js` is 404 and its body does not contain `<html>`.
  - `the API never falls back to the app`: `/api/nope` is the JSON 404, `/api/meta` is still JSON, even with a web folder present.
  - `a path outside the web folder is never served` (Review Focus 4, `it.each`): `/../package.json`, `/%2e%2e/package.json`, `/..%2fpackage.json`, `/..%5cpackage.json`, `/assets/../../package.json`: the response body never contains `"name": "invoca"` (404, or the app's `index.html`, either is acceptable).
  - `no build yet`: with a `webRoot` that doesn't exist, `/` is 200 `text/plain` containing `/api/meta`; `/campaigns` and `/assets/app.js` are 404; `/api/meta` still works.
  - `an index.html added later is not picked up` is **not** tested; the decision is made at startup (a comment says so).

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/server/static.test.ts`
  Expected: FAIL (the app answers 404 or the placeholder is missing).

- [ ] **Step 3: Implement `serveWebApp`** with `serveStatic` from `@hono/node-server/serve-static` (its `root` is relative to the current directory: pass `path.relative(process.cwd(), webRoot)`; `tempDir()` lives under the repo for that reason). If it can't pass the traversal tests or the extension rule, replace it with a small handler of your own (read the file, map extension to type, refuse any resolved path that doesn't start with the resolved `webRoot`) and record that in `docs/DECISIONS.md`.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/server/static.test.ts tests/server/app.test.ts tests/server/endpoints.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/server/staticFiles.ts src/server/app.ts tests/server/static.test.ts
  git commit -m "feat: serve the built web app, with refresh-safe routes and no path escape

  The URL carries the view state, so non-file paths return index.html; a missing asset must 404 so a broken build isn't hidden by an HTML page.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 6: Startup, configuration and `npm start`

**Files:**
- Create: `src/server/config.ts`, `src/server/start.ts`, `src/server/cli.ts`, `tests/server/start.test.ts`, `tests/server/cli.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `readExportFromDir` (`src/node/readDataDir.ts`); `loadDotEnv` (`src/node/env.ts`); `LoadError`; `cleanExport`; `createApp`; `serve` from `@hono/node-server`; `tempDir`.
- Produces:
  ```ts
  // config.ts
  export class ConfigError extends Error {}
  export function parsePort(value: string | undefined): number;   // undefined, '' or whitespace -> 3000; else an integer 1-65535, otherwise ConfigError naming PORT and the (shortened) value

  // start.ts
  export interface StartOptions { dataDir?: string; port?: number; webRoot?: string }   // port 0 picks a free port (tests); omitted -> parsePort(process.env.PORT)
  export interface RunningServer { port: number; url: string; store: CallStore; close(): Promise<void> }
  export async function start(options?: StartOptions): Promise<RunningServer>;
  //   loadDotEnv() first (the shell still wins), then the port, then readExportFromDir(options.dataDir) and cleanExport, then listen on 127.0.0.1.
  //   Throws LoadError for data problems and ConfigError for a bad or busy port (EADDRINUSE: "Port N is already in use. Set PORT to a free port.").
  ```
  `cli.ts` calls `start()`, prints one line to stdout (`Serving <n> calls, data as of <date>, at <url>`, plus `<n> rows skipped` when any, plus each load note such as an empty-file note), and on a `LoadError` or `ConfigError` prints `Cannot start: <message>` to stderr and exits 1 with no stack trace. Any other error is left to Node (non-zero exit, stack shown).

- [ ] **Step 1: Write the failing tests.**
  - `start.test.ts`, with `start({ dataDir: 'tests/fixtures/original-export', port: 0 })` and a real `fetch`, closed in `afterEach`:
    - `serves the shipped export over HTTP`: `/api/meta` is 200 with `hasData true` and `callCount 5000`; `url` starts `http://127.0.0.1:`.
    - `listens on loopback only`: the server's address is `127.0.0.1`, not `0.0.0.0` or `::`. (Review Focus 5)
    - `close stops it`: after `close()`, a `fetch` to the same URL rejects.
    - `a missing data folder is a clear LoadError`: `start({ dataDir: 'no/such/folder', port: 0 })` rejects with `LoadError`, message contains `Data folder not found` and `no/such/folder`.
    - `a folder without calls.csv names the file`: an empty `tempDir()` rejects with `LoadError` whose message contains `calls.csv`.
    - `a missing column names the file and column`: a folder whose `calls.csv` header lacks `started_at` (valid `campaigns.csv` and `locations.csv` copied from the fixture) rejects with a message containing `calls.csv` and `started_at`.
    - `an empty export starts and says so`: a folder with a header-only `calls.csv`: it starts; `/api/meta` is `hasData false` with a note mentioning the empty file; `/api/overview` is 409 `no_data`. (Review Focus 1)
    - `a busy port is a clear ConfigError`: start on port 0, read its port, start a second on that port: rejects with `ConfigError`, message contains `already in use` and the port number. (Review Focus 5)
    - `bad rows do not stop startup`: a folder whose `calls.csv` has one good row and one row with an unknown location starts; `/api/meta` `skippedRows 1`.
    - `parsePort` (`it.each`): `undefined`, `''`, `'  '` give 3000; `'8080'` gives 8080; `'1'` and `'65535'` are accepted; `'abc'`, `'0'`, `'65536'`, `'3000.5'`, `'-1'`, `'80 80'`, `'0x50'` throw `ConfigError` with a message containing `PORT`.
  - `cli.test.ts`, running `process.execPath` with `['--import', 'tsx', 'src/server/cli.ts']` through `spawnSync` (timeout 30 s, `encoding: 'utf8'`, env = `process.env` plus the case's variables):
    - `a missing data folder exits 1 with one clear line`: `DATA_DIR=no/such/folder` with `PORT=3999` gives `status 1`, `stderr` starts `Cannot start: Data folder not found`, and `stderr` has no line matching `/^\s+at /m` (no stack).
    - `a bad PORT exits 1`: `DATA_DIR=tests/fixtures/original-export`, `PORT=abc` gives `status 1`, `stderr` contains `Cannot start:` and `PORT`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/server/start.test.ts tests/server/cli.test.ts`
  Expected: FAIL, cannot resolve `../../src/server/start`.

- [ ] **Step 3: Implement `config.ts`, `start.ts` and `cli.ts`.** Listen with `serve({ fetch: app.fetch, port, hostname: '127.0.0.1' })` and resolve once it is listening; turn the server's `error` event for `EADDRINUSE` into the `ConfigError` above and let other listen errors through. `close()` waits for the server to finish closing.

- [ ] **Step 4: Update `README.md`.** Commands table: `npm start` is now available (serves the JSON API and, once Phase 7 builds it, the web app; reads `.env`); `npm run dev` stays "not built yet". Add a short "API" section: the route table above, the query parameters, the error shape and statuses, the CSV encoding and its leading-`'` note, and "listens on 127.0.0.1 only". Do not mention anything the server doesn't do yet beyond the Phase 7 line.

- [ ] **Step 5: Run to verify they pass**

  Run: `npx vitest run tests/server`
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add src/server/config.ts src/server/start.ts src/server/cli.ts tests/server/start.test.ts tests/server/cli.test.ts README.md
  git commit -m "feat: start the server from the command line, with clear startup errors

  A missing folder, file or column and a bad or busy port each print one line and exit 1; the server listens on loopback only because the callback list carries caller hashes.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 7: Every endpoint on the shipped and extended exports, and the hard-coding guard

**Files:**
- Create: `tests/snapshot/original-export-server.test.ts`, `tests/snapshot/extended-export-server.test.ts`
- Modify: `tests/core/different-names.test.ts`

**Interfaces:**
- Consumes: `start` (Task 6); the builders; `cleanExport`, `readExportFromDir`, `resolveRange`, `dataSpan` as in `tests/snapshot/original-export-views.test.ts`; `createApp`.
- Produces: nothing new in `src/`.

- [ ] **Step 1: Write the tests.**
  - `original-export-server.test.ts` (`start({ dataDir: 'tests/fixtures/original-export', port: 0 })`, real `fetch`):
    - `meta`: `hasData true`, `callCount 5000`, `span.start` before `span.end`, 12 campaigns, 8 offices.
    - `data notes`: `rowsRead 5411`, `callsAfterDedup 5000`, `unattributedCalls 144`, `ai.status 'off'`.
    - `every view answers on the default range`: `/api/overview`, `/api/campaigns`, `/api/locations`, `/api/missed-calls` are 200 with no parameters, and `notes.comparison.available` is true (60 days of data, last 28 against the 28 before).
    - `overview totals match the known export`: `?range=all`: `tiles.calls.current 5000`, `bookings.current 1204`, `revenueUsd.current 432894`, `uniqueCallers.current 2040`; every `change.kind` is `none`.
    - `the server returns what the builder builds`: for each view with `?range=all`, the response equals `JSON.parse(JSON.stringify(buildX(store, allRange)))`, using a store from `cleanExport(readExportFromDir(...))`.
    - `campaigns keep their unattributed row`: `?range=all`: `unattributed.calls 144`.
    - `locations: nothing stands out` and `missed calls: 1055 unanswered` as Phase 5 pinned them (`actions[0].kind 'no_office_stands_out'`; `unansweredCalls 1055`).
    - `the callback CSV matches the view`: `?range=all` data-line count equals `callbacks.rows.length`; the file opens with the byte-order mark and the header.
    - `a takeaway for each view`: 200, `source 'template'`, non-empty text.
    - `bad input never reaches a builder`: `?start=nope&end=2026-09-05` is 400; the same server answers `/api/meta` 200 afterwards.
  - `extended-export-server.test.ts` (`dataDir: 'data/extended'`): `meta.callCount` equals `OBSERVED`'s known total from `tests/snapshot/extended-export.test.ts` (import it, don't retype it); `/api/locations?range=all` has `actions[0].kind` `review_office_answer` or `review_office_booking`; `/api/missed-calls?range=all&location=loc_06` is 200 with `officeFilter.name` equal to that office's name from `/api/meta` and `busiestSlot` set; `/api/campaigns?range=last28&campaign=cmp_04` is 200 with `weekly.campaignId 'cmp_04'`.
  - `different-names.test.ts`: add `describe('the server on a different export')`: `createApp(store)` on the existing Quokka/Wombat/London store; for `range=all` and `range=last7`, the four view routes and `/api/missed-calls/callbacks.csv` are 200; the Campaigns body's rows are named `Quokka Promo` and `Wombat Weekend`; `/api/missed-calls?location=zz_lon` names `London Desk`; `/api/campaigns?campaign=zz_c1` is 200; `/api/meta` lists the three offices. This is the "nothing hard-coded to this dataset" proof for the server.

- [ ] **Step 2: Run them**

  Run: `npx vitest run tests/snapshot/original-export-server.test.ts tests/snapshot/extended-export-server.test.ts tests/core/different-names.test.ts`
  Expected: PASS. If a known total is off, stop and report it; do not adjust the expected numbers. If the hard-coding scan fails, a real date, name or `+1-555` has slipped into `src/server/`; fix the source.

- [ ] **Step 3: Run the whole suite and typecheck**

  Run: `npm test` then `npm run typecheck`
  Expected: all tests pass, no type errors. Show both outputs.

- [ ] **Step 4: Run it for real** (the done-when line). From the repo root, with the shipped CSVs as the default data folder:

  Run: `PORT=3917 npm start` in the background, then `curl -s -o /dev/null -w "%{http_code} %{content_type}\n"` against `/api/meta`, `/api/overview`, `/api/campaigns`, `/api/locations`, `/api/missed-calls`, `/api/missed-calls/callbacks.csv`, `/api/takeaway/overview`, `/api/data-notes` at `http://127.0.0.1:3917`; then `curl -s "http://127.0.0.1:3917/api/overview?range=all"` and read the tiles; then `curl -s "http://127.0.0.1:3917/api/overview?start=nope&end=x"` (expect a 400 JSON error). Stop the server.
  Expected: eight `200` lines with `application/json` (the CSV line `text/csv`), the Overview tiles `5000` calls, `1204` bookings, `432894` revenue, and the 400 body. Show the output, then **stop and wait for review**.

- [ ] **Step 5: Commit**

  ```bash
  git add tests/snapshot/original-export-server.test.ts tests/snapshot/extended-export-server.test.ts tests/core/different-names.test.ts
  git commit -m "test: serve every endpoint on the shipped, extended and differently named exports

  Pins that the HTTP layer returns exactly what the builders build and never depends on this dataset's names.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

## Edge-case coverage (PLAN.md Phase 6 list)

| PLAN.md edge case | Test |
| --- | --- |
| missing or malformed date params (400 with message) | Task 1: `malformed dates are bad_date…`, `start alone or end alone is bad_param`; Task 3: `bad parameters are 400 with a message` |
| inverted range | Task 1: `an inverted range is start_after_end`; Task 3: `an inverted range is 400` |
| range outside data | Task 1 and Task 3: `a range outside the data is…`; partial overlap stays 200 (Task 3) |
| unknown campaign in the weekly-chart param | Task 3: `an unknown campaign for the weekly chart is 400` |
| CSV escaping of fields | Task 2 (`csvCell`, `toCsv`, `callbacksToCsv`); Task 4: `callbacks CSV escapes names from the data` |
| startup with a missing data folder (clear error, non-zero exit) | Task 6: `a missing data folder is a clear LoadError` and, as a real process, `cli.test.ts` (exit 1, one line, no stack) |

## Self-review notes

- **Spec coverage:** view endpoints with range A and optional range B (Tasks 1, 3); data notes (Task 4); takeaway, template only (Task 4); callback CSV with the PLAN.md 4.4 columns (Tasks 2, 4); the built front end (Task 5); 400 on bad parameters (Tasks 1, 3); load once at startup, clear failure on a bad folder (Task 6); done-when "in-process endpoint tests pass" (Tasks 1-5, 7) and "`npm start` serves JSON for every view on the shipped data" (Task 7 Step 4). PLAN.md 3.4's "endpoint stays available without the flag" is the no-`dev` test in Task 4.
- **Type consistency:** `ApiError`, `Parsed`, `ViewQuery`, `statusFor`, `shorten` (Task 1) are used by Tasks 3, 4 and 6; `Meta` and the Task 4 response types live in `api.ts` with `PRESETS`; `serverFixture`, `get`, `tempDir` (Task 1) are used by Tasks 3 to 6; `callbacksToCsv` (Task 2) by Task 4; `AppOptions.webRoot` (Task 3) by Task 5; `start` (Task 6) by Tasks 6 and 7.
- **Proportion:** PLAN.md's Phase 6 is about 10 lines; this plan is longer because it pins the URL contract and every error, which the spec leaves open. It holds no function bodies.
- **Not in this phase:** the web app, `npm run dev`, a build step for `npm start` (Phase 7); AI, its cache, guard and log, and reading the API key (Phase 9); live reload of data; authentication; CORS (Phase 7's dev server proxies `/api`); sorting a table by another column; per-day comparison of unequal ranges (S2).
