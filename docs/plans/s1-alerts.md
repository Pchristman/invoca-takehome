# Phase S1 (Alerts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flag campaigns whose calls jumped or dropped against the comparison range by more than chance explains, and show the flags in the Campaigns table and in Overview's top actions.

**Architecture:** A pure two-period count test (`countAlert`) in the data core, using the equal-length comparison the views already resolve. `buildCampaigns` adds, per campaign, the previous calls, the change and an optional alert, plus one alert action; `buildOverview` surfaces that action. The server passes the view JSON through unchanged. The web app gains one table column, two badges and two notes, all decided in the pure models.

**Tech Stack:** TypeScript (strict), vitest, React with `react-dom/server` render tests. Nothing new to install.

**Spec:** `PLAN.md` (section 3.2 comparison, 4.1 Overview, 4.2 Campaigns, 4.5 thresholds, section 5 data rules, "S1: Alerts" in section 9), `docs/BRIEF.md` (stretch goal 1), `CLAUDE.md`, `docs/plans/05-view-builders.md` and `07-ui-part-one.md` (the code this extends), `src/core/views/campaignsView.ts`, `src/core/views/overviewView.ts`, `src/core/comparison.ts`.

## Global Constraints

- Work **one task at a time**. After the last task run `npm test`, `npm run typecheck` and `npm run build`, run the click-through checklist at the end of this file, show the results, then **stop** and wait (CLAUDE.md).
- **No new dependency.** If one seems needed, stop and ask.
- S1 done-when, from PLAN.md: fixture tests cover jump, drop, no change and too-small counts; the README covers what this phase added.
- **Every number the user sees comes from code.** Counts, changes and thresholds come from the view builders and `THRESHOLDS`; the browser formats them with `src/core/views/format.ts` and computes no metric. A model never sees or makes an alert.
- Comparisons use periods of equal length only. Alerts exist only when `notes.comparison.available` is true; never test counts from ranges of different lengths.
- The app works with AI off. Alerts are computed in code; the AI paragraph change (Task 6) only affects wording.
- Nothing hard-coded to this dataset: no campaign or office names, ids or dates in `src/`. Tests may name `cmp_04` and friends. `tests/core/different-names.test.ts` scans `src/` and `index.html`.
- Names from the data are shown as text only, never as markup, and are never re-scanned for `{placeholders}`.
- No raw colour or duration literals outside `src/web/styles/tokens.css` (the Phase 7 guard). This phase adds **no** token: the new badges reuse the colours of the existing up/down tones. Meaning is never colour alone: badges and cells carry words and signs.
- Never read, print or `git add` `.env`. Do not write to `docs/AI_COST_LOG.md` or edit `docs/BRIEF.md`. **Stage files by name, never `git add -A`**, and never stage `PLAN.md`, `docs/AI_COST_LOG.md` or `docs/BRIEF.md` (run `git status` first; if you have uncommitted work there, it stays yours). PLAN.md already has the S1 edits (4.1, 4.5 table, S1 section); this plan does not touch it.
- Commit after each task, small, message says why, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Prefer simple, readable code; a reviewer will walk through all of it.

## Gaps in PLAN.md this plan fills

PLAN.md's S1 is four lines. Items 1 to 3 are real decisions (approved, in `docs/DECISIONS.md`); 4 and 5 are details.

