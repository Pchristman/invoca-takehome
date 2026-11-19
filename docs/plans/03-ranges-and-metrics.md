# Phase 3 (Ranges and metrics) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pure functions for date ranges (presets, custom, comparison, coverage checks) and for every metric PLAN.md section 4 defines, so Phase 5's view builders only assemble them.

**Architecture:** Dates are `"YYYY-MM-DD"` local-date strings and all day arithmetic goes through one small module, so no time zone or DST bug can enter here. Ranges are resolved against the data's local-date span. Metric functions are small, take thresholds as an optional last argument (defaulting to the config module), and return `null` or a tagged `Change` instead of `NaN` or infinity. No I/O, no new dependencies.

**Tech Stack:** Node 24, TypeScript (strict), vitest. Nothing new.

**Spec:** `PLAN.md` (sections 3.1, 3.2, 3.3, 4.1-4.5, 5 rules 8-10, Phase 3 in section 9), `docs/BRIEF.md`, `CLAUDE.md`, and `docs/plans/02-clean.md` for the `CleanCall` and `CallStore` types this consumes.

## Global Constraints

- Work **one task at a time**. After the last task run `npm test` and `npm run typecheck`, show the output, then **stop** and wait (CLAUDE.md).
- **No new dependencies.** Ask first if one seems needed.
- Phase 3 done-when, verbatim from PLAN.md: "the table-driven metric tests pass."
- Every number comes from code; no function here returns `NaN` or `Infinity`. (CLAUDE.md)
- Local date filters are inclusive at both ends. Ranges filter on `CleanCall.localDate`, never on `startedAt`. (3.1)
- Comparison default: the same number of days immediately before the selected range. Not fully covered by the data means no change is shown, with a reason. (3.2, rule 9)
- Rates show change in percentage points; counts and money show % change. Previous 0 with current above 0 reads "new" (counts and money). Both 0 shows no change. (3.2)
- Estimated spend = `daily_budget_usd` x days in range. Cost per booking is blank (`null`) when the budget is $0 or bookings are 0. Revenue per budget dollar is blank when spend is $0. (rule 8)
- Weeks run Monday to Sunday by local date; a week only partly inside the range or the data is partial. (rule 10)
- Thresholds, from PLAN.md 4.5: `MIN_BOOKINGS_TO_RANK` 5, `MIN_CALLS_BEST_CAMPAIGN` 20, `MIN_CALLS_OUTLIER` 50, `OUTLIER_Z` 2.5, `MIN_ANSWERED_FOR_RATE` 30.
- Nothing hard-coded to this dataset: no campaign, office, channel-to-campaign, tracking-number or date literals in `src/`. (rule 11) Test files may use literals.
- Never read, print or `git add` `.env`. Do not write to `docs/AI_COST_LOG.md` or edit `docs/BRIEF.md`.
- Commit after each task, small, message says why, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Prefer simple, readable code; a reviewer will walk through all of it.

## Issues found in PLAN.md (decide before or during review)

Each of these is proposed in `docs/DECISIONS.md` and needs your yes or no.

