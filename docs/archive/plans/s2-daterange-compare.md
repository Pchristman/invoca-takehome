# Phase S2 (Compare any two date ranges) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the marketer pick the second range freely (any dates inside the data, before, after, overlapping or a different length), with the URL holding both ranges and every view's changes using the chosen range.

**Architecture:** The engine already takes any two ranges and the server already parses `compareStart`/`compareEnd`. S2 changes one rule in the core (a second range of another length is compared **per day** instead of being refused), carries that fact in `ViewNotes`, and adds the picker and the notes in the web app. Nothing is computed in the browser; the picker only builds URL text and the server stays the one judge of a range.

**Tech Stack:** TypeScript (strict), vitest, React with `react-dom/server` render tests. Nothing new to install.

**Spec:** `PLAN.md` (3.1 date range, 3.2 comparison, 3.3 caveats, section 5 rules 9, "S2: Compare any two date ranges" in section 9), `docs/BRIEF.md` (stretch goal 2), `CLAUDE.md`, `docs/plans/03-ranges-and-metrics.md`, `07-ui-part-one.md`, `s1-alerts.md` (the code this extends), `src/core/comparison.ts`, `src/core/views/viewContext.ts`, `src/web/urlState.ts`, `src/web/components/RangeControl.tsx`.

## Global Constraints

