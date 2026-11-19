# Phase 4 (Extended dataset) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A seeded, committed script that writes an extended export to `data/extended/`: the shipped rows untouched plus 1,400 synthetic calls that plant four patterns (two for Locations, two for Campaigns and the later alerts) with the same messiness the original has (duplicates, unattributed, pending).

**Architecture:** One self-contained script, `scripts/generate-extended.ts`, run with Node's built-in TypeScript support (no `tsx`). It reads the shipped CSVs, treats the final state of each real call as a template, and appends synthetic rows built from those templates, so rates and mixes match the original. Output is a pure function of (input text, config, seed): own PRNG, no clock, no `Math.random`. The app code is not touched.

**Tech Stack:** Node 24, TypeScript (strict), vitest, `csv-parse/sync` (already a dependency). Nothing new.

**Spec:** `PLAN.md` (Phase 4 in section 9; sections 3.2, 4.2, 4.3, 5 and 8 for what the data must exercise; stretch S1 for the trend patterns), `docs/BRIEF.md`, `CLAUDE.md`, and `docs/plans/02-clean.md` and `03-ranges-and-metrics.md` for the `CleanCall`, `DataNotes`, range and comparison functions the tests read.

## Global Constraints

- Work **one task at a time**. After the last task run `npm test` and `npm run typecheck`, show the output, then **stop** and wait. (CLAUDE.md)
- **No new dependencies.** `csv-parse` is already installed. Ask first if one seems needed.
- Phase 4 done-when, verbatim from PLAN.md: "the script regenerates an identical file from its seed; the extended export loads with zero unexpected bad rows; its snapshot totals are recorded in a test."
- "The original export stays untouched": repo-root CSVs and `tests/fixtures/original-export/` do not change.
- Every synthetic row follows the existing data rules (section 5) and the same columns: revenue only on booked calls, unanswered means `missed`/`voicemail`/empty, `ended_at` = `started_at` + `duration_seconds`, timestamps strict ISO 8601 UTC with `Z`.
- Rule 11 applies to the app, not this one-off tool: the generator's config may name the offices and campaigns it plants patterns in, but `src/` gets no change and no dataset literal. Time windows are offsets from the data's own last day, never dates.
- Never read, print or `git add` `.env`. Do not write to `docs/AI_COST_LOG.md` or edit `docs/BRIEF.md`.
- Commit after each task, small, message says why, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Prefer simple, readable code; a reviewer will walk through all of it.

## The four patterns

You asked for more than one office pattern. These are the four; each is one named block in the config. Quotas are exact so totals can be pinned.

| # | Name | Where | What is added | What a view should then show |
| --- | --- | --- | --- | --- |
| A | `officeAnswerDrop` | Canyon Office (`loc_06`, America/Phoenix), weekdays 09:00-11:59 local | 200 calls: 160 unanswered, 40 answered and **all booked** | Locations flags Canyon **worse on answer rate**, not on booking rate; its most-missed hour is a weekday morning slot |
| B | `officeLowConversion` | Riverside Office (`loc_02`, America/New_York), any time | 300 calls: 63 unanswered, 12 booked, 225 answered but not booked (`qualified_lead` or `not_qualified`) | Locations flags Riverside **worse on booking rate**, not on answer rate (its answer rate stays about 79%) |
| C | `campaignSurge` | `cmp_04` Social - Seasonal Promo, the **last 28 days** of the data | 150 calls: 30 unanswered, 60 booked, 60 answered not booked | Calls jump against the previous 28 days; its booking rate and cost per booking improve |
| D | `campaignFade` | `cmp_06` Display - Regional Awareness, the **28 days before** those | 150 calls: 30 unanswered, 0 booked, 120 answered not booked | Calls fall in the last 28 days against the previous 28; its booking rate is lower |