1. **Overview's top actions are "one per view, three in fixed order" (PLAN.md 4.1), but S1 says alerts appear there.** Decision: when the Campaigns view has an alert action, Overview lists it as an extra entry **right after the Campaigns entry** (labelled Campaigns, linking to Campaigns), so the list has three or four entries. If the alert is already Campaigns' headline, it is not listed twice. PLAN.md 4.1 now says so.
2. **Two thresholds join section 4.5's table** (now in PLAN.md): `ALERT_Z` = 3 and `MIN_CALLS_ALERT` = 20, in `src/core/thresholds.ts`. 3 rather than the 2.5 used for offices because about 12 campaigns are tested at once: at 2.5 there is roughly a 1-in-7 chance that some campaign is flagged by luck alone; at 3 about 1 in 30. Probed on the shipped export, no campaign reaches |z| 2 (largest 1.79); on the extended export the two planted patterns score +5.2 and −7.7 and nothing else passes 1.7. So both defaults separate real from noise on the data we have.
3. **"Minimum count" is undefined.** Decision: a campaign is tested when its calls in the two periods **added together** reach `MIN_CALLS_ALERT`. This also makes "0 calls in one period" work with no special case: 0 against 25 is a drop to zero; 25 against 0 is a jump from zero.
4. **The test.** Two-sample Poisson on counts with equal exposure: `z = (current − previous) / √(current + previous)`. Flag when `|z| >= ALERT_Z` and the campaign is eligible. Positive is a jump, negative a drop. Known limits (README and, later, TECHNICAL.md): repeat callers make counts clumpier than Poisson, so the test is optimistic; a range that is not a whole number of weeks compares unequal weekday mixes.
5. **Unattributed never alerts.** It is a bucket, not a campaign, and "Fix attribution" already covers it. Its row still shows its change.

## Review Focus

Inputs the spec implies but no listed edge case names. Each has a test in the owning task.

1. **Every campaign flagged at once** (an outage, or a partial last week): one alert sentence with the count and the single biggest mover, not twelve lines; the fact sheet stays small (one name). (Task 2)
2. **A campaign named like markup or like a placeholder** (`<b>Spring</b>`, `{alert.count}`, 300 characters, no spaces): the sentence holds the name as plain text, `{alert.count}` is not expanded, the table wraps it. (Tasks 2, 5)
3. **Unattributed doubling**: its row shows the change, but it is never flagged and never counted in "N campaigns changed". (Task 2)
4. **Two campaigns tied on |z|, or the store listing campaigns in another order**: the headline mover is the lower campaign id, the same every time. (Task 2)
5. **Garbage into the test** (NaN, a negative, 2.5 calls, Infinity): not eligible, no flag, no NaN in any output. (Task 1)

---

## File Structure

```
src/core/thresholds.ts                  (modify) ALERT_Z, MIN_CALLS_ALERT
src/core/alerts.ts                      poissonZ, countAlert
src/core/views/facts.ts                 (modify) ActionKind gains 'review_call_changes' (actionable)
src/core/views/campaignAlerts.ts        alertAction, FlaggedCampaign (the sentence and its facts)
src/core/views/campaignsView.ts         (modify) per-row previousCalls, callsChange, alert; view.alerts; alert action
src/core/views/overviewView.ts          (modify) the extra top-action entry
src/core/views/index.ts                 (modify) export the new types
src/web/models/changeModel.ts           changeModel, Tone (moved out of overviewModel.ts)
src/web/models/overviewModel.ts         (modify) imports changeModel; re-exports Tone
src/web/models/campaignsModel.ts        (modify) callsChange column, jump/drop marks, alertsNote, alertsRule
src/web/components/CampaignTable.tsx    (modify) two badges
src/web/components/CampaignsView.tsx    (modify) the note and the "How alerts are decided" details
src/web/styles/base.css                 (modify) .badge-jump, .badge-drop (existing tokens only)
src/ai/prompt.ts                        (modify, Task 6) one sentence, PROMPT_VERSION '2'
README.md                               (modify) what S1 added
docs/DECISIONS.md                       (modify, done with this plan)
tests/core/alerts.test.ts               countAlert table
tests/core/views/campaignAlerts.test.ts the sentence
tests/core/views/campaignsView.test.ts  (modify) per-row and view-level alerts
tests/core/views/overviewView.test.ts   (modify) the extra entry
tests/core/different-names.test.ts      (modify) alerts on the different-names export
tests/snapshot/alerts.test.ts           both real exports
tests/server/endpoints.test.ts          (modify) alerts in the JSON
tests/web/campaignsModel.test.ts, render-campaigns.test.tsx, render.test.tsx, overviewModel.test.ts  (modify)
tests/ai/prompt.test.ts, checker.test.ts (modify, Task 6)
```

---

### Task 1: The test and its thresholds

**Files:**
- Modify: `src/core/thresholds.ts`
- Create: `src/core/alerts.ts`
- Test: `tests/core/alerts.test.ts`

