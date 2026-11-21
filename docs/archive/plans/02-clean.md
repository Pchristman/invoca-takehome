# Phase 2 (Clean) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure `cleanExport(loaded)` that turns Phase 1's `LoadedExport` into a `CallStore` (one typed, localized call per `call_id`) plus the data-notes summary PLAN.md section 3.4 lists.

**Architecture:** Three small pure modules, then one assembler. `dedupe` picks the winning row per call over *all* rows (good and bad), so a bad latest row cannot resurrect an older good one. `localTime` derives local date, hour and weekday from an IANA zone. `cleanExport` turns winners into `CleanCall`s (attribution, pending, revenue rule) and tallies the notes. `outcomeLag` measures the lag from the data. No I/O, no new dependencies.

**Tech Stack:** Node 24, TypeScript (strict), vitest. Built-in `Intl` only.

**Spec:** `PLAN.md` (sections 3.3, 3.4, 5 rules 2, 4, 5, 6, 7 and Phase 2 in section 9), `docs/BRIEF.md`, `CLAUDE.md`, and `docs/plans/01-scaffold-and-load-validate.md` for the types this consumes.

## Global Constraints

- Work **one task at a time**. After the last task run `npm test` and `npm run typecheck`, show the output, then **stop** and wait (CLAUDE.md).
- **No new dependencies.** Ask first if one seems needed.
- Phase 2 done-when, verbatim from PLAN.md: "the shipped export cleans to 5,000 calls, 1,204 bookings, $432,894 revenue and 144 unattributed, and every rule in section 5 has its own passing test."
- Dedupe happens **before** validity decides a row. Winner = latest `updated_at`; tie keeps the later row in the file and is counted; an unparseable `updated_at` loses to any parseable one. (rule 2)
- Empty `campaign_id` is "Unattributed" and is never dropped. Unknown non-empty campaign is already a bad row from Phase 1. (rule 4)
- Timestamps are UTC; local date, hour and weekday come from the **office's** zone via `Intl`. (rule 5)
- Revenue counts only when the current outcome is `booked`. Booked with empty revenue is a booking with $0 revenue. (rule 6)
- Answered with empty outcome is "pending": counts as a call and as answered, never as a booking. (rule 7)
- Outcome lag is measured from the data, never hard-coded. (section 3.3)
- Nothing hard-coded to this dataset: no campaign, office, tracking-number or date literals in `src/`. (rule 11)
- Never read, print or `git add` `.env`. Do not write to `docs/AI_COST_LOG.md` or edit `docs/BRIEF.md`.
- Commit after each task, small, message says why, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Prefer simple, readable code; a reviewer will walk through all of it.

## Issues found in PLAN.md (decide before or during review)

1. **"Calls after removing duplicates" is ambiguous when a call ends up bad.** Phase 2 reports both: `callsAfterDedup` (distinct calls, good or bad) and `store.calls.length` (good only). On the shipped export they are both 5,000. Bad rows are re-counted **per call** here (Phase 1 counted per raw row, DECISIONS 2026-11-18).
2. **Rows with an empty `call_id` (`missing_call_id`) cannot be grouped.** Each is treated as its own call and reported bad. They are not counted as duplicates.
3. **"Outcome lag" needs a precise definition.** PLAN.md says "the longest gap between a call starting and a later row updating its outcome". Proposed: for each call with two or more rows having parseable `updated_at`, if the winner's outcome or revenue differs from the earliest row's, the lag is `winner.updatedAt - startedAt`. The result is the maximum, rounded **up** to whole days (shipped data: about 71.7 hours, so 3 days). Pure duplicates that change nothing do not count. Negative gaps count as 0. Added to `docs/DECISIONS.md` as proposed.
4. **"Duplicate rows that tied" is counted per call**, not per row (a call whose latest `updated_at` is shared by two or more rows counts once). The shipped export has none, so the tie test uses a fixture.
5. **Weekday numbering** is chosen here for Phase 3's weeks: `0 = Monday ... 6 = Sunday`. (PLAN.md rule 10 says weeks run Monday to Sunday.)
6. **A call with no valid rows and an all-unparseable `updated_at`** keeps the later row in the file. This is not counted as a tie; `unparseableUpdatedAt` from Phase 1 already reports it.