Plus the same mess as the original: 30 unattributed (on the original's 10 tracking numbers), 10 pending, 80 duplicated calls (60 with 2 rows, 20 with 3), and 480 plain clones so the rest of the data stays normal. Total 1,400 synthetic calls in 1,500 rows. The extended export is therefore 6,911 rows and 6,400 calls.

## Issues found in PLAN.md (decide before or during review)

Each is proposed in `docs/DECISIONS.md` and needs your yes or no. PLAN.md says Phase 4 "starts with a decision, agreed with me"; I can't agree it for you, so everything below is a proposal the plan builds on.

1. **Append-only limits what a pattern can do.** Because the original rows stay untouched, the generator can only **add** calls. It can't remove calls or take bookings away. So: a "drop" (pattern D) is relative: extra calls land in the earlier 28 days, so the last 28 days fall against them. And "efficiency gap" can only widen by making a campaign look **better** (C: more bookings against the same budget) or by lowering a booking **rate** (D), not by raising any campaign's cost per booking. The alternative is rewriting existing rows, which would stop a reviewer diffing the extended file against the original. If you want a worse "worst campaign", say so and I'll change the approach.
2. **Pattern A's answered calls are all booked.** Without that, Canyon's booking rate also falls (about 19.6% against 23.5%, z near -2.7, over the 2.5 line) and Locations flags Canyon twice. Making the 40 answered calls booked keeps Canyon's booking rate near the pool's (about 23%), so each office is flagged for one thing. It is a little artificial (callers who got through, booked), and the generator comment says so.
3. **Two flagged offices; PLAN.md 4.3 doesn't say what the Locations action shows.** The three action rules are written for one flagged office. With Canyon (worse, answer rate) and Riverside (worse, booking rate) both flagged, which one is the headline? This is a Phase 5 question; it isn't decided here. I suggest answer rate first, in 4.3's order, with the other flag still marked in the table. The data is built to force that question, which is the point of extending it.
3a. **Pattern B's calls come from all campaigns,** so "its best campaign there" at Riverside is whatever the clones give. It is not planted.
4. **Default dataset.** Proposed: `npm start` keeps using the **shipped export** (`DATA_DIR` unset means the repo root); the extended export is opt-in with `DATA_DIR=data/extended`. The shipped export is the honest default, and it's where "No office stands out" is shown. Rejected: making the synthetic export the default. This phase only documents it; the server arrives in Phase 6.
5. **"Zero unexpected bad rows."** Read as zero bad rows. You chose to keep the extended export clean; bad-row handling stays tested by hand-written fixtures.
6. **Append, don't edit.** The extended `calls.csv` is the original bytes followed by synthetic rows, so a diff against the original shows only additions. Synthetic ids start `x_` so they are recognisable and can't collide with `c_`.
7. **New top-level folder `data/`.** PLAN.md says "its own data folder" without naming it; `data/extended/` is proposed. `campaigns.csv` and `locations.csv` there are byte copies of the originals.
8. **A script runner.** `tsx` is on PLAN.md's expected list but isn't installed. Node 24 runs `.ts` directly (type stripping), so none is needed. The catch: Node can't resolve the extensionless imports `src/` uses, so the script imports nothing from `src/`. Tests read its output through `src/` instead.
9. **The data span must be at least 56 days** for patterns C and D (two 28-day windows, each a day inside the span). The shipped span is about 58 days, so this works but isn't roomy. Shorter spans make the generator stop with a clear error.

## Review Focus

Inputs the spec implies but no listed edge case names. Each has a test in the owning task.

1. **A pattern placed by a fixed UTC offset instead of the office's local time.** A New York or Phoenix office across a DST change must still land in its local window. (Task 2)
2. **A span too short to place anything** (under a week for plain clones, under 56 days for C and D, or a window that never occurs). Clear error, not an endless loop or a half-empty file. (Tasks 1, 2, 4)
3. **A quota the data can't satisfy** (a campaign with no booked calls to clone, no unattributed or pending templates, a target office missing from `locations.csv`). An error naming what's missing, never a silently smaller dataset. (Tasks 1 to 5)
4. **Line endings and trailing newline.** The shipped file is CRLF; a generated file with mixed endings would differ by machine and break "identical from its seed". (Task 1)
5. **Synthetic rows moving the as-of date or the outcome-lag caveat.** Synthetic starts stay at least a day inside the data span, and synthetic updates arrive within 71 hours, so the as-of date and the 3-day lag don't change. (Tasks 1, 5)

---

## File Structure

```
scripts/generate-extended.ts          the generator and its CLI (one file)
data/extended/calls.csv               generated, committed
data/extended/campaigns.csv           byte copy of the original
data/extended/locations.csv           byte copy of the original
tests/scripts/extendedFixture.ts      a small hand-written export for the generator tests
tests/scripts/generate-extended.test.ts
tests/snapshot/extended-export.test.ts
package.json                          (modify) script "generate:extended"
tsconfig.json                         (modify) include "scripts"
README.md                             (modify) extended export, synthetic label, how to use and regenerate
docs/DECISIONS.md                     (modify) proposed rows for this phase
```

### Fixture for the generator tests (`tests/scripts/extendedFixture.ts`)

A readable export of about 30 call rows, 2 campaigns (`camp_a` paid_search with a budget, `camp_b` social with a budget) and 2 offices (`loc_a` America/Phoenix, `loc_b` America/New_York). Started times run from `2026-09-20` to `2026-11-20` (61 days), so the span is long enough for C and D and crosses the New York DST change on 1 Nov. Rows use CRLF. Each campaign needs at least one **unanswered**, one **booked** (with revenue) and one **answered not booked** (`qualified_lead` or `not_qualified`) call; also include 1 unattributed (empty `campaign_id`), 1 pending (answered, empty outcome) and 1 duplicated call (two rows, 2 days apart). Export:

- `FIXTURE: ExportTexts`
- `TINY: ExtendedConfig`: every block small: A `calls: 6, answered: 2`; B `calls: 6, unanswered: 1, booked: 1`; C `calls: 6, unanswered: 1, booked: 2` (campaign `camp_a`); D `calls: 6, unanswered: 1, booked: 0` (campaign `camp_b`); `plainCalls: 5, unattributedCalls: 2, pendingCalls: 1, duplicatedCalls: 3, threeRowCalls: 1`; A targets `loc_a`, B targets `loc_b`.
- `OFF`: `TINY` with every group's counts set to 0, so a test switches on only what it checks.

---

### Task 1: Generator core with plain calls

**Files:**
- Create: `scripts/generate-extended.ts`, `tests/scripts/extendedFixture.ts`, `tests/scripts/generate-extended.test.ts`
- Modify: `tsconfig.json` (add `"scripts"` to `include`)

**Interfaces:**
- Consumes: nothing from `src/`.
- Produces:
  ```ts
  export interface ExportTexts { calls: string; campaigns: string; locations: string }
  export interface ExtendedConfig {
    seed: number;
    windowDays: number;                         // length of the C and D windows
    officeAnswerDrop:    { locationId: string; weekdays: { from: number; to: number }; hours: { from: number; to: number }; calls: number; answered: number };
    officeLowConversion: { locationId: string; calls: number; unanswered: number; booked: number };
    campaignSurge:       { campaignId: string; calls: number; unanswered: number; booked: number };
    campaignFade:        { campaignId: string; calls: number; unanswered: number; booked: number };
    plainCalls: number;
    unattributedCalls: number;
    pendingCalls: number;
    duplicatedCalls: number;
    threeRowCalls: number;                      // <= duplicatedCalls
  }
  // weekdays 0 = Monday, inclusive; hours are local, inclusive. Within each block the rest of its calls
  // (calls - unanswered - booked, or calls - answered) are answered and not booked.
  export const DEFAULT_CONFIG: ExtendedConfig;  // seed 20261101, windowDays 28; blocks A to D exactly as in the table above;
                                                // plain 480, unattributed 30, pending 10, duplicated 80, threeRow 20
  export class GenerateError extends Error {}
  export function generateExtendedCalls(input: ExportTexts, config?: Partial<ExtendedConfig>): string;
  // returns the whole calls.csv text: the input calls text verbatim, then synthetic rows
  ```

Template pools are built from the **final-state** original calls (latest `updated_at` per `call_id`). Plain calls use templates with a non-empty `campaign_id` that are not pending. A plain call is a clone with `started_at` shifted by a random whole number of **weeks** (weekday and time of day kept) so it lands at least 1 day inside the span `[first started_at, last started_at]`; all other fields (campaign, channel, tracking number, office, duration, answered, outcome, revenue, agent) are kept. New fields: `call_id` `x_000001` upward (6 digits, in generation order), `caller_number_hash` `h_x` + 7 hex digits from the PRNG, `ended_at` = start + duration, `updated_at` = `ended_at` + 5 to 30 seconds. Write one shared helper for "shift a template by whole weeks into `[lo, hi]`" so Task 4 reuses it.

- [ ] **Step 1: Write the failing tests** in `tests/scripts/generate-extended.test.ts`, using `FIXTURE` and `OFF` with `plainCalls: 5` unless stated:
  - `same seed gives identical text; a different seed gives different text`.
  - `the original calls text is kept byte for byte at the start`: `out.startsWith(FIXTURE.calls)`.
  - `adds exactly plainCalls rows, with the original header columns`: parse `out` by header name; row count is original rows + 5; the synthetic rows have all 14 columns.
  - `every line ends CRLF, the file ends with CRLF, and no bare LF`: `/\r\n$/` matches and `out.replace(/\r\n/g, '').includes('\n')` is false.
  - `synthetic ids are x_ numbered from 1 and do not collide with the input`: ids `x_000001`..`x_000005`; with a fixture row whose `call_id` is `x_000001` the call throws `GenerateError` matching `/x_000001/`.
  - `synthetic starts stay at least a day inside the span`: min and max of synthetic `started_at` are within `[first + 24h, last - 24h]`; `ended_at` equals `started_at` + `duration_seconds`; all timestamps match `/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/`.
  - `weekday and time of day are copied from a real call`: each synthetic start is a whole number of weeks from some template's start.
  - `a span under a week throws GenerateError` (two input rows 3 days apart, `plainCalls: 1`), message matching `/span/i`.
  - `an empty template pool throws GenerateError`: input whose every call is unattributed and `plainCalls: 1` matches `/plain/i`.
  - `no clock or Math.random`: `readFileSync('scripts/generate-extended.ts','utf8')` doesn't match `/Math\.random|Date\.now|new Date\(\)/`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/scripts/generate-extended.test.ts`
  Expected: FAIL, cannot resolve `scripts/generate-extended`.

- [ ] **Step 3: Implement** the types, `DEFAULT_CONFIG` and `generateExtendedCalls` for plain calls in `scripts/generate-extended.ts`. Use `csv-parse/sync` with `columns: true` to read; serialise synthetic rows by header name in the header's order, joined with `,` and `\r\n`; throw `GenerateError` if a template field contains a comma, quote or line break. PRNG: mulberry32, one instance per call. Format times with `toISOString().replace(/\.\d{3}Z$/, 'Z')`. Config blocks other than plain do nothing yet. Add `"scripts"` to `include` in `tsconfig.json`.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/scripts/generate-extended.test.ts; npm run typecheck`
  Expected: PASS, 10 tests; typecheck clean.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/generate-extended.ts tests/scripts tsconfig.json
  git commit -m "feat: seeded generator for the extended export, plain calls first

  Synthetic calls are week-shifted clones of real ones so rates and mixes match the shipped data.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 2: Pattern A, the office answer-rate drop

**Files:**
- Modify: `scripts/generate-extended.ts`, `tests/scripts/generate-extended.test.ts`

**Interfaces:**
- Consumes: Task 1's `generateExtendedCalls`, `ExtendedConfig`, `GenerateError`; in tests only, `loadExport` (`src/core/loadExport`) and `cleanExport` (`src/core/clean`) to read the output the way the app does.
- Produces: no new exports. `officeAnswerDrop` now adds rows.

Rows: `location_id` = `locationId`; `calls - answered` clones of unanswered templates and `answered` clones of **booked** templates with revenue (any attributed campaign). `started_at` is drawn as a UTC instant uniformly inside the 1-day margin and **accepted only if the office's local weekday and hour are in the window** (one `Intl.DateTimeFormat` for the office's zone, built once; at most 100,000 attempts per call, then `GenerateError`). Seconds are random. Other fields as in Task 1. Comment in the code: the answered calls are booked so the office's booking rate stays near the rest (Issue 2).