**Interfaces:**
- Consumes: `THRESHOLDS` from `src/core/thresholds.ts`.
- Produces:
  - `THRESHOLDS.ALERT_Z: number` (3) and `THRESHOLDS.MIN_CALLS_ALERT: number` (20), documented like the others in `Thresholds`.
  - `poissonZ(current: number, previous: number): number | null`
  - `interface AlertOptions { z?: number; minCalls?: number }`
  - `interface CountAlert { eligible: boolean; z: number | null; flagged: boolean; direction: 'jump' | 'drop' | null }`
  - `countAlert(current: number, previous: number, options?: AlertOptions): CountAlert`

- [ ] **Step 1: Write the failing tests** in `tests/core/alerts.test.ts`. Table-driven `countAlert(current, previous)` with defaults (z 3, minCalls 20); each row asserts `{eligible, flagged, direction}` and `z` (`toBeCloseTo(…, 3)`, or `null`):

  | case | current, previous | eligible | flagged | direction | z |
  | --- | --- | --- | --- | --- | --- |
  | jump | 342, 218 | true | true | jump | 5.240 |
  | drop | 113, 261 | true | true | drop | −7.653 |
  | no change | 100, 100 | true | false | null | 0 |
  | exactly at threshold | 27, 9 | true | true | jump | 3 |
  | just under | 26, 10 | true | false | null | 2.667 |
  | exactly the minimum | 20, 0 | true | true | jump | 4.472 |
  | one under the minimum (would flag if tested) | 19, 0 | false | false | null | null |
  | too small | 10, 0 | false | false | null | null |
  | drop to zero | 0, 20 | true | true | drop | −4.472 |
  | both zero | 0, 0 | false | false | null | null |

  Further tests: `poissonZ(0, 0)` is `null`; every one of `(NaN, 10)`, `(10, −1)`, `(2.5, 30)`, `(Infinity, 30)` gives `eligible: false`, `z: null`, `flagged: false` from `countAlert` and `null` from `poissonZ` (Review Focus 5); `countAlert(10, 0, { z: 2, minCalls: 5 })` is flagged (options override the defaults); `minCalls: 0` still leaves `(0, 0)` ineligible; `THRESHOLDS.ALERT_Z` is 3 and `THRESHOLDS.MIN_CALLS_ALERT` is 20.

- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/core/alerts.test.ts`. Expected: FAIL, `countAlert` not exported.

- [ ] **Step 3: Implement.** Add the two thresholds to `Thresholds` and `THRESHOLDS`. In `src/core/alerts.ts` write `poissonZ` (`null` unless both are finite integers ≥ 0 and the sum is above 0; else `(current − previous) / Math.sqrt(current + previous)`) and `countAlert`, mirroring `officeOutlier` in `src/core/ranking.ts`: eligible when both counts are valid and `current + previous >= Math.max(minCalls, 1)`; `z` is `null` when not eligible; flagged when `|z| >= threshold`; direction from the sign. A comment states that the caller guarantees equal-length periods.

- [ ] **Step 4: Run to verify they pass.** Run: `npx vitest run tests/core/alerts.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** `src/core/thresholds.ts src/core/alerts.ts tests/core/alerts.test.ts docs/DECISIONS.md` with "feat: two-period count test for call alerts, so a jump or drop is flagged only when chance does not explain it".

---

### Task 2: Campaigns view carries the alerts

**Files:**
- Modify: `src/core/views/facts.ts`, `src/core/views/campaignsView.ts`, `src/core/views/index.ts`
- Create: `src/core/views/campaignAlerts.ts`
- Test: `tests/core/views/campaignAlerts.test.ts`, `tests/core/views/campaignsView.test.ts`