## Review Focus

Inputs the spec implies but no listed edge case names. Each has a test in the owning task.

1. **Empty `call_id` rows never merge.** Two rows with empty ids stay two bad calls. (Task 1)
2. **A pure duplicate row (identical content, later `updated_at`) is collapsed but does not inflate the outcome lag.** (Task 4)
3. **Booked with an explicit `0` revenue is not "booked with no revenue".** Only an empty field is counted. (Task 3)
4. **An export with zero calls cleans to an empty store and zero notes without throwing.** (Task 3)
5. **The ambiguous hour when clocks fall back** gives a valid local hour and the right local date, never `24` or a thrown error. (Task 2)

---

## File Structure

```
src/core/dedupe.ts        dedupeRows: all raw rows -> one winner per call + dedupe counts
src/core/localTime.ts     localParts: (Date, IANA zone) -> local date, hour, weekday
src/core/outcomeLag.ts    measureOutcomeLagDays: rows -> whole days
src/core/clean.ts         cleanExport: LoadedExport -> CallStore (CleanCall[] + DataNotes)
src/core/types.ts         (modify) add CleanCall, DataNotes, CallStore
tests/core/dedupe.test.ts
tests/core/localTime.test.ts
tests/core/outcomeLag.test.ts
tests/core/clean.test.ts
tests/snapshot/original-export-clean.test.ts
tests/core/different-names.test.ts
```

One shared test helper for building rows lives in `tests/core/helpers.ts` (created in Task 1, reused by Tasks 3 and 4).

---

### Task 1: Deduplicate rows (rule 2)

**Files:**
- Create: `src/core/dedupe.ts`, `tests/core/dedupe.test.ts`, `tests/core/helpers.ts`

**Interfaces:**
- Consumes: `RowResult`, `Call`, `BadRow` from `src/core/types.ts`.
- Produces:
  ```ts
  export interface DedupeResult {
    /** One entry per call, in order of each call's first appearance in the file. */
    winners: RowResult[];
    /** Every raw row for the call, file order; same index as `winners`. */
    groups: RowResult[][];
    rowsRead: number;
    duplicateRowsCollapsed: number;
    /** Calls whose latest updated_at was shared by two or more rows. */
    tiedCalls: number;
  }
  export function dedupeRows(rows: RowResult[]): DedupeResult;
  ```
  `tests/core/helpers.ts` exports `goodRow(over?)` (a `Record<string,string>` with every call column filled, same shape as the helper in `tests/core/loadExport.test.ts`), `callsCsv(rows)`, `CAMPAIGNS`, `LOCATIONS` and `loadFixture(rows, campaigns?, locations?) -> LoadedExport`. Move them out of `loadExport.test.ts` by copy; leave that file as is.