- Work **one task at a time**. After the last task run `npm test`, `npm run typecheck` and `npm run build`, run the click-through checklist at the end of this file, show the results, then **stop** and wait (CLAUDE.md).
- **No new dependency.** If one seems needed, stop and ask.
- S2 done-when, from PLAN.md: the URL holds both ranges and every view's changes use the chosen range; the README covers what this phase added. Edge cases PLAN.md lists: overlapping ranges (allowed, with a note); unequal lengths (counts are compared per day, and the view says so); second range outside the data. Each has tests below (Tasks 1 to 3 for the rule, 4 for the server and real data, 5 and 6 for the screen).
- **Every number the user sees comes from code.** The per-day figures come from `changeInCountPerDay` in the core. The browser formats and labels; it divides nothing.
- **This phase changes a data rule** (rule 9 and CLAUDE.md say equal length only). The user approved it on 2026-11-20 (see "Gaps in PLAN.md" item 1 and `docs/DECISIONS.md`). `PLAN.md` and `CLAUDE.md` still say "equal length"; the user has not asked me to edit them, so the wording change stays pending.
- The app works with AI off. The fact-sheet change in Task 2 only removes numbers from what the model sees.
- Nothing hard-coded to this dataset: no campaign or office names, ids or dates in `src/`. Tests may use dates and ids. `tests/core/different-names.test.ts` scans `src/` and `index.html`.
- No raw colour or duration literals outside `src/web/styles/tokens.css`. This phase adds no token and no new colour.
- Names from the data are shown as text only, never as markup, and never re-scanned for `{placeholders}`.
- Never read, print or `git add` `.env`. Do not write to `docs/AI_COST_LOG.md` or edit `docs/BRIEF.md`. **Stage files by name, never `git add -A`**, and never stage `PLAN.md`, `CLAUDE.md`, `docs/AI_COST_LOG.md` or `docs/BRIEF.md` (run `git status` first; uncommitted work in those files stays the user's). This plan does not edit `PLAN.md` or `CLAUDE.md`.
- Commit after each task, small, message says why, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Prefer simple, readable code; a reviewer will walk through all of it.

## Gaps in PLAN.md this plan fills

PLAN.md's S2 is a few lines. Items 1 to 5 are real decisions, approved by the user and in `docs/DECISIONS.md`; 6 is a detail.

1. **S2 contradicts the equal-length rule.** PLAN.md section 3.2 ("same number of days"), section 5 rule 9 ("Equal-length periods only") and CLAUDE.md ("Comparisons use periods of equal length") say equal length. PLAN.md's S2 edge case says "unequal lengths (counts are compared per day, and the view says so)". Phase 3 chose to refuse unequal lengths until S2 (the Phase 3 review-fix row in DECISIONS.md). Proposal: an unequal second range is **compared per day, and the screen says so**. Counts and money compare `current ÷ current days` with `previous ÷ previous days`; rates already ignore length. The default comparison stays equal length. This is a data-rule change, approved; two sentences each in `PLAN.md` (3.2 and rule 9) and one in `CLAUDE.md` should read "equal length by default; a second range of another length is compared per day and labelled". I have not edited either file; the wording is in the DECISIONS row and the edit awaits your go-ahead.
2. **Unique callers are not compared across unequal lengths.** Distinct callers do not grow in proportion to days, because repeat callers are counted once. On the shipped export, 28 days (Oct 2 to Oct 29) has 1,317 unique callers and 7 days (Sep 8 to Sep 14) has 474: per day that reads about −30.5%, while calls per day are +1.3%. A per-day number that wrong is worse than none. The tile shows no change and says why. Calls, bookings and revenue are per day because they do scale with days.
3. **Call-change alerts (S1) are not tested across unequal lengths.** The test `z = (current − previous) / √(current + previous)` assumes equal exposure. S1 already withholds alerts when the comparison overlaps; unequal length gets the same treatment with its own reason. The change column still shows. If both apply, the unequal-length reason is shown.
4. **Change facts leave the fact sheet when per-day.** The AI sees `overview.calls_change` as a plain percentage and may write "calls rose X%". When the figure is per day it must not read like a total, and the checker cannot tell. So `overview.calls_change`, `callers_change`, `bookings_change` and `revenue_change` are left out of Overview's fact sheet when the comparison is per day. `answer_rate_change` stays (points, length-independent). No prompt change, no `PROMPT_VERSION` bump.
5. **The second range may be anywhere inside the data**: before, after, overlapping, inside, or identical to the selected range. "Previous" is only the default. The screen always prints which two ranges are being compared, so "was 587" is never ambiguous. Overlap keeps S1's behaviour and the existing caveat.
6. **Changing the selected range still clears the second range** (`withRange`; the Phase 7 URL-state row). The picker adds a "Use previous period" button that clears only the second range. A second range outside the data stays a normal 200 with the existing reason (the Phase 6 error-shape row).

## Review Focus

Inputs the spec implies but no listed edge case names. Each has a test in the owning task.

1. **The second range is the selected range itself, or contains it**: allowed; changes read 0.0% (or per-day figures); overlap caveat shown; no alerts; no NaN. (Tasks 1, 3, 6)
2. **The second range is later than the selected one, or touches the last data day**: works; the "last day may be incomplete" caveat for the comparison period still shows. (Tasks 1, 6)
3. **A one-day or empty second range** (valid dates inside the data, zero calls): "new" or no change, never Infinity; "1 day", not "1 days". (Tasks 1, 2, 6)
4. **A hand-edited URL with a half-filled, inverted or garbage second range**: the server says 400 with the field; the range control stays on screen with the message; the inputs show blanks, not the garbage. (Tasks 4, 5)
5. **Unique callers across unequal lengths**: no change shown, with the reason, even though calls per day do show one. (Tasks 2, 6)

---

## File Structure

```
src/core/comparison.ts                  (modify) unequal length is available; RangeComparison.perDay
src/core/metrics.ts                     (modify) changeInCountPerDay
src/core/views/viewContext.ts           (modify) ViewNotes.comparison gains perDay, currentDays, previousDays
src/core/views/overviewView.ts          (modify) per-day tiles, no unique-callers change, change facts only when not per day
src/core/views/campaignsView.ts         (modify) per-day callsChange, alerts off when per day
src/web/urlState.ts                     (modify) withCompare, customCompare
src/web/components/RangeControl.tsx     (modify) second range inputs, Compare, Use previous period
src/web/App.tsx                         (modify) pass onCompare
src/web/models/caveats.ts               (modify) 'per_day' caveat
src/web/models/comparisonLine.ts        which two ranges are being compared
src/web/models/overviewModel.ts         (modify) "per day" wording, unique-callers reason
src/web/models/campaignsModel.ts        (modify) per-day "Calls vs previous" cell
src/web/components/OverviewView.tsx     (modify) comparison line
src/web/components/CampaignsView.tsx    (modify) comparison line
README.md                               (modify) what S2 added; the S1 "Needs a full, equal-length previous period" bullet
docs/DECISIONS.md                       (modify, done with this plan)
tests/core/comparison.test.ts, metrics.test.ts, views/viewContext.test.ts, views/overviewView.test.ts, views/campaignsView.test.ts   (modify)
tests/core/different-names.test.ts      (modify)
tests/snapshot/compare-ranges.test.ts   both real exports
tests/server/app.test.ts                (modify)
tests/web/urlState.test.ts, errors.test.ts, caveats.test.ts, comparisonLine.test.ts, overviewModel.test.ts, campaignsModel.test.ts, render.test.tsx, render-campaigns.test.tsx   (modify or create)
```

---

### Task 1: The engine compares unequal lengths per day

**Files:**
- Modify: `src/core/comparison.ts`, `src/core/metrics.ts`
- Test: `tests/core/comparison.test.ts`, `tests/core/metrics.test.ts`, `tests/web/errors.test.ts`

**Interfaces:**
- Consumes: `inclusiveDays`, `checkDates`, existing `changeInCount` and `Change`.
- Produces:
  - `RangeComparison.perDay: boolean`: true exactly when `available` and the two ranges differ in length. `available` now means only "every day of `previous` lies inside the data". `unavailableReason` is `null` or starts "No full previous period"; the "No like-for-like comparison" wording is gone. Update both doc comments, and the comment on `resolveComparison` ("Per-day comparison of unequal lengths is stretch S2").
  - `changeInCountPerDay(current: number, currentDays: number, previous: number, previousDays: number): Change` in `metrics.ts`.

- [ ] **Step 1: Write the failing tests.**
  `tests/core/comparison.test.ts`, in "resolveComparison with an explicit second range" (data span `2026-09-01` to `2026-10-29`, current `2026-10-23` to `2026-10-29`; use that file's `compare` and `range` helpers):
  1. Replace "an explicit second range of another length is unavailable until per-day comparison exists" with `another length is available and per day`: `2026-09-01` to `2026-09-03` gives `available: true`, `perDay: true`, `sameLength: false`, `unavailableReason: null`, `previous.days: 3`.
  2. `the same length is not per day`: `perDay` false.
  3. `outside the data beats the length` (PLAN.md edge case "second range outside the data"), table of unequal-length ranges, each `available: false`, `perDay: false`, reason starts "No full previous period": wholly before (`2026-07-01`..`2026-07-03`), wholly after (`2026-11-05`..`2026-11-08`), straddling the start (`2026-08-30`..`2026-09-02`), straddling the end (`2026-10-28`..`2026-11-02`). The existing "a range the data does not cover" test stays.
  4. Review Focus 1: `the selected range itself`: `compare(current, current)` is `available: true`, `overlaps: true`, `perDay: false`. `a range that contains it` (`2026-10-01`..`2026-10-31` is past the data; use `2026-10-01`..`2026-10-29`): `available`, `overlaps`, `perDay: true`.
  5. Review Focus 2: `later than the selected range`: current `2026-09-08`..`2026-09-14`, second `2026-10-01`..`2026-10-07` is `available: true`, `overlaps: false`, `perDay: false`.
  6. Review Focus 3: `a one-day second range`: `2026-09-01`..`2026-09-01` is `available: true`, `perDay: true`, `previous.days: 1`.
  `tests/web/errors.test.ts` (~line 139): the `unequal` case is now available. Keep `before` (colon and "No full previous period:" prefix); replace `unequal` with an unequal range **outside the data** so both reasons still contain a colon, and assert the first still matches `/^No full previous period:/`; add one assertion that a plain unequal in-data range gives `available: true` and `unavailableReason: null`.
  `tests/core/metrics.test.ts`, table-driven `changeInCountPerDay(current, currentDays, previous, previousDays)`:

  | case | args | expected |
  | --- | --- | --- |
  | equal days equals changeInCount | 56, 28, 28, 28 | percent 100 |
  | 28 days against 7 | 56, 28, 7, 7 | percent 100 |
  | 7 days against 14 | 14, 7, 14, 14 | percent 100 |
  | 7 days against 3, same rate | 14, 7, 6, 3 | percent 0 |
  | 1 day against 28 | 5, 1, 28, 28 | percent 400 |
  | zero before | 10, 7, 0, 14 | new |
  | zero now | 0, 7, 12, 3 | percent −100 |
  | both zero | 0, 7, 0, 3 | none |
  | days not usable | 5, 0, 5, 7; 5, 7, 5, −1; 5, 2.5, 5, 7; 5, NaN, 5, 7; 5, 7, 5, Infinity | none (each) |
  | count not usable | NaN, 7, 5, 3; 5, 7, Infinity, 3 | none (each) |

  Use `toBeCloseTo` for percent values. Equal days with unusable days (e.g. `5, 0, 5, 0`) is `none` too.

- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/core/comparison.test.ts tests/core/metrics.test.ts tests/web/errors.test.ts`. Expected: FAIL (`perDay` undefined, `changeInCountPerDay` not exported, an unequal range still unavailable).

- [ ] **Step 3: Implement.** In `comparison.ts` drop the length clause from `unavailableReason` and add `perDay: unavailableReason === null && !sameLength`. In `metrics.ts` write `changeInCountPerDay`: `none` unless both day counts are positive integers; equal days call `changeInCount` directly (so equal-length results are byte-identical to today); otherwise `changeInCount(current / currentDays, previous / previousDays)`.

- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS. Then `npx vitest run tests/core tests/web`: only tests that pin the old unequal-length refusal may fail, in `tests/core/views/*`, `tests/server/app.test.ts` and `tests/web/overviewModel.test.ts`; leave them, Tasks 2 to 6 fix each. Any other failure is a real problem: stop and tell me.

- [ ] **Step 5: Commit** `src/core/comparison.ts src/core/metrics.ts tests/core/comparison.test.ts tests/core/metrics.test.ts tests/web/errors.test.ts docs/DECISIONS.md` with "feat: a second range of another length is compared per day, as PLAN.md S2 asks, instead of being refused".

---

### Task 2: Overview tiles and notes use the per-day rule

**Files:**
- Modify: `src/core/views/viewContext.ts`, `src/core/views/overviewView.ts`
- Test: `tests/core/views/viewContext.test.ts`, `tests/core/views/overviewView.test.ts`

**Interfaces:**
- Consumes: `RangeComparison.perDay`, `changeInCountPerDay` (Task 1).
- Produces:
  - `ViewNotes.comparison` becomes `{ available: boolean; previous: DateRange | null; reason: string | null; overlaps: boolean; perDay: boolean; currentDays: number; previousDays: number | null }`. `currentDays` is `range.days`; `previousDays` is the second range's days, `null` when it could not be resolved; `perDay` is false when unavailable or unresolved.
  - `OverviewView.tiles`: calls, bookings and revenue tiles keep `current` and `previous` as totals and `change` becomes `changeInCountPerDay(current, range.days, previous, previousDays)`. The unique-callers tile has `previous: null` and `change: { kind: 'none' }` whenever `perDay` is true. The answer-rate tile is unchanged. Update the doc comment on `Tile`: "change is per day when notes.comparison.perDay".
  - When `perDay`, `factSheet.facts` has no `overview.calls_change`, `overview.callers_change`, `overview.bookings_change` or `overview.revenue_change`.

- [ ] **Step 1: Write the failing tests.** Fixture for `overviewView.test.ts`: current `range('2026-09-08', '2026-09-14')`; helper adding `n` calls on each date of a range; data covers `2026-09-01` to `2026-09-14`.
  1. `per day, not totals`: 2 calls a day over the 7 days (14) against 1 a day over `2026-09-01`..`2026-09-03` (3): calls tile `{ current: 14, previous: 3, change: { kind: 'percent', value: ≈100 } }` (a total change would be about +367%, say so in a comment).
  2. `bookings and revenue per day`: one booked $100 call a day now (7 bookings, $700) against one booked $100 call in the 3-day range (1 booking, $100): bookings tile `{ current: 7, previous: 1 }` and revenue tile `{ current: 700, previous: 100 }`, both with change percent ≈ +200 (1 a day against 0.33 a day; totals would say +600%).
  3. `unique callers are not compared` (Review Focus 5): `uniqueCallers.previous` null and `change` none while `calls.change` is a percent; with the equal-length comparison the unique-callers tile still has both.
  4. `answer rate stays in points`: 50% now against 100% before gives `{ kind: 'points', value: −50 }` per day or not.
  5. `notes`: per-day case has `perDay: true`, `currentDays: 7`, `previousDays: 3`, `reason: null`; the equal-length case `perDay: false`, `previousDays: 7`; a bad second range `{ start: '2026-02-30', ... }` has `available: false`, `perDay: false`, `previousDays: null`, `currentDays: 7`.
  6. `fact sheet`: per day has `overview.answer_rate_change` and none of the four count and money change keys; equal length still has `overview.calls_change`.
  7. Review Focus 3: `an empty second range`: the 3-day range holds no calls, so calls `change` is `{ kind: 'new' }`; both empty gives `none`; `expectAllFinite(view)` for each.
  8. Review Focus 1: `the selected range as the second range`: calls change is `{ kind: 'percent', value: 0 }`, `notes.comparison.overlaps` true, `perDay` false.
  9. Review Focus 3: `a one-day second range` builds, `previousDays: 1`, finite.
  10. `second range outside the data`: `available: false`, every tile `previous` null and change none, reason starts "No full previous period".
  Change the existing `a bad or unequal second range builds with no comparison` (line ~134): keep the bad-date item, replace the unequal item by an outside-the-data item (test 10 may replace it).
  `viewContext.test.ts` (line ~64): `an unequal-length second range` is now `available: true`, `perDay: true`, `reason: null`, and `ctx.previous` holds the calls of that range; add `an unequal range outside the data` giving the coverage reason and `ctx.previous` null.

- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/core/views/viewContext.test.ts tests/core/views/overviewView.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the notes in `makeViewContext` and the tile and fact changes in `buildOverview` per the Interfaces block (reuse one `countTile` helper that takes the per-day change).
- [ ] **Step 4: Run** `npx vitest run tests/core/views/viewContext.test.ts tests/core/views/overviewView.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** the four files by name, "feat: Overview compares unequal ranges per day and never compares unique callers across lengths".

---

### Task 3: Campaigns compares per day and withholds alerts

**Files:**
- Modify: `src/core/views/campaignsView.ts`
- Test: `tests/core/views/campaignsView.test.ts`

**Interfaces:**
- Consumes: `notes.comparison.perDay | currentDays | previousDays` (Task 2), `changeInCountPerDay`.
- Produces: `CampaignRow.callsChange` and `UnattributedRow.callsChange` are per-day when `perDay`; `previousCalls` stays the total. `CampaignsView.alerts` is `{ checked: false, reason: 'Call-change alerts need two periods of the same length; these are ${currentDays} and ${previousDays} days.', flagged: 0, … }` when `perDay` (the reason takes precedence over the overlap reason; unavailable keeps its own reason first). No row is flagged and no `review_call_changes` action exists in that case. Update the comment at line ~103 ("Both periods have equal length here") and on `alerts`.

- [ ] **Step 1: Write the failing tests** (the file's existing fixture: current `2026-09-08`..`2026-09-14`, `on(campaign, n, date)` helper, `anchors()`; use `range('2026-09-01','2026-09-03')` as the 3-day second range):
  1. `per day, not totals`: `cmp_a` 14 now (2 a day), 3 before → `previousCalls` 3 and `callsChange` percent ≈100.
  2. `alerts are withheld across lengths`: `cmp_a` 60 now, 30 before over the 3-day range (flagged if the lengths were equal) → `alerts` `{ checked: false, reason: 'Call-change alerts need two periods of the same length; these are 7 and 3 days.', flagged: 0, z: 3, minCalls: 20 }`, every `alert` null, no `review_call_changes` action, `callsChange` still a percent.
  3. `per day and overlapping`: a second range of another length that overlaps (`2026-09-10`..`2026-09-12`) shows the per-day reason, not the overlap one.
  4. `unattributed per day`: 14 calls now, 3 before, no campaign → `callsChange` ≈100, `alert` null.
  5. Review Focus 3: `zero in the comparison, per day`: 10 now, 0 before over the 3-day range → `callsChange` `{ kind: 'new' }`; `expectAllFinite`.
  6. `second range outside the data`: `2026-08-01`..`2026-08-03` → every `previousCalls` null, `alerts.reason` starts "No full previous period".
  7. Review Focus 1: `the selected range as the second range`: equal length, overlapping → the existing overlap reason, every campaign that has calls has `callsChange` percent 0, no alerts.
  Update `a custom previous range of another length` (line ~328): it now asserts the new per-day reason (test 2 may replace it) and `previousCalls` is a number.
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/core/views/campaignsView.test.ts`. Expected: FAIL on the new and updated tests only.
- [ ] **Step 3: Implement** in `buildCampaigns`: `callsChange` through `changeInCountPerDay(t.calls, range.days, previousCalls, previousDays)`; skip the alert test and set the reason when `perDay`; `buildUnattributed` takes the per-day change (pass the days in).
- [ ] **Step 4: Run** `npx vitest run tests/core`. Expected: PASS.
- [ ] **Step 5: Commit** the two files by name, "feat: Campaigns compares unequal ranges per day and withholds alerts, which need equal exposure".

---

### Task 4: The server and the real exports

**Files:**
- Create: `tests/snapshot/compare-ranges.test.ts`
- Modify: `tests/server/app.test.ts`, `tests/core/different-names.test.ts`

**Interfaces:**
- Consumes: the shipped export in `tests/fixtures/original-export`, the committed `data/extended` (loaded as `tests/snapshot/alerts.test.ts` does), `serverFixture()` from `tests/server/helpers.ts` (2 calls a day for 14 days, one booked $100).
- Produces: nothing for later tasks. No `src/` change: `params.ts` and `app.ts` already pass `compareStart`/`compareEnd` through.

- [ ] **Step 1: Write the tests.**
  `tests/server/app.test.ts`, "a custom range and an explicit comparison" (line ~84): the 3-day range `2026-09-08`..`2026-09-10` against `2026-09-01`..`2026-09-02` is now `available: true`, `perDay: true`, `reason: null`, and `tiles.calls` is `{ current: 6, previous: 4, change: { kind: 'percent', value: 0 } }` (totals would say +50%; per day it is 2 against 2). Keep the outside-the-data case (200, `available: false`). Add: `/api/campaigns` with the same query returns `alerts.checked` false and the per-day reason; `compareStart` alone gives 400 `bad_param` naming `compareEnd`; an inverted compare range gives 400 with `field` `compareStart` or `compareEnd` and a message starting "Comparison range:" (Review Focus 4; the params unit tests already cover the parser, this proves the HTTP shape on a view route).
  `tests/snapshot/compare-ranges.test.ts`, recorded not derived (same style as `tests/snapshot/alerts.test.ts`). Selected range `2026-10-02`..`2026-10-29` (28 days) against `2026-09-08`..`2026-09-14` (7 days), both inside the span `2026-08-31`..`2026-10-29`, via `buildOverview` and `buildCampaigns`:

  | export | calls (now, before) | calls per-day change | bookings (now, before) | bookings change | revenue (now, before) | revenue change |
  | --- | --- | --- | --- | --- | --- | --- |
  | shipped | 2,379, 587 | ≈ +1.320% | 578, 154 | ≈ −6.169% | 210,236, 52,053 | ≈ +0.972% |
  | extended | 3,030, 751 | ≈ +0.866% | 729, 184 | ≈ −0.951% | 268,874, 62,817 | ≈ +7.007% |

  Assert totals exactly and changes with `toBeCloseTo(…, 2)`. Both: unique callers tile has `previous` null and `change` none (shipped 1,317 now; extended 1,640); `notes.comparison` has `perDay: true`, `currentDays: 28`, `previousDays: 7`; `campaigns.alerts.checked` false; no `review_call_changes` action; Overview has three top actions; `expectAllFinite` on both views. Swap the two ranges on the shipped export: calls change ≈ −1.303%, and the 7-day range is not clamped or flagged. A comparison wholly inside the selected range (`2026-10-02`..`2026-10-08` inside the 28 days) is `available`, `overlaps` and `perDay`, with no alerts.
  Locations and Missed calls ignore the second range: on the shipped export `buildLocations` and `buildMissedCalls` return the same view with and without the per-day second range except for `notes`. Compare with `toEqual` after removing `notes` from both.
  `tests/core/different-names.test.ts`: on the different-names export (other names, zones, dates), build Overview and Campaigns for a 7-day range against a 3-day range inside the data; `perDay` is true, the output is finite, and no text contains `undefined` or `NaN`.
- [ ] **Step 2: Run** `npx vitest run tests/server/app.test.ts tests/snapshot/compare-ranges.test.ts tests/core/different-names.test.ts`. Expected: PASS (the code exists from Tasks 1 to 3). If a recorded number differs from the table, stop and tell me; do not adjust it.
- [ ] **Step 3: Commit** the three test files, "test: per-day comparison on both real exports, the different-names export and the API".

---

### Task 5: URL state and the second-range picker

**Files:**
- Modify: `src/web/urlState.ts`, `src/web/components/RangeControl.tsx`, `src/web/App.tsx`
- Test: `tests/web/urlState.test.ts`, `tests/web/render.test.tsx`

**Interfaces:**
- Consumes: `UrlState.compare`, `isIsoDate` (`src/web/format.ts`), `Meta.span`, `ClientError.field`.
- Produces:
  - `withCompare(state: UrlState, compare: { start: string; end: string } | null): UrlState`: sets or clears only `compare`.
  - `customCompare(start: string, end: string): { start: string; end: string } | null`: trims; `null` if either is blank (like `customRange`).
  - `RangeControl` props gain `onCompare(compare: { start: string; end: string } | null): void`.
  - Copy, exact: group label `Comparison range`; inputs `Compare start date`, `Compare end date`; buttons `Compare` and `Use previous period`.

- [ ] **Step 1: Write the failing tests.**
  `urlState.test.ts`: `withCompare` sets `compare` and leaves range, view, campaign, location and dev alone; `withCompare(s, null)` clears it; `withRange` still clears it (existing test stays); `customCompare(' 2026-09-01 ', '2026-09-07')` trims, `customCompare('2026-09-01', '')` and `('', '')` are null; a state with a compare range round-trips through `toSearch` and `parseUrlState` (`?start=…&end=…&compareStart=…&compareEnd=…`); `apiParams` for every one of the four views and `takeawayParams` carry the compare pair (S2 done-when: "every view's changes use the chosen range"); `csvHref` still drops it.
  `render.test.tsx` (render `RangeControl` to a string): both second-range inputs are present with `min` and `max` from `meta.span`; `Use previous period` is absent without a second range and present with one; with `compare` set the inputs hold those dates; Review Focus 4: with `compare: { start: 'banana', end: '' }` both inputs are blank and no raw `banana` is in the output; with `error.field` `compareEnd` and message `Comparison range: the start date is after the end date.` that text appears once beside the control, and with `error.field` `campaign` it does not appear; `Compare` is `disabled` until both inputs hold real dates; no `?dev`-only content.
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/web/urlState.test.ts tests/web/render.test.tsx`. Expected: FAIL on the new tests only.
- [ ] **Step 3: Implement** the two pure functions, then the picker: copy the existing custom-range pattern in `RangeControl` (local input state seeded by `validOrBlank`, re-seeded when the URL changes, Apply-style button built from `customCompare`). `Use previous period` calls `onCompare(null)`. Wire `onCompare` in `App.tsx` with `navigate(withCompare(state, compare))`. No client-side judging of a range: the server's message is shown.
- [ ] **Step 4: Run** `npx vitest run tests/web` and `npm run typecheck`. Expected: PASS. The token guard and contrast tests pass with no change to `tokens.css`.
- [ ] **Step 5: Commit** the files by name, "feat: pick the second date range in the range control, held in the URL".

---

### Task 6: Say which ranges are compared, and say "per day"

**Files:**
- Create: `src/web/models/comparisonLine.ts`
- Modify: `src/web/models/caveats.ts`, `src/web/models/overviewModel.ts`, `src/web/models/campaignsModel.ts`, `src/web/components/OverviewView.tsx`, `src/web/components/CampaignsView.tsx`
- Test: `tests/web/comparisonLine.test.ts`, `tests/web/caveats.test.ts`, `tests/web/overviewModel.test.ts`, `tests/web/campaignsModel.test.ts`, `tests/web/render.test.tsx`, `tests/web/render-campaigns.test.tsx`

**Interfaces:**
- Consumes: `ViewNotes.comparison.{available, previous, perDay, currentDays, previousDays}`, `formatDateSpan`, `formatCount`.
- Produces:
  - `comparisonLine(notes: ViewNotes, range: DateRange): string | null`: null unless `comparison.available` and `previous` is set; else `Comparing ${formatDateSpan(range.start, range.end)} with ${formatDateSpan(previous.start, previous.end)}.`
  - `Caveat['id']` gains `'per_day'`, added last, only when `comparing && available && perDay`. Text, exact: `The two ranges are different lengths (${formatCount(currentDays, ['day','days'])} and ${formatCount(previousDays, ['day','days'])}), so changes in calls, bookings and revenue compare per day. Unique callers are not compared.`
  - `TileModel`: for calls, bookings and revenue when `perDay`: `previous` reads `was ${format(tile.previous)} in ${formatCount(previousDays, ['day','days'])}` and `change.text` ends ` per day` (e.g. `+100.0% per day`). Answer rate unchanged. Unique callers when `perDay`: `unavailable` is `Not compared across different lengths`. Equal-length output is byte-identical to today.
  - Campaigns "Calls vs previous" cell when `view.notes.comparison.perDay`: `+54.1% per day (was 218)`; `new (was 0)` unchanged.

- [ ] **Step 1: Write the failing tests.**
  `comparisonLine.test.ts`: the sentence for an available comparison equals the exact string built from `formatDateSpan`; null when unavailable, when `previous` is null, and for a bad second range. Include a one-day second range (the span prints once, not "Sep 1 – Sep 1").
  `caveats.test.ts`: `per_day` text exact for 28 and 7 days, `1 day` singular for a one-day second range (Review Focus 3), absent for equal length, absent when `comparing` is false, absent when unavailable; Review Focus 1: the second range equal to the selected one gives `overlap` and no `per_day`; Review Focus 2: a second range that includes the last data day gives `previous_last_day`.
  `overviewModel.test.ts` (real builders via `overviewFor`): on `serverFixture()`, `start=2026-09-08&end=2026-09-10&compareStart=2026-09-01&compareEnd=2026-09-02` gives calls tile `value` `6`, `previous` `was 4 in 2 days`, change `{ text: '0.0% per day', tone: 'flat' }`; on a bespoke store with 2 calls a day now and 1 a day before, `+100.0% per day`, tone `up`; unique callers tile `change` null and `unavailable` `Not compared across different lengths`; answer rate tile `change.text` has no `per day`; the equal-length tiles equal today's (the existing tests stay). Update `reasonHeadline` ("gives the two headlines of the real server sentences", lines ~15 to 22): the second sentence no longer exists; assert the headline of the real "No full previous period" sentence (from `range=all`) and of the second-range-outside-the-data sentence, and drop the `No like-for-like` assertions.
  `campaignsModel.test.ts`: the per-day cell text; the same row at equal length has no `per day`; `alertsNote` equals the per-day alerts reason (`!checked` path, via the real builder).
  Render tests: Overview and Campaigns each show the comparison line and the `per_day` caveat exactly once when the comparison is per day; on the default equal-length comparison the line shows and the caveat does not; no `undefined` or `NaN` in the output; a campaign named `<b>x</b>` stays escaped in the per-day cell.
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/web`. Expected: FAIL on new and updated tests only.
- [ ] **Step 3: Implement** `comparisonLine.ts`, the caveat, the two model changes and the two components (the line as a muted paragraph right after `<Caveats>`).
- [ ] **Step 4: Run** `npx vitest run tests/web` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** the files by name, "feat: the screen says which two ranges are compared and when changes are per day".

---

### Task 7: README and the full check

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Add a "Compare any two ranges" subsection to the README (after "Alerts"): how to pick the second range and clear it (the second range is optional and defaults to the same number of days before); that the URL holds it (`compareStart`, `compareEnd`); that it may be before, after, inside or overlapping the selected range, must lie inside the data (otherwise no change, with the reason), and that overlap is allowed with a note; that a second range of another length compares calls, bookings and revenue **per day** and says so; that unique callers are not compared across lengths, with the reason; that Locations and Missed calls ignore the second range; and the known limit (a very short second range makes a noisy per-day figure; a range that is not whole weeks mixes weekdays unevenly). Fix the S1 bullet "Needs a full, equal-length previous period" (line ~113): alerts need two periods **of equal length** that do not overlap; a per-day comparison shows the change column but no alerts.
- [ ] **Step 2:** Run `npm test`, `npm run typecheck`, `npm run build`. Expected: all green. Show me the counts.
- [ ] **Step 3:** Run the checklist below in the browser (`DATA_DIR=data/extended npm start`, then the shipped export) and show me the result.
- [ ] **Step 4: Commit** `README.md` (and any `docs/DECISIONS.md` rows added during the build), "docs: README covers comparing any two ranges".

## Click-through checklist (S2)

On the **shipped** export, Last 28 days, Overview:
- Pick a second range `Sep 8` to `Sep 14` (7 days) and press Compare. The URL gains `compareStart` and `compareEnd`; the line "Comparing Oct 2 – Oct 29, 2026 with Sep 8 – Sep 14, 2026." and the per-day caveat appear.
- Calls shows `2,379`, "was 587 in 7 days", and `+1.3% per day (up)`; Bookings `-6.2% per day (down)`; Revenue `+1.0% per day (up)`; Unique callers shows no change and "Not compared across different lengths"; Answer rate shows points with no "per day".
- Refresh keeps the screen. Back and forward move between the two states.
- "Use previous period" clears only the second range; the range stays, the line now names the 28 days before.
- Change the main range: the second range clears.
Campaigns, same URL: "Calls vs previous" reads `… per day (was N)`; no badges; the note says alerts need two periods of the same length with 28 and 7 days.
Locations and Missed calls: unchanged by the second range.
Second range `Oct 2` to `Oct 29` (the same range): allowed, overlap caveat, changes `0.0%`, no alerts.
Second range after the selected one (custom range Sep 8 to Sep 14, compare Oct 1 to Oct 7): works, equal length so no "per day" caveat, and the comparison line names both ranges so "was N" is not ambiguous.
Type a second range outside the data by hand in the URL (`compareStart=2020-01-01&compareEnd=2020-01-07`): no change shown, the reason "No full previous period…" appears; the page is not blank.
Hand-edit `compareStart` alone, then an inverted pair: the message appears beside the range control, the control stays, inputs hold no garbage.
On the **extended** export, Last 28 days with the default comparison: the S1 alerts and badges are exactly as before.
With AI on and a key, the Overview takeaway with a per-day comparison states no percentage change for calls, bookings or revenue.

## Self-review

- **Spec coverage:** PLAN.md S2 delivers (UI to pick a second range freely): Tasks 5, 6. Done-when (URL holds both ranges, every view's changes use the chosen range, README): Tasks 5 (URL, `apiParams` for every view), 4 and 2 and 3 (views use it), 7. Edge cases: overlap allowed with a note: Tasks 1, 3, 6 (the caveat already exists; tests added); unequal lengths per day with the view saying so: Tasks 1 to 3 (rule), 6 (wording); second range outside the data: Tasks 1, 2, 3, 4, 5.
- **Types:** `perDay` is a `boolean` on both `RangeComparison` and `ViewNotes.comparison`; `currentDays: number` and `previousDays: number | null` are read by name in Tasks 3, 6; `changeInCountPerDay(current, currentDays, previous, previousDays)` has one argument order in Tasks 1 to 3; `withCompare` and `customCompare` use `{ start: string; end: string } | null`, the same shape as `UrlState.compare`.
- **Tests I will have to update** (each named in its task): `comparison.test.ts` (80), `errors.test.ts` (139), `viewContext.test.ts` (64), `overviewView.test.ts` (134), `campaignsView.test.ts` (328), `app.test.ts` (87 to 93), `overviewModel.test.ts` (15 to 22).
- **Open for your review:** Gaps 1 to 4 (all approved), the pending wording changes to `PLAN.md` and `CLAUDE.md`, and the recorded numbers in Task 4, which I probed on both exports and have not yet asserted in code.