- [ ] **Step 1: Write the failing tests.** Config `{ ...OFF, officeAnswerDrop: { locationId: 'loc_a', weekdays: {from: 0, to: 4}, hours: {from: 9, to: 11}, calls: 6, answered: 2 } }`; read through `cleanExport(loadExport({ ...FIXTURE, calls: out }))` and take calls whose `callId` starts `x_`:
  - `all at the target office, in the window by local time`: 6 calls, each `locationId === 'loc_a'`, `localWeekday` 0 to 4, `localHour` 9 to 11.
  - `the window holds across a DST change (New York, 1 Nov)`: target `loc_b`, `calls: 40, answered: 8`; all still `localHour` 9 to 11, and at least one has `localDate >= '2026-11-01'` and one before.
  - `exactly answered of them are answered, and those are booked`: 2 answered, all `booked` with `revenueUsd > 0`; the other 4 have outcome `missed`, `voicemail` or null, no revenue and no agent.
  - `no bad rows, and revenue only on booked`: `store.dataNotes.badCalls === 0` and `revenueOnNonBookedCalls === 0`.
  - `a target office not in locations.csv throws GenerateError naming it`: `locationId: 'loc_zz'` matches `/loc_zz/`.
  - `answered above calls throws GenerateError`.
  - `a window that never occurs throws GenerateError`: `weekdays: {from: 6, to: 6}` on a 3-day-span input matches `/window|span/i`.
  - `no booked templates` (input with none) and `answered > 0` throws `GenerateError` matching `/booked/i`; likewise `/unanswered/i` for no unanswered templates.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/scripts/generate-extended.test.ts`
  Expected: FAIL on the new tests only.

- [ ] **Step 3: Implement pattern A** as described. Validate config first (target office exists, `0 <= answered <= calls`). Draw the PRNG in a fixed order, one group after another, in this order: plain, A, B, C, D, unattributed, pending, duplicated, so adding a group later changes only the rows after it.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/scripts/generate-extended.test.ts; npm run typecheck`
  Expected: PASS, 18 tests; typecheck clean.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/generate-extended.ts tests/scripts
  git commit -m "feat: plant a low-answer-rate window at one office, placed by local time

  Locations needs something real to flag; the window is chosen in the office's zone so DST can't move it.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 3: Pattern B, the office low-conversion outlier