- [ ] **Step 1: Write the failing tests** in `tests/core/dedupe.test.ts`. Build rows with `loadFixture` and pass `.rows` in. Tests, each with its assertions:
  - `three rows for one call arriving out of order keep the latest updated_at`: updated_at order Mar 3, Mar 1, Mar 5, with differing `outcome` (`qualified_lead`, `missed`... use `answered`/`outcome` pairs that stay consistent: `qualified_lead`, `not_qualified`, `booked`). Expect `winners` length 1, winner `outcome === 'booked'`, `duplicateRowsCollapsed === 2`, `rowsRead === 3`, `groups[0]` has length 3 in file order.
  - `an updated_at tie keeps the later row in the file and counts the call once`: two rows same `updated_at`, `agent_id` `a1` then `a2`. Winner `agentId === 'a2'`, `tiedCalls === 1`. A second call with three rows where only two tie at the max also gives `tiedCalls === 2` overall (not 3).
  - `a tie below the maximum is not a tie`: rows at Mar 1, Mar 1, Mar 5. `tiedCalls === 0`.
  - `a bad latest row beats an older good row, so the call is bad`: good row Mar 3, row with `location_id: 'loc_zzz'` Mar 9. Winner `ok === false`, `reason === 'unknown_location'`.
  - `a good latest row beats an older bad row`: reverse of the above; winner `ok === true`.
  - `an unparseable updated_at loses to any parseable one`: row A `updated_at: 'garbage'` listed last, row B Mar 1. Winner is B.
  - `all rows unparseable keeps the later row and does not count a tie`: two garbage rows, `agent_id` `a1` then `a2`. Winner `a2`, `tiedCalls === 0`.
  - `rows with an empty call_id are never merged`: two rows `call_id: ''`. `winners` length 2, `duplicateRowsCollapsed === 0`.
  - `winners follow first appearance order`: calls `c2, c1, c2` gives winners ordered `c2, c1`.
  - `no rows gives an empty result`: all counts 0.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/core/dedupe.test.ts`
  Expected: FAIL, cannot resolve `../../src/core/dedupe`.

- [ ] **Step 3: Implement `dedupeRows(rows: RowResult[]): DedupeResult` in `src/core/dedupe.ts`**

  Group by `callId` (good rows: `row.call.callId`; bad rows: `row.bad.callId`) in a `Map` to keep first-appearance order; an empty `callId` forms its own group per row. Winner: reduce each group left to right, replacing the best when the candidate's `updatedAt` is greater **or equal** (equal makes the later row win), treating `null` as earlier than any date; two nulls also replace (later wins). `tiedCalls` counts groups where two or more rows have a parseable `updatedAt` equal to the winner's. Keep the helper `updatedAtOf(row: RowResult): Date | null` private.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/core/dedupe.test.ts`
  Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/dedupe.ts tests/core/dedupe.test.ts tests/core/helpers.ts
  git commit -m "feat: dedupe call rows before validity picks a winner

  A bad latest row must make the call bad, not fall back to an older good row.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 2: Localize timestamps (rule 5, rule 10 weekday)

**Files:**
- Create: `src/core/localTime.ts`, `tests/core/localTime.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. Zone names are the canonical names Phase 1 stored in `Location.timezone`.
- Produces:
  ```ts
  export interface LocalParts {
    /** Local calendar date, "YYYY-MM-DD". */
    date: string;
    /** 0-23. */
    hour: number;
    /** 0 = Monday ... 6 = Sunday. */
    weekday: number;
  }
  export function localParts(instant: Date, timeZone: string): LocalParts;
  ```

- [ ] **Step 1: Write the failing tests** in `tests/core/localTime.test.ts` (table-driven where it reads well):
  - `a call at 02:00 UTC is the previous local day in Denver`: `2026-10-05T02:00:00Z`, `America/Denver` gives `{ date: '2026-10-04', hour: 20, weekday: 6 }` (Sunday evening).
  - `Phoenix and Denver differ by an hour for the same instant in the same week`: `2026-09-15T20:00:00Z` gives Phoenix hour 13, Denver hour 14; both date `2026-09-15`.
  - `Phoenix has no DST change but Denver does`: for the instant `2026-11-02T20:00:00Z` (after Denver's fall back), Phoenix hour 13, Denver hour 13. For `2026-10-30T20:00:00Z` (before), Phoenix 13, Denver 14.
  - `midnight local is hour 0, never 24`: `2026-10-05T06:00:00Z` in Denver gives hour 0, date `2026-10-05`.
  - `the repeated hour when clocks fall back stays valid`: `2026-11-01T07:30:00Z` and `2026-11-01T08:30:00Z` in `America/Denver` both give date `2026-11-01`, hour 1, no throw.
  - `year boundary`: `2027-01-01T03:00:00Z` in `America/New_York` gives `2026-12-31`, hour 22, weekday 3 (Thursday).
  - `weekday numbering`: `2026-10-05` (a Monday) at noon UTC in `UTC` gives weekday 0; `2026-10-11` gives 6.
  - `a zone ahead of UTC moves the date forward`: `2026-10-05T20:00:00Z` in `Pacific/Auckland` gives date `2026-10-06`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/core/localTime.test.ts`
  Expected: FAIL, cannot resolve `../../src/core/localTime`.