**Interfaces:**
- Consumes: `countAlert` (Task 1); `changeInCount`, `Change` from `src/core/metrics.ts`; `makeAction` and `Facts` from `facts.ts`; `context.previous` and `context.notes.comparison` from `makeViewContext`.
- Produces:
  - `ActionKind` gains `'review_call_changes'`, added to `ACTIONABLE`.
  - `interface FlaggedCampaign { campaignId: string; name: string; direction: 'jump' | 'drop'; z: number; current: number; previous: number }`
  - `alertAction(flagged: readonly FlaggedCampaign[]): Action | null`: `null` when empty. Sorts a copy by `|z|` descending, ties by lower `campaignId` (plain character order), and describes the first. Link `{ view: 'campaigns' }`. Facts: `alert.count` (`count`, noun `['campaign', 'campaigns']`), `alert.top.name` (`name`), `alert.top.previous` (`count`, no noun), `alert.top.current` (`count`, noun `['call', 'calls']`). Templates, exact:
    - one jump: `Calls to {alert.top.name} jumped from {alert.top.previous} to {alert.top.current}, more than chance explains. Find out what changed and whether to keep it going.`
    - one drop: `Calls to {alert.top.name} dropped from {alert.top.previous} to {alert.top.current}, more than chance explains. Check that its tracking numbers, ads and budget are still running.`
    - two or more: `{alert.count} changed by more than chance explains; {alert.top.name} moved most, from {alert.top.previous} to {alert.top.current}. Review each flagged campaign in the table.`
  - On `CampaignRow`: `previousCalls: number | null` (null when no comparison), `callsChange: Change` (`{ kind: 'none' }` when no comparison), `alert: CampaignAlert | null` where `interface CampaignAlert { direction: 'jump' | 'drop'; z: number }`. `UnattributedRow` gets the first two filled like any row and `alert: null` always.
  - On `CampaignsView`: `alerts: { checked: boolean; reason: string | null; flagged: number; z: number; minCalls: number }`. `checked` is `notes.comparison.available`; `reason` is `notes.comparison.reason` when not checked, else `null`; `flagged` counts flagged real campaigns; `z` and `minCalls` are the thresholds in force.
  - `view.actions` order: shift budget, fix attribution, call changes. The "no budget shift" fallback is still added only when nothing else is, exactly as now (the alert action counts as something).

- [ ] **Step 1: Write the failing tests.** Fixture for `campaignsView.test.ts`: current range `range('2026-09-08', '2026-09-14')`, previous `2026-09-01` to `2026-09-07`; a helper that adds `n` calls for a campaign on a date; one anchor call on `2026-09-01` and one on `2026-09-14` for an extra campaign `cmp_z` so the data span covers both ranges (its 1-and-1 counts are too small to flag).
  1. `flags a jump and a drop and leaves the rest alone`: `cmp_a` 60 now / 30 before, `cmp_b` 20 / 60, `cmp_c` 50 / 50. `cmp_a.alert` is `{ direction: 'jump', z: ≈3.162 }`, `cmp_b.alert` direction `drop`, `cmp_c.alert` is `null`; `cmp_a.previousCalls` 30, `callsChange` `{ kind: 'percent', value: 100 }`; `cmp_b.callsChange.value` ≈ −66.67; `alerts` is `{ checked: true, reason: null, flagged: 2, z: 3, minCalls: 20 }`.
  2. `no change`: all campaigns flat → every `alert` null, `alerts.flagged` 0, no action of kind `review_call_changes`.
  3. `too small to test`: a campaign with 10 now / 0 before has `previousCalls` 0, `callsChange` `{ kind: 'new' }`, `alert` null.
  4. `zero in one period`: 0 now / 25 before is a `drop` with `callsChange` `{ kind: 'percent', value: −100 }`; 25 now / 0 before is a `jump` with `{ kind: 'new' }`. No NaN or Infinity anywhere (`expectAllFinite` from `fixtures.ts`).
  5. `all-data range has no comparison`: the whole span as range → `alerts` is `{ checked: false, reason: <starts "No full previous period">, flagged: 0, … }`, every row `alert` null, `previousCalls` null, `callsChange` `{ kind: 'none' }`, no alert action.
  6. `a custom previous range of another length`: `previous` 3 days against 7 → `checked: false`, reason starts "No like-for-like comparison".
  7. `unattributed never alerts` (Review Focus 3): 60 now / 10 before on no campaign → `unattributed.alert` null, `unattributed.callsChange` percent 500, and `alerts.flagged` does not count it.
  8. `every campaign dropped` (Review Focus 1): twelve campaigns, 10 now / 40 before → `alerts.flagged` 12; exactly one alert action; its text starts "12 campaigns changed"; `factSheet.entities` holds one name; `actions` order is shift (if any), attribution (if any), then the alert.
  9. `alert is the headline when nothing else is actionable`: with fewer than two eligible campaigns and a flagged one, `actions[0].kind` is `review_call_changes` and `bestWorst.reason` is still set.
  10. `store order does not change the answer` (Review Focus 4): two campaigns with the same counts (so equal |z|), the store listing them in either order → the same `actions[0].text`, naming the lower id.
  11. `a name that looks like markup or a placeholder` (Review Focus 2): campaign name `{alert.count}<b>x</b>` flagged alone → `actions[0].text` contains that name verbatim and no expanded count; `fillPlaceholders` did not throw.

  In `campaignAlerts.test.ts`: `alertAction([])` is `null`; the three templates give exactly these texts for `Alpha` 30→60 (jump), `Alpha` 60→20 (drop), and two flagged where `Beta` (|z| larger) leads: `2 campaigns changed by more than chance explains; Beta moved most, from 60 to 20 calls. Review each flagged campaign in the table.`; `alertAction(x)` is unchanged when `x` is passed reversed; the action is `actionable: true` and links to `{ view: 'campaigns' }`; singular noun: previous 0, current 1 reads "from 0 to 1 call" (use `{ z: 3.5 }` for the fixture, as the function does not re-test).

- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/core/views/campaignAlerts.test.ts tests/core/views/campaignsView.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `alertAction`** in `src/core/views/campaignAlerts.ts` per the Interfaces block (constants for the three templates, as `campaignsView.ts` does for its own).

- [ ] **Step 4: Wire `buildCampaigns`.** For each store campaign: `previousCalls` is the count of `context.previous` calls with that `campaignId` (null when `context.previous` is null); `callsChange` is `changeInCount(calls, previousCalls)`; `alert` comes from `countAlert(calls, previousCalls)`. Build `FlaggedCampaign`s from flagged rows, call `alertAction`, append it after the attribution action. Add `view.alerts`. Add the three new row fields to `buildUnattributed`. Export the new types from `index.ts`.

- [ ] **Step 5: Run the whole core suite.** Run: `npx vitest run tests/core`. Expected: PASS. A pre-existing test that fails only because rows now carry three more fields (an exact `toEqual` on a row) gets the new fields added to its expectation; any other failure is a real problem, stop and tell me.

- [ ] **Step 6: Commit** the files above by name, "feat: Campaigns view reports each campaign's change and flags jumps and drops, so the marketer sees what moved".

---

### Task 3: Overview lists the alert

**Files:**
- Modify: `src/core/views/overviewView.ts`
- Test: `tests/core/views/overviewView.test.ts`

**Interfaces:**
- Consumes: `CampaignsView.actions` and `ActionKind 'review_call_changes'` (Task 2).
- Produces: `OverviewView.topActions` is Campaigns' first action, then (if it exists and is not that same action) Campaigns' `review_call_changes` action as `{ view: 'campaigns', action }`, then Locations' first, then Missed calls' first. Update the doc comment on `topActions`. `actions` stays `topActions.map(t => t.action)`; the fact sheet merges every listed action's facts as now.

- [ ] **Step 1: Write the failing tests.**
  1. `alert beside a shift`: a fixture where Campaigns suggests a shift and one campaign is flagged → `topActions.map(t => t.view)` is `['campaigns', 'campaigns', 'locations', 'missed-calls']`, kinds `['shift_budget', 'review_call_changes', …]`.
  2. `alert is the Campaigns headline`: no shift possible, one flagged → three entries, `topActions[0].action.kind` is `review_call_changes`, listed once.
  3. `no alert`: the existing fixtures still give exactly `['campaigns', 'locations', 'missed-calls']` (the current assertions stay as they are).
  4. `comparison unavailable` (all data): three entries, no `review_call_changes`.
  5. `fact sheet`: with an alert, `factSheet.facts` has `alert.count` and `alert.top.name`, and `factSheet.entities` includes that campaign name.
  6. `headline`: `templateSentence` is still the first actionable top action (the shift when there is one).

- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/core/views/overviewView.test.ts`. Expected: FAIL on tests 1, 2, 5.

- [ ] **Step 3: Implement** in `buildOverview`: build Campaigns once (it is already built; reuse the value instead of calling `buildCampaigns` twice), find the alert action by `kind`, insert as specified.

- [ ] **Step 4: Run** `npx vitest run tests/core tests/web`. Expected: PASS. Fix only tests that assumed three entries on a fixture that now flags something, and say which.

- [ ] **Step 5: Commit** "feat: Overview top actions include the campaign call-change alert, as PLAN.md S1 asks".

---

### Task 4: Real exports, hard-coding guard and the server

**Files:**
- Create: `tests/snapshot/alerts.test.ts`
- Modify: `tests/core/different-names.test.ts`, `tests/server/endpoints.test.ts`

**Interfaces:**
- Consumes: the shipped export in `tests/fixtures/original-export`, the committed seed in `data/extended` (loaded as `tests/snapshot/extended-export-views.test.ts` does), `serverFixture()` from `tests/server/helpers.ts`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the tests.** In `tests/snapshot/alerts.test.ts`, recorded not derived (same style as `OBSERVED` in the neighbouring snapshot files):
  - Shipped export, `last7` and `last28`: `alerts.checked` true, `alerts.flagged` 0, no `review_call_changes` action, Overview has three top actions. `all`: `checked` false.
  - Extended export, `last28`: `alerts.flagged` 2; `cmp_06.alert.direction` is `drop` (113 against 261), `cmp_04.alert.direction` is `jump` (342 against 218); the action text starts "2 campaigns changed" and names the `cmp_06` campaign (look the name up from the store, do not type it); Overview has four top actions with `topActions[1].action.kind === 'review_call_changes'`. `last7`: `flagged` 0. `all`: `checked` false.
  - `expectAllFinite` on every view built.
  In `different-names.test.ts`: on the export with entirely different names and dates, give one campaign a clear jump between two equal ranges and check `buildCampaigns` flags it and `buildOverview` lists the alert with the new name in its text.
  In `endpoints.test.ts`: `GET /api/campaigns?range=last7` on `serverFixture()` (7 calls against 7 per campaign) returns `alerts` `{ checked: true, reason: null, flagged: 0, z: 3, minCalls: 20 }` and rows with `previousCalls` 7 and `alert` null; `?range=all` returns `checked: false` and a reason starting "No full previous period".

- [ ] **Step 2: Run** `npx vitest run tests/snapshot/alerts.test.ts tests/core/different-names.test.ts tests/server/endpoints.test.ts`. Expected: PASS (the code exists from Tasks 1 to 3). If a recorded number differs from the ones above, stop and tell me; do not adjust it.

- [ ] **Step 3: Commit** the three test files, "test: alerts on both real exports, the different-names export and the API".

---

### Task 5: The Campaigns table and notes

**Files:**
- Create: `src/web/models/changeModel.ts`
- Modify: `src/web/models/overviewModel.ts`, `src/web/models/campaignsModel.ts`, `src/web/components/CampaignTable.tsx`, `src/web/components/CampaignsView.tsx`, `src/web/styles/base.css`
- Test: `tests/web/overviewModel.test.ts`, `tests/web/campaignsModel.test.ts`, `tests/web/render-campaigns.test.tsx`, `tests/web/render.test.tsx`

**Interfaces:**
- Consumes: `CampaignRow.previousCalls | callsChange | alert` and `CampaignsView.alerts` (Task 2); `reasonHeadline` and `BLANK`.
- Produces:
  - `changeModel(change: Change): { text: string; tone: Tone } | null` and `type Tone`, moved unchanged from `overviewModel.ts`; `overviewModel.ts` imports it and re-exports `Tone` so `OverviewView.tsx` is untouched.
  - `SortKey` gains `'callsChange'`; `COLUMNS` gains `{ key: 'callsChange', label: 'Calls vs previous', numeric: true, estimate: false }` right after `calls`. Its cell: no previous (`previousCalls === null`) → `{ text: BLANK, note: view.alerts.reason ?? 'No previous period.' }`; change `none` → `{ text: BLANK, note: 'No calls in either period.' }`; percent → `"+54.1% (was 218)"` (the `changeModel` text, then `was` and `formatCount(previousCalls)`); new → `"new (was 0)"`. Sort value: the percent value; `new` is `Number.MAX_VALUE`; blanks are `null` (sort last, as everywhere).
  - `Mark = 'best' | 'worst' | 'jump' | 'drop'`; `marksFor` appends `jump` or `drop` from `row.alert`.
  - `CampaignsModel.alertsNote: string | null`: `view.alerts.reason` when not checked; `"No campaign's calls changed by more than chance explains."` when checked with `flagged` 0; else `null`.
  - `CampaignsModel.alertsRule: string | null`: `null` when not checked; else `"A campaign is marked when its calls differ from the previous period by more than chance explains. Campaigns with fewer than ${formatCount(minCalls)} calls across both periods are not tested. Score = (calls now − calls before) ÷ √(calls now + calls before); marked when the score reaches ${formatCount(z)} in either direction."`
  - Badge text: `Calls jumped`, `Calls dropped`.

- [ ] **Step 1: Write the failing tests.**
  - `overviewModel.test.ts` unchanged and still green after the move (run it first as the safety net); add: an Overview view with an alert entry gives four `topActions` rows, the second with `viewLabel` `Campaigns` and the alert text.
  - `campaignsModel.test.ts`: the `callsChange` column cell texts above; a row with `alert.direction` `drop` has `marks` `['drop']`, and `['worst', 'drop']` when also worst; sorting by `callsChange` descending puts `new` first, then percents high to low, blanks last, ties by id; sorting twice with two `new` rows does not produce NaN order; `alertsNote` for all three cases; `alertsRule` is `null` when not checked and contains `20` and `3` from the view's `alerts` (use `minCalls: 25, z: 4` in a second case to prove the numbers are not hard-coded); a name of 300 characters with no spaces is passed through whole.
  - `render-campaigns.test.tsx` (render to string): a flagged row shows "Calls dropped" (and the word, not just a colour class); an unavailable comparison shows `—` in the column, the reason in the visually hidden note, and the `alertsNote`; the details block "How alerts are decided" holds `alertsRule`; a campaign named `<b>x</b>` appears escaped in the new column's row and badge; no `?dev`-only content appears.
  - `render.test.tsx` line ~325: keep its three-entry assertion on its fixture; add an Overview render with an alert entry showing the alert text once and an "Open Campaigns" link for it, together with the incomplete-day caveat when the view's notes say the last day is included (alerts never appear without the caveat that qualifies them).

- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/web`. Expected: FAIL on the new tests only.