**Files:**
- Modify: `scripts/generate-extended.ts`, `tests/scripts/generate-extended.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: no new exports. `officeLowConversion` now adds rows.

Rows: `location_id` = `locationId`; `unanswered` clones of unanswered templates, `booked` clones of booked templates with revenue, and the rest (`calls - unanswered - booked`) clones of **answered, not booked, with an outcome** templates (`qualified_lead` or `not_qualified`). All attributed, any campaign. Times are day-shifted clones as in Task 1 (the template's own local time of day is kept in the template's zone; the office is overridden but the clock time is not, which is fine for this pattern).

- [ ] **Step 1: Write the failing tests.** Config `{ ...OFF, officeLowConversion: { locationId: 'loc_b', calls: 6, unanswered: 1, booked: 1 } }`, read through `cleanExport`:
  - `counts are exact`: 6 `x_` calls at `loc_b`: 1 unanswered, 1 booked, 4 answered with outcome `qualified_lead` or `not_qualified` and `revenueUsd === 0`.
  - `no pending, no unattributed, no bad rows`.
  - `starts stay inside the span margin` (as Task 1).
  - `booked + unanswered above calls throws GenerateError`.
  - `a target office not in locations.csv throws GenerateError naming it`.
  - `no answered-not-booked templates` (input without any) and a positive remainder throws `GenerateError` matching `/not booked/i`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/scripts/generate-extended.test.ts`
  Expected: FAIL on the new tests only.