- [ ] **Step 3: Implement `localParts(instant: Date, timeZone: string): LocalParts` in `src/core/localTime.ts`**

  Use `Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short' })` and `formatToParts`. `h23` is what keeps midnight at 0 (`hour12: false` can return 24). Cache one formatter per zone in a module-level `Map`; with 5,000 calls this matters. Map the short weekday name to 0-6 with a Monday-first lookup array.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/core/localTime.test.ts`
  Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/localTime.ts tests/core/localTime.test.ts
  git commit -m "feat: derive local date, hour and weekday from an office zone

  Every day and hour view must use the office's clock, not UTC.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 3: Assemble the store: attribution, pending, revenue, notes (rules 4, 6, 7)

**Files:**
- Modify: `src/core/types.ts` (append the three types below)
- Create: `src/core/clean.ts`, `tests/core/clean.test.ts`

**Interfaces:**
- Consumes: `dedupeRows` (Task 1), `localParts` (Task 2), `LoadedExport`, `Call`, `BadRow`, `BadReason`, `BAD_REASONS`, `Campaign`, `Location`, `Outcome`, `Channel` from `src/core/types.ts`. Task 4's `measureOutcomeLagDays` is wired in by Task 4, not here; `DataNotes.outcomeLagDays` is `0` until then.
- Produces, in `src/core/types.ts`:
  ```ts
  export interface CleanCall {
    callId: string;
    startedAt: Date;
    durationSeconds: number;
    callerHash: string;
    trackingNumber: string;
    /** null = "Unattributed" (empty campaign_id in the file). */
    campaignId: string | null;
    unattributed: boolean;            // campaignId === null
    channel: Channel;
    locationId: string;
    answered: boolean;
    outcome: Outcome | null;
    booked: boolean;                  // outcome === 'booked'
    pending: boolean;                 // answered && outcome === null
    /** Counted revenue: the file's value on a booked call (0 if empty), otherwise 0. */
    revenueUsd: number;
    agentId: string | null;
    localDate: string;                // "YYYY-MM-DD" in the office zone
    localHour: number;                // 0-23
    localWeekday: number;             // 0 = Monday ... 6 = Sunday
  }
  export interface DataNotes {
    rowsRead: number;
    callsAfterDedup: number;          // distinct calls, good or bad
    duplicateRowsCollapsed: number;
    tiedCalls: number;
    unattributedCalls: number;
    /** Tracking numbers on unattributed calls, most calls first, ties by number. */
    unattributedTrackingNumbers: { trackingNumber: string; calls: number }[];
    pendingCalls: number;
    /** Per CALL after dedupe. Every reason present. */
    badCallsByReason: Record<BadReason, number>;
    badCalls: number;
    /** Calls with revenue on a non-booked current row (ignored), and the dollars ignored. */
    revenueOnNonBookedCalls: number;
    revenueOnNonBookedUsd: number;
    /** Booked calls whose revenue field is empty (counted as $0). */
    bookedWithoutRevenueCalls: number;
    /** Whole days; 0 when no later row ever updated an outcome. Set in Task 4. */
    outcomeLagDays: number;
    /** Carried over from LoadedExport. */
    unparseableUpdatedAt: number;
    notes: string[];
  }
  export interface CallStore {
    calls: CleanCall[];               // file order of each call's first row
    campaigns: Campaign[];
    locations: Location[];
    dataNotes: DataNotes;
  }
  ```
  and `export function cleanExport(loaded: LoadedExport): CallStore` in `src/core/clean.ts`.

- [ ] **Step 1: Write the failing tests** in `tests/core/clean.test.ts` using `loadFixture` and `goodRow` from `tests/core/helpers.ts`. One test per rule, each on a 1-5 row fixture:
  - `rule 2: three rows for one call clean to one call with the latest outcome`: reuse the Task 1 shape through `cleanExport`; `calls` length 1, `dataNotes.rowsRead === 3`, `duplicateRowsCollapsed === 2`, `callsAfterDedup === 1`.
  - `rule 2: a bad latest row makes the call bad and is reported once, per call`: good Mar 3 then `location_id: 'loc_zzz'` Mar 9. `calls` empty, `badCalls === 1`, `badCallsByReason.unknown_location === 1`, and `loaded.badByReason.unknown_location` is also 1 (per raw row) while a variant with a second bad row for the same call still gives `badCallsByReason.unknown_location === 1`.
  - `rule 2: a tie is counted in the notes`: `tiedCalls === 1`.
  - `rule 4: an empty campaign_id is Unattributed and kept`: `campaignId === null`, `unattributed === true`, `unattributedCalls === 1`, `unattributedTrackingNumbers` equals `[{ trackingNumber: '+1-555-0190', calls: 2 }, { trackingNumber: '+1-555-0191', calls: 1 }]` for three such calls (set the three tracking numbers in the fixture).
  - `rule 4: an unknown non-empty campaign is bad, not Unattributed`: `calls` empty, `badCallsByReason.unknown_campaign === 1`, `unattributedCalls === 0`.
  - `rule 5: local fields use the office zone`: a call `2026-10-05T02:00:00Z` at `loc_2` (Denver) has `localDate === '2026-10-04'`, `localHour === 20`, `localWeekday === 6`; the same instant at `loc_1` (Phoenix) has `localHour === 19`.
  - `rule 6: revenue on a non-booked row is ignored and counted`: `outcome: 'qualified_lead'`, `revenue_usd: '120.50'`. `revenueUsd === 0`, `revenueOnNonBookedCalls === 1`, `revenueOnNonBookedUsd === 120.5`.
  - `rule 6: only the current row decides the revenue`: older row booked with `250`, latest row `not_qualified` with empty revenue. `booked === false`, `revenueUsd === 0`, `revenueOnNonBookedCalls === 0`.
  - `rule 6: booked with empty revenue is a booking at $0 and is counted`: `booked === true`, `revenueUsd === 0`, `bookedWithoutRevenueCalls === 1`.
  - `rule 6: booked with an explicit 0 is not "without revenue"`: `revenue_usd: '0'` gives `bookedWithoutRevenueCalls === 0`.
  - `rule 7: answered with no outcome is pending`: `pending === true`, `booked === false`, `answered === true`, `pendingCalls === 1`.
  - `rule 7: unanswered with no outcome is not pending`: `answered: 'false'`, `outcome: ''`, `pending === false`, `pendingCalls === 0`.
  - `carries Phase 1 counts through`: an `updated_at: 'garbage'` row gives `dataNotes.unparseableUpdatedAt === 1`; a header-only calls file gives `calls` empty and a `notes` entry from Phase 1.
  - `an export with zero calls cleans to an empty store`: header-only calls CSV. `calls` `[]`, all counts 0, `unattributedTrackingNumbers` `[]`, `outcomeLagDays === 0`, no throw. (Review Focus 4)
  - `campaigns and locations are passed through unchanged`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/core/clean.test.ts`
  Expected: FAIL, cannot resolve `../../src/core/clean`.