- [ ] **Step 3: Move `changeModel`** into `changeModel.ts`; run `npx vitest run tests/web/overviewModel.test.ts`. Expected: PASS before anything else changes.

- [ ] **Step 4: Implement the model changes** per the Interfaces block in `campaignsModel.ts`, then `CampaignTable.tsx` (badge labels) and `CampaignsView.tsx` (the muted note under the table, the `<details>` with `alertsRule`; both only when non-null). In `base.css` add `.badge-jump` and `.badge-drop` using the same custom properties `.tone-up` and `.tone-down` already use; no new colour.

- [ ] **Step 5: Run** `npx vitest run tests/web` and `npm run typecheck`. Expected: PASS. The token guard and contrast tests must pass without a change to `tokens.css`.

- [ ] **Step 6: Commit** the files by name, "feat: Campaigns table shows each campaign's change against the previous period and marks jumps and drops".

---

### Task 6: Tell the takeaway about alerts (approved)

**Files:**
- Modify: `src/ai/prompt.ts`
- Test: `tests/ai/prompt.test.ts`, `tests/ai/checker.test.ts`

**Interfaces:**
- Consumes: the alert fact keys from Task 2.
- Produces: `PROMPT_VERSION` is `'2'`; the `overview` and `campaigns` paragraphs each end with: `If calls to a campaign jumped or dropped by more than chance explains, name that campaign and suggest finding out what changed.`