- [ ] **Step 3: Implement pattern B.** Reuse the pools from Task 2.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/scripts/generate-extended.test.ts; npm run typecheck`
  Expected: PASS, 24 tests; typecheck clean.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/generate-extended.ts tests/scripts
  git commit -m "feat: plant a low-booking-rate office whose answer rate stays normal

  Locations also flags booking rate; this separates that flag from the answer-rate one.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 4: Patterns C and D, the campaign surge and fade

**Files:**
- Modify: `scripts/generate-extended.ts`, `tests/scripts/generate-extended.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3 and the shift-by-weeks helper from Task 1.
- Produces: no new exports. `campaignSurge` and `campaignFade` now add rows.

Windows are offsets from the data's own last call `E` (UTC): **recent** = `[E - (windowDays - 1) days, E - 1 day]`, **earlier** = `[E - (2*windowDays - 1) days, E - windowDays days]`. Surge calls land in recent, fade calls in earlier. Templates come from **that campaign's own** final-state calls (so campaign, channel, tracking number and office are real): `unanswered` from its unanswered, `booked` from its booked with revenue, the rest from its answered-not-booked-with-outcome. Each is shifted by whole weeks into its window with the shared helper (a window of 28 days always holds a shift). The span must be at least `2*windowDays` days, else `GenerateError` matching `/span/i`.