- [ ] **Step 3: Implement `cleanExport(loaded: LoadedExport): CallStore` in `src/core/clean.ts`** and add the three types to `src/core/types.ts`.

  Approach: call `dedupeRows(loaded.rows)`; for each winner, a bad winner increments `badCallsByReason[reason]` (start from a zeroed record built from `BAD_REASONS`); a good winner becomes a `CleanCall`. Look the zone up from `loaded.locations` by `locationId` (Phase 1 guarantees it exists and is valid for a good row). Tally the notes in the same pass; sort the tracking-number list at the end. Counted revenue is `call.revenueUsd ?? 0` only when booked. `outcomeLagDays: 0` for now.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/core/clean.test.ts`
  Expected: PASS, 15 tests. Also `npm run typecheck` is clean.

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/types.ts src/core/clean.ts tests/core/clean.test.ts
  git commit -m "feat: clean the export into a call store and data notes

  Attribution, pending outcomes and the revenue rule live in one place so
  every later view reads the same cleaned calls.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 4: Measure the outcome lag (section 3.3)

**Files:**
- Create: `src/core/outcomeLag.ts`, `tests/core/outcomeLag.test.ts`
- Modify: `src/core/clean.ts` (set `outcomeLagDays`), `tests/core/clean.test.ts` (one test)

**Interfaces:**
- Consumes: `DedupeResult.groups` and `.winners` from Task 1; `cleanExport` from Task 3.
- Produces: `export function measureOutcomeLagDays(groups: RowResult[][], winners: RowResult[]): number`. Whole days, rounded up; `0` when nothing qualifies. A group qualifies when its winner is a good row, it has two or more good rows with parseable `updatedAt`, and the winner's `outcome` or `revenueUsd` differs from the earliest such row's.

- [ ] **Step 1: Write the failing tests** in `tests/core/outcomeLag.test.ts`, building groups through `loadFixture` + `dedupeRows`:
  - `lag is the gap from call start to the updating row, rounded up to whole days`: started `2026-03-02T10:00:00Z`; first row `answered true`, outcome empty, updated `2026-03-02T10:05:00Z`; latest row outcome `booked`, updated `2026-03-05T09:00:00Z` (71 hours) gives `3`.
  - `the longest lag across calls wins`: one call 30 hours (2 days), one 50 hours (3 days) gives `3`.
  - `an exact multiple of a day does not round up`: exactly 48 hours gives `2`.
  - `a pure duplicate row does not count`: two rows identical except `updated_at` 90 hours after start gives `0`. (Review Focus 2)
  - `a call with one row does not count, even if updated_at is days after start`: gives `0`.
  - `revenue change alone counts`: same outcome `booked`, first row empty revenue, latest `300`, 24 hours gives `1`.
  - `a negative gap counts as 0`: latest `updated_at` before `started_at` gives `0`.
  - `a call whose winner is bad does not count`: gives `0`.
  - `no rows gives 0`.

  And one test in `tests/core/clean.test.ts`: `cleanExport sets outcomeLagDays from the data`, using the 71-hour fixture, expects `dataNotes.outcomeLagDays === 3`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/core/outcomeLag.test.ts tests/core/clean.test.ts`
  Expected: FAIL, cannot resolve `outcomeLag`; the new clean test fails with `0 !== 3`.