Without this task the cache stays correct (the key hashes the fact sheet) and the checker is unaffected, but the model has no instruction about the new keys and may ignore or misuse them.

- [ ] **Step 1: Write the failing tests.** `PROMPT_VERSION` is `'2'` (update line 23 of `prompt.test.ts`); the system text for `overview` and `campaigns` contains `jumped or dropped`, and for `locations` and `missed-calls` does not; `buildPrompt` of a campaigns sheet with the alert facts puts `alert.top.name` and `alert.count` in the user block with their formatted values. In `checker.test.ts`, with the existing helper for building a sheet: text `{alert.top.name} calls moved most, so find out what changed.` passes, and the same text naming another loaded campaign that is not on the sheet fails with the off-sheet-name reason.
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/ai`. Expected: FAIL.
- [ ] **Step 3: Implement** the sentence and the version bump.
- [ ] **Step 4: Run** `npx vitest run tests/ai`. Expected: PASS. No test calls the real API.
- [ ] **Step 5: Commit** "feat: takeaway prompt knows about call-change alerts; prompt version 2 so old cached text is not reused".

---

### Task 7: README and the full check

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Add an "Alerts" subsection to the README (after "Web app", before "AI takeaways"): what is flagged and where (Campaigns column and badges, Overview top actions); the two settings and their defaults, where they live (`src/core/thresholds.ts`), and why 3 and 20; that alerts need a full equal-length previous period and say why when there is none; Unattributed is never flagged; and the known limits (repeat callers make the test optimistic; a range that is not whole weeks compares unequal weekday mixes; a partly complete first or last day is caveated, not corrected).
- [ ] **Step 2:** Run `npm test`, `npm run typecheck`, `npm run build`. Expected: all green. Show me the counts.
- [ ] **Step 3:** Run the checklist below in the browser (`DATA_DIR=data/extended npm start`, then the shipped export), and show me the result.
- [ ] **Step 4: Commit** `README.md` (and any `docs/DECISIONS.md` rows added during the build), "docs: README covers call-change alerts".

## Click-through checklist (S1)

On the **extended** export (`DATA_DIR=data/extended npm start`), range Last 28 days:
- Overview lists a second Campaigns entry about the two flagged campaigns, linking to Campaigns.
- Campaigns shows a "Calls vs previous" column for every campaign; one row has "Calls jumped" with a `+` change, one "Calls dropped" with a `-` change, each with "(was N)".
- Sorting by "Calls vs previous" works both ways; blanks stay last.
- "How alerts are decided" opens and shows the 3 and the 20.
Same data, Last 7 days: no badges; the note says no campaign's calls changed by more than chance.
Same data, All data: the column is blank with the reason on hover or in the hidden text; no badges; Overview has three entries; no stray "undefined" or "NaN".
On the **shipped** export, Last 28 days: no badges, the quiet note appears, Overview has three entries.
A custom range with a custom comparison of another length (if the URL allows it): no alerts, the reason shown.
Refresh keeps the screen. With AI on and a key, a takeaway on Campaigns for the extended export mentions the changed campaign by name (Task 6 only).

## Self-review

- **Spec coverage:** PLAN.md S1 delivers (flag, Poisson-style test, config threshold and minimum, Overview top actions, Campaigns table): Tasks 1, 2, 3, 5. Done-when (jump, drop, no change, too small; README): Tasks 1, 2, 7. Edge cases (comparison not available, zero in one period): Task 2 tests 4 to 6, plus Task 4 snapshots.
- **Types:** `CountAlert.direction`, `CampaignAlert.direction` and `FlaggedCampaign.direction` are all `'jump' | 'drop'`; `review_call_changes` is the one action kind used in Tasks 2, 3, 4, 5, 6; `alerts.{checked, reason, flagged, z, minCalls}` is read by name in Tasks 4 and 5.
- **Open for your review:** Gaps 1 to 3 and Task 6; PLAN.md edits for 4.1 and the 4.5 table, which I did not make.