- [ ] **Step 1: Write the failing tests.** Config `{ ...OFF, windowDays: 28, campaignSurge: { campaignId: 'camp_a', calls: 6, unanswered: 1, booked: 2 }, campaignFade: { campaignId: 'camp_b', calls: 6, unanswered: 1, booked: 0 } }`; read through `cleanExport`:
  - `surge calls are camp_a, in the last 28 days; fade calls are camp_b, in the 28 days before`: compare `localDate` with the data's last `localDate` minus 27 and minus 28 (derived in the test from the fixture, not typed in); all 12 inside their windows.
  - `counts are exact`: surge has 1 unanswered, 2 booked, 3 answered not booked; fade has 1 unanswered, 0 booked, 5 answered not booked.
  - `the campaign's own channel and tracking number are kept`: each synthetic call matches a real call of that campaign on channel and tracking number.
  - `a span under 2 x windowDays throws GenerateError` matching `/span/i` (use a 40-day input).
  - `an unknown campaign throws GenerateError naming it`.
  - `a campaign with no booked calls to clone throws GenerateError matching /booked/i` when `booked > 0`.
  - `no bad rows, no unattributed`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/scripts/generate-extended.test.ts`
  Expected: FAIL on the new tests only.

- [ ] **Step 3: Implement patterns C and D.**

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/scripts/generate-extended.test.ts; npm run typecheck`
  Expected: PASS, 31 tests; typecheck clean.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/generate-extended.ts tests/scripts
  git commit -m "feat: plant a campaign surge and a campaign fade in adjacent 28-day windows

  Gives the Campaigns view and later alerts a real jump and a real drop; windows are offsets from the data's end.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 5: Unattributed, pending and duplicate calls

**Files:**
- Modify: `scripts/generate-extended.ts`, `tests/scripts/generate-extended.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 4.
- Produces: no new exports. `unattributedCalls`, `pendingCalls` and `duplicatedCalls` now add rows.

Rules, all from final-state templates:
- **Unattributed:** templates with an empty `campaign_id`, day-shifted like plain calls. Tracking numbers and channel are inherited, so the set of unattributed tracking numbers does not grow.
- **Pending:** templates answered with an empty outcome, day-shifted, one row each, no later row.
- **Duplicated:** templates answered with an outcome and an attributed campaign. Row 1: outcome and revenue **empty**, `updated_at` = `ended_at` + 5 to 30 s. Row 2: the final outcome and revenue, `updated_at` = row 1's + 1 to 47 hours. For `threeRowCalls` of them, row 3 repeats row 2's content with `updated_at` = row 2's + 1 to 24 hours. A call's last `updated_at` is therefore within 71 hours of `ended_at` plus 30 s.
- All synthetic rows are written sorted by `updated_at`, then `call_id`, after the original text. No two rows of a call share an `updated_at`.

- [ ] **Step 1: Write the failing tests.** Config `{ ...OFF, unattributedCalls: 2, pendingCalls: 1, duplicatedCalls: 3, threeRowCalls: 1 }`, read through `cleanExport`:
  - `unattributed calls have an empty campaign_id and an existing tracking number`: 2 synthetic calls with `unattributed === true`, each `trackingNumber` among the input's unattributed tracking numbers.
  - `pending calls are answered with no outcome and one row each`: 1 call, `pending === true`; one raw row with its id.
  - `duplicated calls: two rows, or three for threeRowCalls`: 7 raw rows for 3 calls; exactly 1 call has 3 rows.
  - `the later row wins and fills in the outcome`: each duplicated call's cleaned `outcome` is non-null; `dataNotes.duplicateRowsCollapsed` is the input's own count + 4.
  - `no ties, and the last update is within 71 hours of the end`: `tiedCalls` unchanged; per duplicated call, last `updated_at` minus `ended_at` is at most 71 hours + 30 s.
  - `the outcome lag stays what the input had`: `outcomeLagDays` equals the input's own value cleaned alone (fixture's duplicated call has a 2-day gap, so it isn't 0).
  - `synthetic rows are sorted by updated_at then call_id and come after the original rows`.
  - `a quota with no templates throws GenerateError naming it`: no unattributed calls and `unattributedCalls: 1` matches `/unattributed/i`; same for `/pending/i`.
  - `threeRowCalls above duplicatedCalls throws GenerateError`.
  - `with every group on (TINY), no bad rows and revenue only on booked`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/scripts/generate-extended.test.ts`
  Expected: FAIL on the new tests only.