- [ ] **Step 3: Implement `measureOutcomeLagDays` in `src/core/outcomeLag.ts`** and call it from `cleanExport` with `dedupeRows`'s `groups` and `winners`.

  Per qualifying group: `Math.max(0, winner.updatedAt - winner.startedAt)` in milliseconds; take the maximum; return `Math.ceil(maxMs / 86_400_000)`. Compare `outcome` and `revenueUsd` of the winner against the row with the earliest parseable `updatedAt`.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/core/outcomeLag.test.ts tests/core/clean.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/outcomeLag.ts src/core/clean.ts tests/core/outcomeLag.test.ts tests/core/clean.test.ts
  git commit -m "feat: measure outcome lag from the data, not a constant

  The recent-days warning has to follow whatever export is loaded.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 5: Snapshot totals, hard-coding guard, docs

**Files:**
- Create: `tests/snapshot/original-export-clean.test.ts`, `tests/core/different-names.test.ts`
- Modify: `docs/DECISIONS.md`, `README.md` only if a command or behavior it states changed (probably not)

**Interfaces:**
- Consumes: `readExportFromDir` from `src/node/readDataDir.ts` (Phase 1); `cleanExport` (Tasks 3-4); `loadFixture` from `tests/core/helpers.ts`.
- Produces: nothing new in `src/`.

- [ ] **Step 1: Write the snapshot test** in `tests/snapshot/original-export-clean.test.ts`, loading `tests/fixtures/original-export` as the Phase 1 snapshot test does. Expected values (verified against the shipped CSV while writing this plan):
  - `store.calls.length === 5000`; `dataNotes.rowsRead === 5411`; `callsAfterDedup === 5000`; `duplicateRowsCollapsed === 411`; `badCalls === 0`
  - bookings (`calls.filter(c => c.booked).length`) `=== 1204`
  - revenue (sum of `revenueUsd`) `=== 432894`
  - `dataNotes.unattributedCalls === 144`, `unattributedTrackingNumbers` has length 10, its `calls` sum to 144
  - `dataNotes.pendingCalls === 41`
  - `tiedCalls === 0`, `revenueOnNonBookedCalls === 0`, `bookedWithoutRevenueCalls === 0`
  - `outcomeLagDays === 3`
  - every call's `localDate` matches `/^\d{4}-\d{2}-\d{2}$/` and `localHour` is 0-23.