1. **Where the Phase 3 line sits.** PLAN.md says Phase 3 is "every metric function in section 4". This plan reads that to include the rules that consume the five thresholds: best/worst campaign eligibility, best campaign at an office, the office outlier test, and the missed-call value. Phase 5 then only calls them. If you'd rather keep eligibility rules in Phase 5, Tasks 5 and 6 move there unchanged.
2. **"Range outside data" has no stated result.** Proposed: a custom range with **no** overlap with the data is rejected (`outside_data`); one that **partly** overlaps is clamped (3.1 says "clamped") and marked `clamped`. A range inside the data span with zero calls is valid and empty (Phase 5's "empty range" case).
3. **Presets on short data.** "Last 28 days" on 10 days of data is clamped to the 10 days, marked `clamped`, and therefore has no comparison. Spend uses the clamped day count.
4. **Rates and "new".** 3.2 says previous 0 reads "new", but a rate of 0% to 5% is a perfectly good +5 points. Proposed: "new" applies to counts and money only. Rates always show points when both rates exist, except both 0, which shows none. A rate with no calls behind it is `null` and shows no change.
5. **Coverage must also check the end of the data.** 3.2 only mentions a comparison before the first date. Because the engine takes any two ranges (S2), a second range past the last date is also "not fully covered".
6. **The last-day note will show on every preset and on "All data".** Those ranges end on the as-of date, which is the last data day, and 3.2 says to note that day may be incomplete. That is what the spec says, so it is built that way. Say so if you want it shown only when the last day looks thin.
7. **"Ends within that many days of the as-of date" (outcome lag).** Proposed: the note applies when the lag is above 0 and (as-of date minus range end) is **at most** the lag in days. A 3-day lag therefore flags a range ending 3 days before as-of. Erring toward showing the caveat.
8. **Missed-call value simplifies.** PLAN.md defines it as booking rate x average booking value. That product equals revenue / answered calls with an outcome, which never divides by zero bookings. The code uses the second form and still returns the rate and average so the view can show the formula.
9. **Units for change.** `percent` is in percent (25 means +25%); `points` is in percentage points (5 means +5 points). Both are display-ready numbers, so the UI does no arithmetic.

## Review Focus

Inputs the spec implies but no listed edge case names. Each has a test in the owning task.

1. **A store with no calls.** `dataSpan` is `null`, `resolveRange` returns `no_data` (never throws), `tally` is all zeros with `null` rates. (Tasks 2, 4)
2. **A preset longer than the data.** "Last 28 days" on 3 days of data resolves to those 3 days, `clamped: true`, and the comparison is unavailable with a reason. (Tasks 2, 3)
3. **Impossible or malformed custom dates** (`2026-02-30`, `2026-9-1`, empty, `yesterday`) give `bad_date` naming the value, not a silently shifted date. (Task 2)
4. **A z-test with no variance or no "rest" group** (every office at 100%, or a single office). Not flagged, no `NaN`. (Task 5)
5. **A rate with zero denominator** (answer rate with 0 calls) is `null`, and a change involving `null` shows none. (Task 4)

---

## File Structure

```
src/core/thresholds.ts    THRESHOLDS: the five defaults from PLAN.md 4.5
src/core/localDate.ts     "YYYY-MM-DD" arithmetic: isLocalDate, addDays, daysBetween, weekStart
src/core/ranges.ts        DateRange, dataSpan, resolveRange (presets, custom, clamping, errors)
src/core/comparison.ts    resolveComparison, incompleteDays, outcomeLagApplies
src/core/metrics.ts       callsInRange, tally, rate, changeInCount, changeInRate, spend and cost functions
src/core/ranking.ts       pickBestWorst, bestCampaignAtOffice, twoProportionZ, officeOutlier
src/core/missedValue.ts   buildMissedValueRates, estimateMissedCallValue
src/core/weeks.ts         callsPerWeek
tests/core/helpers.ts     (modify) add makeCall(over?) -> CleanCall
tests/core/localDate.test.ts
tests/core/ranges.test.ts
tests/core/comparison.test.ts
tests/core/metrics.test.ts
tests/core/ranking.test.ts
tests/core/missedValue.test.ts
tests/core/weeks.test.ts
tests/snapshot/original-export-ranges.test.ts
tests/core/different-names.test.ts   (modify) add Phase 3 functions to the guard
docs/DECISIONS.md          (modify) already holds this plan's proposed rows
```

`src/core/thresholds.ts` is the "one config module" for the thresholds. The `.env` settings (`PORT`, `DATA_DIR` and so on) stay in `src/node/env.ts`; the core never reads the environment.

---

### Task 1: Local-date arithmetic and thresholds

**Files:**
- Create: `src/core/localDate.ts`, `src/core/thresholds.ts`, `tests/core/localDate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type LocalDate = string; // "YYYY-MM-DD"
  export function isLocalDate(value: string): boolean;          // strict format AND a real calendar date
  export function addDays(date: LocalDate, days: number): LocalDate;
  export function daysBetween(from: LocalDate, to: LocalDate): number; // to minus from, signed
  export function weekStart(date: LocalDate): LocalDate;        // the Monday on or before `date`

  export interface Thresholds {
    MIN_BOOKINGS_TO_RANK: number;
    MIN_CALLS_BEST_CAMPAIGN: number;
    MIN_CALLS_OUTLIER: number;
    OUTLIER_Z: number;
    MIN_ANSWERED_FOR_RATE: number;
  }
  export const THRESHOLDS: Thresholds;
  ```

- [ ] **Step 1: Write the failing tests** in `tests/core/localDate.test.ts`:
  - `addDays crosses month, year and leap-day boundaries`: `('2026-02-28', 1)` is `'2026-03-01'`; `('2028-02-28', 1)` is `'2028-02-29'`; `('2026-12-31', 1)` is `'2027-01-01'`; `('2026-03-01', -1)` is `'2026-02-28'`; `('2026-03-08', 1)` is `'2026-03-09'` (a US DST date; strings are zone-free); `('2026-03-08', 0)` is unchanged.
  - `daysBetween is signed and counts whole days`: `('2026-09-01', '2026-10-29')` is `58`; reversed is `-58`; same day is `0`.
  - `isLocalDate accepts real dates only`: true for `'2026-02-28'` and `'2028-02-29'`; false for `'2026-02-29'`, `'2026-02-30'`, `'2026-13-01'`, `'2026-2-3'`, `'26-02-03'`, `''`, `'2026-02-03T00:00:00Z'`, `' 2026-02-03'`, `'2026-02-03\n'`.
  - `weekStart returns the Monday on or before`: `'2026-10-28'` (Wednesday) gives `'2026-10-26'`; `'2026-10-26'` (Monday) gives itself; `'2026-11-01'` (Sunday) gives `'2026-10-26'`; `'2027-01-01'` (Friday) gives `'2026-12-28'`.
  - `THRESHOLDS match the PLAN.md table`: `{ MIN_BOOKINGS_TO_RANK: 5, MIN_CALLS_BEST_CAMPAIGN: 20, MIN_CALLS_OUTLIER: 50, OUTLIER_Z: 2.5, MIN_ANSWERED_FOR_RATE: 30 }`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/core/localDate.test.ts`
  Expected: FAIL, cannot resolve `../../src/core/localDate`.

- [ ] **Step 3: Implement both modules.** `localDate.ts`: do arithmetic with `Date.UTC` and `getUTCDay()` only, never local-zone `Date` methods. `isLocalDate` checks `/^\d{4}-\d{2}-\d{2}$/` and that the date round-trips unchanged through `Date.UTC`. Monday is `(getUTCDay() + 6) % 7 === 0`, matching `CleanCall.localWeekday`. `thresholds.ts`: the constant, with a one-line comment per field naming where it is used.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/core/localDate.test.ts`
  Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/localDate.ts src/core/thresholds.ts tests/core/localDate.test.ts
  git commit -m "feat: zone-free local-date arithmetic and the threshold config

  Ranges and weeks are counted in whole local days; string dates keep DST out of the arithmetic.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 2: Data span and range resolution (3.1)

**Files:**
- Create: `src/core/ranges.ts`, `tests/core/ranges.test.ts`
- Modify: `tests/core/helpers.ts` (add `makeCall`)

**Interfaces:**
- Consumes: `CleanCall` from `src/core/types.ts`; `LocalDate`, `isLocalDate`, `addDays`, `daysBetween` from Task 1.
- Produces:
  ```ts
  export interface DateRange { start: LocalDate; end: LocalDate }   // inclusive both ends
  export interface ResolvedRange extends DateRange { days: number; clamped: boolean }
  export type RangeSpec =
    | { kind: 'preset'; preset: 'last7' | 'last28' | 'all' }
    | { kind: 'custom'; start: string; end: string };               // raw strings: may be invalid
  export type RangeErrorCode = 'no_data' | 'bad_date' | 'start_after_end' | 'outside_data';
  export interface RangeError { code: RangeErrorCode; message: string }
  export type RangeResult = { ok: true; range: ResolvedRange } | { ok: false; error: RangeError };

  export function dataSpan(calls: readonly CleanCall[]): DateRange | null;  // min and max localDate; null if no calls
  export function resolveRange(span: DateRange | null, spec: RangeSpec): RangeResult;
  export function checkDates(start: string, end: string): RangeError | null; // bad_date, then start_after_end; shared with Task 3
  ```
  `tests/core/helpers.ts` gains `makeCall(over: Partial<CleanCall> = {}): CleanCall`: a booked, answered call with every field filled (`localDate '2026-09-10'`, `localHour 10`, `localWeekday 3`, `revenueUsd 100`, `campaignId 'cmp_a'`, `channel 'social'`, `callerHash` unique per call unless overridden). Later tasks reuse it.

- [ ] **Step 1: Write the failing tests** in `tests/core/ranges.test.ts`, with `span = { start: '2026-09-01', end: '2026-10-29' }` (59 days):
  - `dataSpan is the min and max local date`: calls on `'2026-10-02'`, `'2026-09-01'`, `'2026-10-29'` give `span`.
  - `dataSpan uses the local date, not the UTC date`: one call with `startedAt 2026-10-30T02:00:00Z` and `localDate '2026-10-29'` gives an `end` of `'2026-10-29'`.
  - `dataSpan of no calls is null`. (Review Focus 1)
  - `presets end on the as-of date`: `last7` is `{ start: '2026-10-23', end: '2026-10-29', days: 7, clamped: false }`; `last28` starts `'2026-10-02'` with `days: 28`; `all` is the whole span, `days: 59`, `clamped: false`.
  - `a preset longer than the data is clamped`: span `2026-10-27` to `2026-10-29`: `last7` and `last28` both give `start '2026-10-27'`, `days: 3`, `clamped: true`; `all` gives `clamped: false`. (Review Focus 2)
  - `a custom range is inclusive at both ends`: `('2026-09-10', '2026-09-16')` has `days: 7`; the span's own first and last dates give `days: 59`, `clamped: false`.
  - `a one-day range is valid`: `('2026-09-10', '2026-09-10')` has `days: 1`.
  - `a custom range partly outside the data is clamped`: `('2026-08-20', '2026-09-05')` gives `start '2026-09-01'`, `end '2026-09-05'`, `days: 5`, `clamped: true`; `('2026-10-25', '2026-11-10')` ends `'2026-10-29'`, `clamped: true`; a range containing the whole span gives the span, `clamped: true`.
  - `a range wholly outside the data is rejected`: `('2026-08-01', '2026-08-31')` and `('2026-10-30', '2026-11-05')` give `outside_data`; the message names the data's first and last date.
  - `start after end is rejected, even when also outside the data`: `('2026-09-10', '2026-09-09')` and `('2026-12-01', '2026-11-01')` give `start_after_end`; the message contains both dates.
  - `impossible or malformed dates are rejected naming the value`: `'2026-02-30'`, `'2026-9-1'`, `''`, `'yesterday'` as either bound give `bad_date`; the message contains the offending value. (Review Focus 3)
  - `no data rejects every spec`: `resolveRange(null, ...)` for a preset and a custom spec gives `no_data` and does not throw. (Review Focus 1)

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/core/ranges.test.ts`
  Expected: FAIL, cannot resolve `../../src/core/ranges`.

- [ ] **Step 3: Implement `ranges.ts`.** Check order in `resolveRange`: `no_data`, then `checkDates` (`bad_date` before `start_after_end`), then `outside_data` (no overlap), then clamp and set `clamped` when either bound moved. Presets: `end = span.end`, `start = max(span.start, addDays(end, -(N - 1)))`, `clamped` when the start moved. `days = daysBetween(start, end) + 1`. Messages are plain sentences a marketer could read.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/core/ranges.test.ts`
  Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/ranges.ts tests/core/ranges.test.ts tests/core/helpers.ts
  git commit -m "feat: resolve presets and custom ranges against the data span

  Bad, inverted or out-of-data ranges return an error the server can turn into a 400; partial overlaps are clamped and flagged.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 3: Comparison range, coverage and caveat flags (3.2, 3.3)

**Files:**
- Create: `src/core/comparison.ts`, `tests/core/comparison.test.ts`

**Interfaces:**
- Consumes: `DateRange`, `RangeError`, `checkDates` from Task 2; `addDays`, `daysBetween` from Task 1.
- Produces:
  ```ts
  export interface RangeComparison {
    previous: DateRange & { days: number };
    /** True only when every day of `previous` lies inside the data span. */
    available: boolean;
    /** One line starting "No full previous period"; null when available. */
    unavailableReason: string | null;
    sameLength: boolean;
  }
  export type ComparisonResult = { ok: true; comparison: RangeComparison } | { ok: false; error: RangeError };
  export interface IncompleteDays { includesFirstDay: boolean; includesLastDay: boolean }

  /** `previous` omitted = the same number of days immediately before `current`. */
  export function resolveComparison(span: DateRange, current: DateRange, previous?: DateRange): ComparisonResult;
  export function incompleteDays(span: DateRange, range: DateRange): IncompleteDays;
  /** True when lagDays > 0 and (span.end minus range.end) in days is at most lagDays. */
  export function outcomeLagApplies(span: DateRange, range: DateRange, lagDays: number): boolean;
  ```

- [ ] **Step 1: Write the failing tests** in `tests/core/comparison.test.ts`, with `span = { start: '2026-09-01', end: '2026-10-29' }` unless stated:
  - `the default previous period is the same length, immediately before`: current `2026-10-23..2026-10-29` gives previous `{ start: '2026-10-16', end: '2026-10-22', days: 7 }`, `available: true`, `sameLength: true`, `unavailableReason: null`.
  - `a one-day range compares with the day before`: current `2026-10-29..2026-10-29` gives previous `2026-10-28`, available.
  - `a previous period that exactly touches the data start is available`: current `2026-09-08..2026-09-14` gives previous `2026-09-01..2026-09-07`, `available: true`.
  - `a previous period one day before the data start is not available`: current `2026-09-07..2026-09-13` gives previous `2026-08-31..2026-09-06`, `available: false`; the reason starts with `No full previous period` and contains `2026-09-01` and `2026-08-31`.
  - `all data never has a comparison`: current equal to `span` gives `available: false` with the same reason shape.
  - `a one-day range on the first data day has no comparison`: current `2026-09-01..2026-09-01` is unavailable.
  - `a short preset on short data has no comparison`: span `2026-10-27..2026-10-29`, current the same 3 days, unavailable. (Review Focus 2)
  - `the previous period crosses a leap day correctly`: span `2028-01-01..2028-03-31`, current `2028-03-01..2028-03-07` gives previous `2028-02-23..2028-02-29`, `days: 7`.
  - `an explicit second range of another length is allowed and flagged`: previous `2026-09-01..2026-09-03` for a 7-day current gives `available: true`, `sameLength: false`, `previous.days === 3`.
  - `an explicit second range running past the data end is unavailable`: previous `2026-10-27..2026-11-02` gives `available: false`; the reason contains `2026-10-29`.
  - `an explicit second range that is inverted or malformed is an error`: start after end gives `start_after_end`; `'2026-02-30'` gives `bad_date`.
  - `incompleteDays flags the first and last data day`: `2026-10-23..2026-10-29` gives `{ includesFirstDay: false, includesLastDay: true }`; `span` gives both true; `2026-09-10..2026-09-16` gives both false; `2026-09-01..2026-09-01` gives `includesFirstDay: true`, `includesLastDay: false`.
  - `outcomeLagApplies compares the gap to the lag`: with `lagDays 3` and range end `2026-10-29` (gap 0) true; end `2026-10-26` (gap 3) true; end `2026-10-25` (gap 4) false; with `lagDays 0` false even when the range ends on `2026-10-29`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/core/comparison.test.ts`
  Expected: FAIL, cannot resolve `../../src/core/comparison`.

- [ ] **Step 3: Implement `comparison.ts`.** Default previous: `end = addDays(current.start, -1)`, `start = addDays(current.start, -current.days)`. Validate an explicit `previous` with `checkDates` first. `available` is `previous.start >= span.start && previous.end <= span.end`. Reason wording names the first uncovered side: data starts before the previous period would, or data ends before it would, each with both dates.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/core/comparison.test.ts`
  Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/comparison.ts tests/core/comparison.test.ts
  git commit -m "feat: comparison range with coverage check and caveat flags

  A previous period the data does not fully cover shows no change and says why, so a partial period is never compared with a full one.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 4: Totals, rates, changes, spend and cost (4.1, 4.2, rule 8)

**Files:**
- Create: `src/core/metrics.ts`, `tests/core/metrics.test.ts`

**Interfaces:**
- Consumes: `CleanCall`; `DateRange` from Task 2; `makeCall` from `tests/core/helpers.ts`.
- Produces:
  ```ts
  export interface Tally {
    calls: number; uniqueCallers: number; answered: number; bookings: number; revenueUsd: number;
  }
  export type Change =
    | { kind: 'none' }
    | { kind: 'new' }
    | { kind: 'percent'; value: number }   // 25 means +25%
    | { kind: 'points'; value: number };   // 5 means +5 percentage points

  export function callsInRange(calls: readonly CleanCall[], range: DateRange): CleanCall[];
  export function tally(calls: readonly CleanCall[]): Tally;
  export function rate(numerator: number, denominator: number): number | null; // null when denominator is 0
  export function changeInCount(current: number, previous: number): Change;    // counts and money
  export function changeInRate(current: number | null, previous: number | null): Change;
  export function estimatedSpend(dailyBudgetUsd: number, days: number): number;
  export function costPerBooking(estimatedSpendUsd: number, bookings: number): number | null;
  export function revenuePerBudgetDollar(revenueUsd: number, estimatedSpendUsd: number): number | null;
  ```

- [ ] **Step 1: Write the failing tests** in `tests/core/metrics.test.ts`. Use `it.each` tables for the pure functions:
  - `rate`: `(1, 4)` is `0.25`; `(0, 5)` is `0`; `(3, 0)` is `null`; `(0, 0)` is `null`. (Review Focus 5)
  - `changeInCount`: `(120, 100)` is `{ percent, 20 }`; `(80, 100)` is `{ percent, -20 }`; `(0, 100)` is `{ percent, -100 }`; `(100, 100)` is `{ percent, 0 }`; `(5, 0)` is `{ new }`; `(0, 0)` is `{ none }`; `(432894, 400000)` is `percent` with value close to `8.2235` (`toBeCloseTo(8.2235, 3)`).
  - `changeInRate`: `(0.25, 0.20)` is `points` close to `5`; `(0.20, 0.25)` is `points` close to `-5`; `(0.10, 0)` is `points` close to `10` (not `new`); `(0, 0.20)` is `points` close to `-20`; `(0, 0)` is `none`; `(null, 0.2)`, `(0.2, null)` and `(null, null)` are `none`. (Review Focus 5)
  - `estimatedSpend`: `(10, 7)` is `70`; `(0, 60)` is `0`; `(12.5, 3)` is `37.5`.
  - `costPerBooking is blank, never infinity`: `(600, 12)` is `50`; `(0, 5)` is `null` (zero budget); `(600, 0)` is `null` (zero bookings); `(0, 0)` is `null`.
  - `revenuePerBudgetDollar`: `(900, 600)` is `1.5`; `(900, 0)` is `null`; `(0, 600)` is `0`.
  - `callsInRange is inclusive and uses the local date`: calls on `'2026-09-09'`, `'2026-09-10'`, `'2026-09-16'`, `'2026-09-17'` with range `2026-09-10..2026-09-16` keep the middle two; a one-day range keeps only that day; a call with `startedAt 2026-09-11T02:00:00Z` and `localDate '2026-09-10'` is in `2026-09-10..2026-09-10`.
  - `tally counts calls, unique callers, answered, bookings and revenue`: four calls: caller `h1` answered booked `$250`; caller `h1` answered `qualified_lead` with `revenueUsd 0`; caller `h2` unanswered `missed`; caller `h3` answered with `outcome null` (pending). Expect `{ calls: 4, uniqueCallers: 3, answered: 3, bookings: 1, revenueUsd: 250 }`.
  - `tally sums money in whole cents`: two booked calls with `revenueUsd` `0.1` and `0.2` give exactly `0.3` (`toBe(0.3)`).
  - `tally of no calls is all zeros`: no `NaN`. (Review Focus 1)

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/core/metrics.test.ts`
  Expected: FAIL, cannot resolve `../../src/core/metrics`.

- [ ] **Step 3: Implement `metrics.ts`.** `changeInCount`: both 0 is `none`; previous 0 with current above 0 is `new`; otherwise `percent = (current - previous) / previous * 100`. `changeInRate`: any `null` or both 0 is `none`; otherwise `points = (current - previous) * 100`. `tally` sums `revenueUsd` as integer cents (`Math.round(x * 100)`) and divides by 100 once at the end; `answered` counts `call.answered` (pending included); `bookings` counts `call.booked`. `costPerBooking` is `null` when spend or bookings is 0.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/core/metrics.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/metrics.ts tests/core/metrics.test.ts
  git commit -m "feat: totals, rates, changes and spend estimates as pure functions

  Zero denominators return null and a zero previous value returns 'new', so no view can show NaN or infinity.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 5: Best/worst campaign, best campaign at an office, office outlier (4.2, 4.3)

**Files:**
- Create: `src/core/ranking.ts`, `tests/core/ranking.test.ts`

**Interfaces:**
- Consumes: `THRESHOLDS` from Task 1; `rate` from Task 4.
- Produces:
  ```ts
  export interface CampaignPerformance {
    campaignId: string; bookings: number; estimatedSpendUsd: number; revenuePerBudgetDollar: number | null;
  }
  export interface BestWorst {
    eligible: number; best: CampaignPerformance | null; worst: CampaignPerformance | null;
  }
  /** Real campaigns only: the caller leaves out "Unattributed". */
  export function pickBestWorst(rows: readonly CampaignPerformance[], minBookings?: number): BestWorst;

  export interface CampaignAtOffice { campaignId: string; calls: number; bookings: number }
  export function bestCampaignAtOffice(rows: readonly CampaignAtOffice[], minCalls?: number): CampaignAtOffice | null;

  export interface ProportionGroup { successes: number; calls: number }
  export function twoProportionZ(a: ProportionGroup, b: ProportionGroup): number | null;
  export interface OutlierOptions { z?: number; minCalls?: number }
  export interface OutlierResult {
    eligible: boolean; z: number | null; flagged: boolean;
    direction: 'better' | 'worse' | null; officeRate: number | null; restRate: number | null;
  }
  /** `office` against `rest`, all other offices pooled. Higher rate is better for answer and booking rate. */
  export function officeOutlier(office: ProportionGroup, rest: ProportionGroup, options?: OutlierOptions): OutlierResult;
  ```
  Defaults come from `THRESHOLDS` (`MIN_BOOKINGS_TO_RANK`, `MIN_CALLS_BEST_CAMPAIGN`, `OUTLIER_Z`, `MIN_CALLS_OUTLIER`).

- [ ] **Step 1: Write the failing tests** in `tests/core/ranking.test.ts`:
  - `pickBestWorst marks the highest and lowest revenue per budget dollar`: rows A (bookings 10, spend 600, rpbd 3), B (12, 600, 9.86), C (8, 300, 1.37): `eligible 3`, best is B, worst is C.
  - `a campaign below the minimum bookings is not eligible`: add D with 4 bookings and rpbd 20: still best B; E with exactly 5 bookings is eligible (boundary).
  - `a $0 budget is never eligible`: spend 0, rpbd `null`, 50 bookings: not counted.
  - `fewer than two eligible marks nothing`: one eligible gives `{ eligible: 1, best: null, worst: null }`; zero gives `eligible: 0`.
  - `two eligible campaigns with equal value mark nothing`: both rpbd 4.
  - `ties are broken by campaign id`: three eligible, two share the top value: the lower `campaignId` is best, so the result does not depend on input order (run it with the rows reversed).
  - `minBookings can be overridden`: with `minBookings` 1, D qualifies.
  - `bestCampaignAtOffice picks the highest booking rate among campaigns with enough calls`: X (30 calls, 9 bookings = 0.30), Y (20, 8 = 0.40), Z (19, 10 = 0.526): Y wins; Z is out at 19 calls, and exactly 20 calls qualifies.
  - `bestCampaignAtOffice is null when none qualify`; `a rate tie goes to more bookings, then the lower campaign id`.
  - `twoProportionZ matches the formula`: `({30, 100}, {500, 1000})` is close to `-3.82` (`toBeCloseTo(-3.82, 1)`); swapping the arguments gives about `+3.82`.
  - `twoProportionZ is null with no calls or no variance`: either group with 0 calls is `null`; `({50, 50}, {100, 100})` and `({0, 20}, {0, 30})` are `null`, not `NaN`. (Review Focus 4)
  - `officeOutlier flags a worse office with both rates`: `({30, 100}, {500, 1000})` gives `eligible true`, `flagged true`, `direction 'worse'`, `officeRate 0.3`, `restRate 0.5`, `z` about `-3.82`. `({70, 100}, {500, 1000})` gives `direction 'better'`.
  - `officeOutlier does not flag a difference chance can explain`: `({40, 100}, {500, 1000})` is eligible, `z` about `-1.9`, `flagged false`, `direction null`.
  - `officeOutlier flags at the threshold, not below it`: compute `z = twoProportionZ(...)` for `({30, 100}, {500, 1000})`; with `{ z: Math.abs(z) }` it is flagged (`>=`); with `{ z: Math.abs(z) + 0.001 }` it is not.
  - `officeOutlier needs MIN_CALLS_OUTLIER calls`: `({10, 49}, {500, 1000})` is `eligible false`, `flagged false`, `z null`; `({10, 50}, {500, 1000})` is eligible and flagged (`z` about `-4.1`).
  - `officeOutlier with tiny samples is not eligible`: `({0, 5}, {900, 1000})` gives `eligible false`, `flagged false`, `z null`.
  - `officeOutlier with no other offices is not eligible`: `({30, 100}, {0, 0})`. (Review Focus 4)
  - `officeOutlier with no variance is eligible but never flagged`: `({50, 50}, {100, 100})` gives `eligible true`, `z null`, `flagged false`. (Review Focus 4)
  - `officeOutlier defaults come from THRESHOLDS`: with no options, `z` about `-3.82` flags and `z` about `-1.9` does not.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/core/ranking.test.ts`
  Expected: FAIL, cannot resolve `../../src/core/ranking`.

- [ ] **Step 3: Implement `ranking.ts`.** Eligible for best/worst: `estimatedSpendUsd > 0`, `bookings >= minBookings`, `revenuePerBudgetDollar !== null`. Sort eligible by value descending, then `campaignId` by plain character order (no `localeCompare`); best is first, worst last; fewer than 2 eligible, or best and worst equal in value, returns both `null` (keep `eligible`). `twoProportionZ`: pooled `p = (x1 + x2) / (n1 + n2)`, `se = sqrt(p * (1 - p) * (1 / n1 + 1 / n2))`, `z = (x1 / n1 - x2 / n2) / se`; return `null` when either `calls` is 0 or `se` is 0. `officeOutlier`: eligible when `office.calls >= minCalls` and `rest.calls > 0`; not eligible gives `z null`, `flagged false`, `direction null`, rates still filled when computable; flagged when `z !== null && Math.abs(z) >= threshold`; direction from the sign of `z`.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/core/ranking.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/ranking.ts tests/core/ranking.test.ts
  git commit -m "feat: best/worst campaign, best campaign per office and office outlier test

  Thresholds guard each rule so thin samples never produce a ranking or a flag.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 6: Estimated value of a missed call (4.4)

**Files:**
- Create: `src/core/missedValue.ts`, `tests/core/missedValue.test.ts`

**Interfaces:**
- Consumes: `CleanCall`, `Channel`; `THRESHOLDS` from Task 1; `rate` from Task 4; `makeCall`.
- Produces:
  ```ts
  /** Answered calls that have an outcome (pending calls are left out). */
  export interface RateBasis { answeredWithOutcome: number; bookings: number; revenueCents: number } // whole cents
  export interface MissedValueRates {
    byCampaign: Map<string, RateBasis>;
    byChannel: Map<Channel, RateBasis>;
    overall: RateBasis;
  }
  export interface MissedCallValue {
    valueUsd: number;
    source: 'campaign' | 'channel' | 'overall';
    bookingRate: number | null;          // null when no answered call has an outcome
    avgBookingValueUsd: number | null;   // null when there are no bookings
  }
  /** Pass ALL calls in the export, never a date range: rates come from the whole export. */
  export function buildMissedValueRates(calls: readonly CleanCall[]): MissedValueRates;
  export function estimateMissedCallValue(
    rates: MissedValueRates,
    call: { campaignId: string | null; channel: Channel },
    minAnswered?: number,                // default THRESHOLDS.MIN_ANSWERED_FOR_RATE
  ): MissedCallValue;
  ```

- [ ] **Step 1: Write the failing tests** in `tests/core/missedValue.test.ts`. Build calls with `makeCall`. Setup: campaign `cmp_a` (channel `social`) has 30 answered calls with an outcome, 6 booked at `$100` each, plus 5 pending answered calls and 10 unanswered calls. Campaign `cmp_b` (channel `social`) has 29 answered calls with an outcome and no bookings. Campaign `cmp_c` (channel `display`) has 10 answered calls with an outcome, 1 booked at `$50`.
  - `a campaign with enough answered calls uses its own rate`: `cmp_a` gives `source 'campaign'`, `bookingRate 0.2`, `avgBookingValueUsd 100`, `valueUsd 20`. Pending and unanswered calls are not in the denominator.
  - `exactly MIN_ANSWERED_FOR_RATE answered calls is enough; one fewer falls back to the channel`: `cmp_a` (30) is `campaign`; `cmp_b` (29) gives `source 'channel'`, `valueUsd` close to `600 / 59` (the whole `social` channel), `bookingRate` close to `6 / 59`.
  - `a thin campaign on a thin channel falls back to overall`: `cmp_c` gives `source 'overall'`, `valueUsd` close to `650 / 69`.
  - `an unattributed call uses its channel's rates`: `{ campaignId: null, channel: 'social' }` gives `source 'channel'`; `{ campaignId: null, channel: 'display' }` gives `source 'overall'`.
  - `an unknown campaign id uses its channel`: `{ campaignId: 'cmp_missing', channel: 'social' }` gives `source 'channel'`.
  - `no bookings gives value 0 and no average`: 30 answered, 0 booked: `valueUsd 0`, `bookingRate 0`, `avgBookingValueUsd null`.
  - `a booked call with $0 revenue still counts as a booking`: 30 answered, two booked with revenue `0` and `100`: `bookingRate` close to `2 / 30`, `avgBookingValueUsd 50`, `valueUsd` close to `100 / 30`.
  - `no answered calls at all gives value 0 from overall`: `buildMissedValueRates([])` then any call gives `valueUsd 0`, `source 'overall'`, `bookingRate null`, `avgBookingValueUsd null`, no `NaN`.
  - `rates use every call passed in`: calls spread over two months give an `overall.answeredWithOutcome` equal to the total, so a caller who filters by range controls the window, not this function.
  - `minAnswered can be overridden`: with `minAnswered` 10, `cmp_c` is `campaign`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/core/missedValue.test.ts`
  Expected: FAIL, cannot resolve `../../src/core/missedValue`.

- [ ] **Step 3: Implement `missedValue.ts`.** A call counts toward a basis when `call.answered && call.outcome !== null`. Every call updates its channel and the overall basis; calls with a `campaignId` also update that campaign's basis (unattributed calls add to channel and overall only). Choose the first of campaign, channel, overall whose `answeredWithOutcome >= minAnswered`; overall is always the last resort even when thin. `valueUsd = revenueUsd / answeredWithOutcome` (equal to booking rate x average booking value, with no divide-by-zero on bookings; `0` when there are no answered calls). Return the rate and average alongside so the view can print the formula.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/core/missedValue.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/missedValue.ts tests/core/missedValue.test.ts
  git commit -m "feat: estimate a missed call's value with campaign, channel, overall fallback

  Rates come from the whole export so the estimate does not move with the date range.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 7: Calls per week with partial-week marking (rule 10)

**Files:**
- Create: `src/core/weeks.ts`, `tests/core/weeks.test.ts`

**Interfaces:**
- Consumes: `CleanCall`; `DateRange` from Task 2; `weekStart`, `addDays` from Task 1; `makeCall`.
- Produces:
  ```ts
  export interface WeekBucket {
    weekStart: LocalDate;  // Monday
    weekEnd: LocalDate;    // Sunday
    calls: number;
    /** True unless Monday to Sunday lies wholly inside both the range and the data span. */
    partial: boolean;
  }
  /** Pass the calls to chart (already limited to one campaign by the caller). Weeks with no calls appear with 0. */
  export function callsPerWeek(calls: readonly CleanCall[], range: DateRange, span: DateRange): WeekBucket[];
  ```

- [ ] **Step 1: Write the failing tests** in `tests/core/weeks.test.ts` (2026-10-26 is a Monday):
  - `one full Monday to Sunday week is not partial`: range `2026-10-26..2026-11-01` inside a wide span gives one bucket, `partial: false`.
  - `a range starting midweek has partial first and last weeks`: range `2026-10-28..2026-11-03` gives two buckets, `weekStart` `'2026-10-26'` and `'2026-11-02'`, both `partial: true`.
  - `a one-day range gives one partial bucket`: a Sunday `2026-11-01` gives `weekStart '2026-10-26'`, `partial: true`.
  - `a week cut off by the end of the data is partial even when the range reaches past it`: span ending Wednesday `2026-10-28`, range `2026-10-26..2026-11-01` gives `partial: true`.
  - `a week cut off by the start of the data is partial`: span starting Thursday `2026-10-22`, range from `2026-10-19`: the first week is partial, the next is not.
  - `weeks with no calls appear with zero, in order`: range of three full weeks with calls in weeks one and three gives three buckets with `calls` `[n, 0, m]`.
  - `only calls inside the range are counted`: calls the day before and after the range are not in any bucket.
  - `a week spanning New Year groups correctly`: range `2026-12-28..2027-01-03` gives one bucket, `weekStart '2026-12-28'`, `weekEnd '2027-01-03'`, `partial: false`.
  - `no calls in the range gives zero-filled buckets, not an empty list`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/core/weeks.test.ts`
  Expected: FAIL, cannot resolve `../../src/core/weeks`.

- [ ] **Step 3: Implement `callsPerWeek(calls, range, span)` in `src/core/weeks.ts`.** Build buckets from `weekStart(range.start)` to the week containing `range.end` in steps of 7 days. Count each in-range call into the bucket of `weekStart(call.localDate)`. `partial` is `weekStart < max(range.start, span.start) || weekEnd > min(range.end, span.end)` (string comparison is safe for ISO dates). A complete Sunday that is the last data day is not marked partial; the "last day may be incomplete" caveat from Task 3 covers it.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/core/weeks.test.ts`
  Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/weeks.ts tests/core/weeks.test.ts
  git commit -m "feat: calls per Monday-to-Sunday week with partial weeks marked

  Zero-filled weeks keep the chart honest; partial weeks are flagged so they are never read as a drop.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 8: Shipped-export checks and the hard-coding guard

**Files:**
- Create: `tests/snapshot/original-export-ranges.test.ts`
- Modify: `tests/core/different-names.test.ts`

**Interfaces:**
- Consumes: everything above, plus `cleanExport` and the loader the existing `tests/snapshot/original-export-clean.test.ts` already uses to read `tests/fixtures/original-export/`.
- Produces: nothing new in `src/`.

- [ ] **Step 1: Write the tests.** In `tests/snapshot/original-export-ranges.test.ts`, on the cleaned shipped export (reuse the loading code from `original-export-clean.test.ts`):
  - `all data tallies to the known totals`: `tally(callsInRange(store.calls, allRange))` is `calls 5000`, `bookings 1204`, `revenueUsd 432894`.
  - `the answer rate and booking rate are finite fractions`: `rate(answered, calls)` and `rate(bookings, calls)` are between 0 and 1.
  - `last 28 days plus everything before it equals all data`: `tally(last28).calls + tally(callsInRange(store.calls, { start: span.start, end: addDays(last28.start, -1) })).calls` is `5000`.
  - `last 28 days has a full 28-day comparison; all data has none`: `resolveComparison` for `last28` is `available: true` with `previous.days === 28`; for `all` it is `available: false`.
  - `presets and all data flag the last day as possibly incomplete`: `incompleteDays(span, last7).includesLastDay` is true.
  - `the per-week counts for the whole range add up to the calls in it`: sum of `callsPerWeek(store.calls, all, span)` `calls` is `5000`, and the first and last buckets are the only partial ones when the span does not start on a Monday or end on a Sunday (assert the count of partial buckets is at most 2).
  - `missed-value rates run on the whole export`: `buildMissedValueRates(store.calls).overall.bookings` is `1204`; `estimateMissedCallValue` for an unattributed call returns a finite `valueUsd` of at least 0.

  In `tests/core/different-names.test.ts`, extend the existing different-export test (other campaign names, office names, time zones and dates) to also call `dataSpan`, `resolveRange` (`all`, `last7`), `resolveComparison`, `tally`, `buildMissedValueRates`, `estimateMissedCallValue` and `callsPerWeek`, asserting each returns a value (no throw, no `NaN`) and that `resolveRange` for `all` equals that fixture's own span.

- [ ] **Step 2: Run them**

  Run: `npx vitest run tests/snapshot/original-export-ranges.test.ts tests/core/different-names.test.ts`
  Expected: PASS. If a total is off, stop and report it; do not adjust the expected numbers.

- [ ] **Step 3: Run the whole suite and typecheck**

  Run: `npm test` then `npm run typecheck`
  Expected: all tests pass, no type errors. Show both outputs, then stop and wait for review.

- [ ] **Step 4: Commit**

  ```bash
  git add tests/snapshot/original-export-ranges.test.ts tests/core/different-names.test.ts
  git commit -m "test: pin range and metric totals on the shipped export and a differently named one

  Catches a regression in the range or metric rules, and any dataset-specific literal that slips into the core.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

## Edge-case coverage (PLAN.md Phase 3 list)

| PLAN.md edge case | Test |
| --- | --- |
| range outside data | Task 2: `a range wholly outside the data is rejected` |
| start after end | Task 2: `start after end is rejected...`; Task 3 for an explicit second range |
| one-day range | Task 2: `a one-day range is valid`; Task 3: `a one-day range compares with the day before` |
| "all data" has no comparison | Task 3: `all data never has a comparison`; Task 8 on the shipped export |
| comparison partly before data start | Task 3: `a previous period one day before the data start is not available` (and the exact-touch boundary) |
| first and last data day flagged | Task 3: `incompleteDays flags the first and last data day`; Task 8 |
| previous 0 gives "new" | Task 4: `changeInCount (5, 0)` |
| both 0 | Task 4: `changeInCount (0, 0)` and `changeInRate (0, 0)` |
| zero budget (blank cost per booking) | Task 4: `costPerBooking (0, 5)` |
| zero bookings | Task 4: `costPerBooking (600, 0)`; Task 6: `no bookings gives value 0` |
| z-test with tiny samples (not eligible) | Task 5: `officeOutlier with tiny samples is not eligible` and the 49 vs 50 calls boundary |
| partial weeks | Task 7: partial first, last, one-day and data-edge cases |
| missed-value fallback campaign, channel, overall (PLAN.md section 8) | Task 6 |

## Self-review notes

- **Spec coverage:** each metric in 4.1 (tiles), 4.2 (booking rate, spend, cost per booking, revenue per budget dollar, best/worst), 4.3 (best campaign at office, outlier), 4.4 (missed-call value, estimated per call) and 4.5 (all five thresholds consumed) maps to a task. The callback list, the heatmap and the lost-value total are Phase 5 view logic and are not built here; they use `estimateMissedCallValue` and `callsInRange`.
- **Type consistency:** `DateRange` (Task 2) is the type Tasks 3, 4, 7 and 8 take; `Change`, `Tally`, `rate` (Task 4) are used by Task 5; `makeCall` (Task 2) is used by Tasks 4, 6, 7.
- **Not in this phase:** presenting any of this (wording of "est.", the "new" label, notes text) is the UI's job from Phase 7; Phase 3 returns data and one-line reasons only.