- [ ] **Step 3: Implement the three groups** after pattern D in the PRNG order, then sort only the synthetic rows and append them to the original text.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/scripts/generate-extended.test.ts; npm run typecheck`
  Expected: PASS, 41 tests; typecheck clean.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/generate-extended.ts tests/scripts
  git commit -m "feat: add duplicate, unattributed and pending synthetic calls

  The extended data should be as messy as the original so the cleaning rules still have work to do.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 6: Generate, commit, and pin the totals

**Files:**
- Create: `data/extended/calls.csv`, `data/extended/campaigns.csv`, `data/extended/locations.csv`, `tests/snapshot/extended-export.test.ts`
- Modify: `scripts/generate-extended.ts` (CLI), `package.json`, `README.md`, `docs/DECISIONS.md` (confirm the proposed rows match what was built)

**Interfaces:**
- Consumes: `generateExtendedCalls`, `DEFAULT_CONFIG` (Tasks 1 to 5); from `src/`: `readExportFromDir`, `cleanExport`, `officeOutlier`, `dataSpan`, `resolveRange`, `resolveComparison`, `callsInRange`, `tally`.
- Produces:
  ```ts
  export function writeExtended(fromDir: string, toDir: string, config?: Partial<ExtendedConfig>): void;
  // reads fromDir/{calls,campaigns,locations}.csv; writes toDir/calls.csv (generated) and byte copies of the other two
  ```
  CLI: `node scripts/generate-extended.ts [fromDir=. [toDir=data/extended]]`, guarded by `import.meta.main`. `package.json` script: `"generate:extended": "node scripts/generate-extended.ts"`.

- [ ] **Step 1: Write the failing tests** in `tests/snapshot/extended-export.test.ts`, against `data/extended` (and `tests/fixtures/original-export` for the originals):
  - `regenerating from the seed gives the committed file`: `generateExtendedCalls(texts of the repo-root CSVs)` equals `readFileSync('data/extended/calls.csv','utf8')`.
  - `the original export is untouched`: repo-root CSVs byte-equal the fixture copies; `data/extended/campaigns.csv` and `locations.csv` byte-equal them; `data/extended/calls.csv` starts with the original `calls.csv` bytes.
  - `loads with no bad rows`: `badByReason` all 0, `referenceIssues` empty, `unparseableUpdatedAt` and `unparseableEndedAt` 0.
  - `totals`: `rowsRead` 6911; 6400 calls; `callsAfterDedup` 6400; `duplicateRowsCollapsed` 511; `badCalls` 0; `unattributedCalls` 174 on the same 10 tracking numbers as the original; `pendingCalls` 51; `tiedCalls` 0; `revenueOnNonBookedCalls` 0; `bookedWithoutRevenueCalls` 0; `outcomeLagDays` 3. **Bookings and revenue are recorded, not derived:** run once, write the observed values in, and check they are sane (bookings between 1,204 + 72 and 1,204 + 1,400; revenue above $432,894).
  - `the data span and as-of date do not move`: `dataSpan(extended.calls)` equals `dataSpan(original.calls)`.
  - **Locations:** for each office, `officeOutlier` of the office against all others pooled, over the whole span, on answer rate and on booking rate. `loc_06` is flagged **worse on answer rate** and not flagged on booking rate; `loc_02` is flagged **worse on booking rate** and not on answer rate; no other office is flagged on either. Pin the observed z values to one decimal as comments only if useful, not as assertions.
  - `Canyon's busiest missed slot is in the window`: count unanswered calls at `loc_06` by `(localWeekday, localHour)`; the top slot has weekday 0 to 4 and hour 9 to 11.
  - **Campaigns:** with `resolveRange(span, {kind:'preset', preset:'last28'})` and `resolveComparison`, `cmp_04`'s calls in the current range are at least 50% above the previous range and `cmp_06`'s are at least 30% below (use `tally` and `changeInCount`). Over all data `cmp_06` has exactly as many bookings as in the original export. Record the best and worst campaign by revenue per budget dollar over all data as observed values (this may be unchanged from the original; say which).
  - `the shipped export flags no office`: the Locations loop on `tests/fixtures/original-export` flags none on answer rate or booking rate.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/snapshot/extended-export.test.ts`
  Expected: FAIL, `data/extended/calls.csv` not found.

- [ ] **Step 3: Implement `writeExtended` and the CLI**, add the `package.json` script, then generate: `npm run generate:extended`. Copy the other two CSVs as bytes (`copyFileSync`). If the derivable totals (6911, 6400, 511, 174, 51) differ, stop and report; that is a generator bug, not a number to adjust. If the flagged offices differ from the list above, or the surge or fade misses its threshold, stop and report; don't tune `DEFAULT_CONFIG` quietly.

- [ ] **Step 4: Record the observed bookings, revenue, and best and worst campaign** in the test, then run:

  Run: `npm test; npm run typecheck`
  Expected: all suites pass (the existing Phase 1 to 3 suites unchanged and green); typecheck clean.

- [ ] **Step 5: Update `README.md`.** Under Data: the extended export lives in `data/extended/`, **contains synthetic rows** (`x_` call ids, appended after the unchanged original rows), plants four patterns (a low answer rate at Canyon Office on weekday mornings, a low booking rate at Riverside Office, a surge in one campaign's calls, a fade in another's), and is used with `DATA_DIR=data/extended`; the default stays the shipped export; regenerate with `npm run generate:extended`. Add the command to the table. Confirm `docs/DECISIONS.md` rows match what was built.

- [ ] **Step 6: Commit**

  ```bash
  git add data scripts tests package.json README.md docs/DECISIONS.md
  git commit -m "feat: commit the extended export and pin its totals

  Regenerates byte for byte from the seed; Locations flags two offices and Campaigns shows a surge and a fade on the extended data, and none on the original.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

  Then run `npm test` and `npm run typecheck` once more, show the output, and **stop** for review.