- [ ] **Step 2: Write the hard-coding guard** in `tests/core/different-names.test.ts`: a hand-written export with campaigns `zz_c1`/`zz_c2` (names like "Quokka Promo"), offices in `Asia/Kolkata`, `Pacific/Auckland` and `Europe/London`, and dates in 2031 (including a duplicate, an unattributed call, a pending call and a booked call with revenue). Assert `cleanExport` returns the expected call count, one unattributed, one pending, correct revenue, and local dates (Kolkata is UTC+5:30, so pick an instant where the date differs from UTC). Also run `rg` equivalent as a test: read every file under `src/` and assert none contains the strings `Phoenix`, `Denver`, `2026-`, `cmp_`, `loc_`, or `+1-555`. (`tests/` is exempt.)

- [ ] **Step 3: Run to verify** (the snapshot should pass on first run since the code exists; a failure here is a real bug to fix in the earlier task, not here)

  Run: `npx vitest run tests/snapshot tests/core/different-names.test.ts`
  Expected: PASS.

- [ ] **Step 4: Update `docs/DECISIONS.md`.** Three PROPOSED lines (dedupe scope, outcome lag, local fields and counted revenue) were added with this plan; once the user approves, remove "PROPOSED" from them or edit them to match what was agreed. Then add the one line not yet there: `tiedCalls` counts calls, not rows. For reference, the decisions are:
  - Dedupe runs over good and bad rows together; bad-row counts after Phase 2 are per call; `missing_call_id` rows are never grouped. (Why: rule 2. Rejected: dedupe good rows only.)
  - PROPOSED: outcome lag = max over calls whose later row changed outcome or revenue of (winner `updated_at` - `started_at`), rounded up to whole days. (Rejected: any later row; fixed 72 hours.)
  - Local weekday is `0 = Monday ... 6 = Sunday`; local fields are computed once at clean time and stored on each `CleanCall`. (Why: Phase 3 weeks, Phase 5 heatmaps. Rejected: computing in each view.)
  - `CleanCall.revenueUsd` holds counted revenue only (0 unless booked); the file's raw value is not kept. (Why: a view cannot accidentally count revenue on a non-booked call. Rejected: keeping both.)
  - `tiedCalls` counts calls, not rows.

- [ ] **Step 5: Run the whole suite and typecheck**

  Run: `npm test` then `npm run typecheck`
  Expected: all tests PASS (Phase 1's plus about 50 new), typecheck clean.

- [ ] **Step 6: Commit**

  ```bash
  git add tests/snapshot/original-export-clean.test.ts tests/core/different-names.test.ts docs/DECISIONS.md
  git commit -m "test: pin the cleaned shipped export and guard against hard-coding

  Snapshot totals catch regressions; the different-names fixture catches
  anything tied to this dataset.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

  Then **stop**, show the `npm test` output, and wait for review.

---

## Edge-case coverage (PLAN.md Phase 2 list)

| Edge case | Test |
| --- | --- |
| three rows for one call arriving out of order | Task 1 `three rows ... out of order`; Task 3 rule 2 |
| `updated_at` tie | Task 1 tie tests; Task 3 `a tie is counted` |
| bad latest row with good older row (call reported bad) | Task 1; Task 3 (per-call count) |
| empty campaign_id | Task 3 rule 4 |
| revenue on a non-booked row | Task 3 rule 6 (two tests) |
| booked with empty revenue | Task 3 rule 6 |
| answered with no outcome | Task 3 rule 7 |
| a call at 02:00 UTC that is the previous local day | Task 2; Task 3 rule 5 |
| Phoenix vs Denver in the same week | Task 2 (two tests); Task 3 rule 5 |

## Self-review

- **Spec coverage:** rules 2, 4, 5, 6, 7 each have a task and a named test; rule 11 has the guard in Task 5; outcome lag (3.3) is Task 4; every data-notes item in 3.4 that is not AI status is a field on `DataNotes` (AI status belongs to Phase 9; the "bad rows counted by reason" and "measured lag" fields are here). Done-when numbers are in the Task 5 snapshot.
- **Types:** `DedupeResult` (Task 1) is consumed unchanged in Tasks 3 and 4; `CleanCall`, `DataNotes`, `CallStore` are defined once in Task 3 and used by name after; `localParts` returns `{ date, hour, weekday }` and Task 3 maps them to `localDate`, `localHour`, `localWeekday`.
- **Proportion:** four small modules and about 50 tests for five bullets of spec; bodies are left to the implementer.