---

## Self-review

- **Spec coverage:** extended export in its own folder from a seeded committed script (Tasks 1 to 6); original untouched (Task 6); patterns for Locations (Tasks 2, 3, flagged in Task 6), and for Campaigns and S1 alerts (Task 4, pinned in Task 6); duplicates, unattributed and pending (Task 5); zero bad rows (Tasks 5, 6); regenerates identically (Tasks 1, 6); loads clean (Task 6); totals in a test (Task 6); existing rule tests not broken (Task 6 runs the full suite; the generator is read through the same `cleanExport`). Decisions go to `docs/DECISIONS.md`; the README says the data is synthetic. Phase 8's "flag appears on the extended data, none on the original" is pinned here.
- **Types:** `ExportTexts`, `ExtendedConfig` (blocks `officeAnswerDrop`, `officeLowConversion`, `campaignSurge`, `campaignFade`), `GenerateError`, `generateExtendedCalls`, `writeExtended` are used with the same names throughout.
- **Totals check:** synthetic calls 200 + 300 + 150 + 150 + 480 + 30 + 10 + 80 = 1,400; extra rows 60 x 1 + 20 x 2 = 100; extended rows 5,411 + 1,400 + 100 = 6,911; calls 5,000 + 1,400 = 6,400; collapsed 411 + 100 = 511; unattributed 144 + 30; pending 41 + 10.
- **Open until you answer:** the issues above, chiefly 1 (append-only limits), 2 (Canyon's booked answers), 3 (two flagged offices, a Phase 5 question) and 4 (default dataset).
