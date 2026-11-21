# Phase 5 (View builders) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four pure functions, one per view, each taking `(store, range, previous?, options?)` and returning the view's data, a fact sheet and a template action sentence, with no I/O and no AI.

**Architecture:** Phase 3's metric functions do the arithmetic; the builders only select, group and assemble. Every action is a template string with `{key}` placeholders plus a flat `facts` record; one function fills the placeholders, so Phase 9's AI text and checker can read exactly the same facts. A small shared context resolves the comparison once and carries the inline caveats (PLAN.md 3.3) that every view returns.

**Tech Stack:** Node 24, TypeScript (strict), vitest. Nothing new.

**Spec:** `PLAN.md` (sections 3.2, 3.3, 4.1-4.5, 5 rules 4, 6-10, Phase 5 in section 9), `docs/BRIEF.md`, `CLAUDE.md`, `docs/plans/03-ranges-and-metrics.md` and `docs/plans/02-clean.md` for the functions and types this consumes.

## Global Constraints

- Work **one task at a time**. After the last task run `npm test` and `npm run typecheck`, show the output, then **stop** and wait (CLAUDE.md).
- **No new dependencies.** Ask first if one seems needed.
- Phase 5 done-when, verbatim from PLAN.md: "each view's fixture test produces the expected action, and the different-names fixture builds every view."
- Every number comes from code. No function here returns `NaN` or `Infinity`; every view builds on an empty range and on a store with no calls. (CLAUDE.md)
- AI is not involved in this phase. No model call, no `.env` read.
- Nothing hard-coded to this dataset: no campaign, office, channel-to-campaign, tracking-number or date literals in `src/`. `tests/core/different-names.test.ts` scans `src/` recursively, so **comments and examples in `src/core/views/` must write `YYYY-MM-DD`, never a real date**. (rule 11)
- Thresholds come from `THRESHOLDS` in `src/core/thresholds.ts`; never repeat a threshold as a literal in a sentence. The sentence reads it from a fact.
- Revenue counts on booked calls only; "unanswered" means `answered` is false (PLAN.md 4.4); an answered call with no outcome counts as answered.
- Spend is `daily_budget_usd` x `range.days` and is always an estimate; cost per booking and revenue per budget dollar are blank (`null`), never infinity. (rule 8)
- Never read, print or `git add` `.env`. Do not write to `docs/AI_COST_LOG.md` (it has uncommitted edits of yours; leave them) or edit `docs/BRIEF.md`.
- Commit after each task, small, message says why, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stage files by name, never `git add -A`.
- Prefer simple, readable code; a reviewer will walk through all of it.

## Issues found in PLAN.md (decide before or during review)

Each is proposed in `docs/DECISIONS.md` (rows dated 2026-11-19, "Phase 5 (proposed ...)") and needs your yes or no.

1. **Two worse-flagged offices.** PLAN.md 4.3 gives one sentence per flag type. The extended data has two worse flags (Canyon on answer rate, Riverside on booking rate). Proposed: Locations returns one action, for the largest \|z\|; all flags stay on their rows.
2. **A "better" flag.** PLAN.md lists the case as an edge case but gives no result. Proposed: it marks the row and makes no action; with only better flags the action says no office is doing worse. (The extended data produces two such flags, see Phase 4's decision.)
3. **Plural wording.** "{n} calls", "these {n} callers" and "Assign them" are wrong for 1. Proposed: counts carry their noun, and two sentences are reworded (see the decision row).
4. **Overview's own sentence.** The Overview's action is "the top actions list itself", but the phase also asks every view for a template sentence. Proposed: the first actionable top action's text.
5. **"Busiest missed slot" needs three dimensions** (office, weekday, hour) while the heatmap shows two at a time. Proposed: computed separately from the heatmap.
6. **Callback list when a view is filtered by office.** The Locations action links to "Missed calls filtered to that office". Proposed: the filter limits which misses count; a caller who got through anywhere is still left out.
7. **Where "Unattributed" sorts** and **what an unknown campaign or office id does** are not stated. Proposed: Unattributed is its own row after the ranked ones; unknown ids give an empty chart or an empty view (Phase 6 returns the 400).

## Review Focus

Inputs the spec implies but no listed edge case names. Each has a test in the owning task.

1. **An unanswered call with no caller hash** can't be called back and must not merge with other blank hashes. It still counts toward lost value and the heatmap. (Task 5)
2. **An unknown `campaignId` or `locationId` option** builds an empty chart or an empty view with the office name `null`; it neither throws nor falls back to "all offices". (Tasks 3, 6)
3. **A bad, inverted or unequal-length second range** gives a view with no comparison and the reason, with no `NaN` in a tile. (Tasks 2, 7)
4. **A store with no calls, and a campaign or office with no calls in range**, still appears (zero row), and every action is a "none" action. (Tasks 2, 3, 4, 6, 7)
5. **A count of exactly 1** reads "1 call", "1 caller", "1 tracking number"; and two offices flagged with identical \|z\| give the same action whatever order the data arrives in. (Tasks 1, 3, 4, 6)

---

## File Structure

```
src/core/views/format.ts          formatUsd, formatRate, formatCount, formatWeekday, formatHour, formatPercentChange, formatPointsChange
src/core/views/facts.ts           Fact, FactSheet, ViewName, fillPlaceholders, makeFactSheet, Action, makeAction
src/core/views/viewContext.ts     ViewNotes, ViewBase, ViewContext, makeViewContext
src/core/views/missedSlots.ts     busiestMissedSlot
src/core/views/callbacks.ts       buildCallbackList
src/core/views/campaignsView.ts   buildCampaigns
src/core/views/locationsView.ts   buildLocations
src/core/views/missedCallsView.ts buildMissedCalls
src/core/views/overviewView.ts    buildOverview
src/core/views/index.ts           re-exports the four builders and every public type
src/core/localTime.ts             (modify) add localDateTime(instant, timeZone): "YYYY-MM-DD HH:mm"
tests/core/views/fixtures.ts      makeStore, campaign, office, many, officeCalls, basisCalls, callAt, range, expectAllFinite
tests/core/views/format.test.ts
tests/core/views/facts.test.ts
tests/core/views/viewContext.test.ts
tests/core/views/campaignsView.test.ts
tests/core/views/locationsView.test.ts
tests/core/views/callbacks.test.ts
tests/core/views/missedCallsView.test.ts
tests/core/views/overviewView.test.ts
tests/core/localTime.test.ts      (modify) add localDateTime tests
tests/snapshot/original-export-views.test.ts
tests/snapshot/extended-export-views.test.ts
tests/core/different-names.test.ts (modify) build every view on the other export
docs/DECISIONS.md                 (modify) already holds this plan's proposed rows
```

Views get their own folder because nine small files that change together are easier to review as a unit; the rest of `src/core/` stays flat.

---

### Task 1: Formatting, facts and actions

**Files:**
- Create: `src/core/views/format.ts`, `src/core/views/facts.ts`, `tests/core/views/format.test.ts`, `tests/core/views/facts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  // format.ts  (fixed 'en-US' locale, so output never varies by machine)
  export function formatUsd(usd: number): string;            // whole dollars, "$1,234"; "-$5"; never "-$0"
  export function formatRate(fraction: number): string;      // 0.3 -> "30.0%"
  export function formatCount(n: number, noun?: readonly [singular: string, plural: string]): string; // "1 call", "1,204 calls"
  export function formatWeekday(weekday: number): string;    // 0 -> "Monday" ... 6 -> "Sunday"
  export function formatHour(hour: number): string;          // 9 -> "09:00"
  export function formatPercentChange(value: number): string; // 8.2235 -> "+8.2%", -3 -> "-3.0%", 0 -> "0.0%"
  export function formatPointsChange(value: number): string;  // 5 -> "+5.0 points"

  // facts.ts
  export type ViewName = 'overview' | 'campaigns' | 'locations' | 'missed-calls';
  export type Fact =
    | { kind: 'name'; value: string }                         // a campaign, office or channel: becomes an entity
    | { kind: 'count'; value: number; noun?: readonly [string, string] }
    | { kind: 'usd'; value: number }
    | { kind: 'rate'; value: number }                         // a fraction, 0 to 1
    | { kind: 'weekday'; value: number }                      // 0 = Monday
    | { kind: 'hour'; value: number }
    | { kind: 'percent_change'; value: number }
    | { kind: 'points_change'; value: number };
  export type Facts = Record<string, Fact>;
  export interface FactSheet { view: ViewName; facts: Facts; entities: string[] }  // entities: distinct 'name' values, plain character order
  export function formatFact(fact: Fact): string;             // throws on a non-finite number
  export function fillPlaceholders(template: string, facts: Facts): string;  // "{key}" -> formatFact; throws naming unknown keys
  export function makeFactSheet(view: ViewName, facts: Facts): FactSheet;

  export type ActionKind =
    | 'shift_budget' | 'fix_attribution' | 'review_office_answer' | 'review_office_booking' | 'call_back'      // actionable
    | 'no_budget_shift' | 'no_office_stands_out' | 'no_office_worse' | 'no_missed_calls' | 'no_callbacks';    // nothing to do
  export interface ActionLink { view: ViewName; locationId?: string }
  export interface Action {
    kind: ActionKind; actionable: boolean; template: string; facts: Facts; text: string; link: ActionLink;
  }
  export function makeAction(kind: ActionKind, template: string, facts: Facts, link: ActionLink): Action; // text = fillPlaceholders(template, facts)
  ```
  A placeholder key matches `[a-z0-9_.]+`. Keys are prefixed by the action that owns them (`shift.`, `attribution.`, `office_answer.`, `office_booking.`, `callbacks.`, `slot.`, `overview.`), so merged fact sheets never collide.

- [ ] **Step 1: Write the failing tests.**
  - `format.test.ts`: `formatUsd`: `23.33` is `'$23'`, `1234.5` is `'$1,235'`, `0.4` is `'$0'`, `-0.2` is `'$0'`, `-5` is `'-$5'`, `432894` is `'$432,894'`. `formatRate`: `0.3` is `'30.0%'`, `0` is `'0.0%'`, `1` is `'100.0%'`, `0.78945` is `'78.9%'`. `formatCount`: `(1, ['call','calls'])` is `'1 call'`, `(0, ...)` is `'0 calls'`, `(3, ...)` is `'3 calls'`, `(1204, ['booking','bookings'])` is `'1,204 bookings'`, `(1204)` is `'1,204'`. `formatWeekday`: `0` is `'Monday'`, `6` is `'Sunday'`. `formatHour`: `0` is `'00:00'`, `9` is `'09:00'`, `23` is `'23:00'`. `formatPercentChange`: `8.2235` is `'+8.2%'`, `-3` is `'-3.0%'`, `0` is `'0.0%'`, `0.04` is `'0.0%'` and `-0.04` is `'0.0%'` (rounds to zero, no sign). `formatPointsChange`: `5` is `'+5.0 points'`, `-5.25` is `'-5.3 points'`, `0` is `'0.0 points'`.
  - `facts.test.ts`: `formatFact` formats each kind (`{kind:'rate', value:0.5}` is `'50.0%'`, `{kind:'weekday', value:1}` is `'Tuesday'`, `{kind:'name', value:'Alpha'}` is `'Alpha'`); `formatFact` throws for `NaN` and `Infinity`. `fillPlaceholders` fills every placeholder, including one used twice; text with no braces comes back unchanged; an unknown key throws an `Error` whose message contains the key; two unknown keys are both named. `makeFactSheet` lists each distinct `name` value once, in plain character order, and ignores non-name facts; no names gives `entities: []`. `makeAction`: `text` equals the filled template, `actionable` is true for the five actionable kinds and false for the five "none" kinds (`it.each` over all ten).

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/core/views/format.test.ts tests/core/views/facts.test.ts`
  Expected: FAIL, cannot resolve `../../../src/core/views/format`.

- [ ] **Step 3: Implement both modules.** `Intl.NumberFormat('en-US')` for thousands separators; round first, then format, so a value that rounds to zero loses its sign. Sort entities with a plain `<` comparison, never `localeCompare` (varies by machine).

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/core/views/format.test.ts tests/core/views/facts.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/views/format.ts src/core/views/facts.ts tests/core/views/format.test.ts tests/core/views/facts.test.ts
  git commit -m "feat: formatted facts and placeholder templates for view actions

  Templates and, later, AI text fill from one fact sheet, so no sentence can show a number the sheet does not hold.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 2: View context, caveat notes and the test fixtures

**Files:**
- Create: `src/core/views/viewContext.ts`, `tests/core/views/fixtures.ts`, `tests/core/views/viewContext.test.ts`

**Interfaces:**
- Consumes: `CallStore`, `CleanCall`, `Campaign`, `Location`, `DataNotes`, `Channel` (`types.ts`); `ResolvedRange`, `DateRange`, `dataSpan` (`ranges.ts`); `resolveComparison`, `incompleteDays`, `outcomeLagApplies`, `IncompleteDays` (`comparison.ts`); `callsInRange` (`metrics.ts`); `Action`, `FactSheet`, `ViewName` (Task 1); `makeCall` (`tests/core/helpers.ts`).
- Produces:
  ```ts
  export interface ViewNotes {                      // PLAN.md 3.3, returned by every view
    asOf: LocalDate;                                // the data's last local date (the range end when the store is empty)
    clamped: boolean;                               // the range was cut to the data
    comparison: { available: boolean; previous: DateRange | null; reason: string | null; overlaps: boolean };
    incompleteCurrent: IncompleteDays;
    incompletePrevious: IncompleteDays | null;      // null when there is no previous range
    outcomeLag: { days: number; applies: boolean };
    skippedRows: number;                            // store.dataNotes.badRows
  }
  export interface ViewBase {
    view: ViewName; range: ResolvedRange; notes: ViewNotes;
    actions: Action[];                              // never empty; actions[0] is the headline
    templateSentence: string;                       // actions[0].text (Overview: see Task 7)
    factSheet: FactSheet;
  }
  export interface ViewContext {
    store: CallStore; span: DateRange; range: ResolvedRange;
    current: CleanCall[];                           // calls whose localDate is in range
    previous: CleanCall[] | null;                   // null unless the comparison is available
    notes: ViewNotes;
  }
  export function makeViewContext(store: CallStore, range: ResolvedRange, previous?: DateRange): ViewContext;
  ```
  Test helpers in `fixtures.ts` (later tasks use them):
  ```ts
  export const campaign: (id: string, name: string, channel: Channel, dailyBudgetUsd: number) => Campaign;
  export const office: (id: string, name: string, timezone?: string) => Location;   // default 'America/Denver', timezoneValid true
  export function makeStore(calls: CleanCall[], opts?: { campaigns?: Campaign[]; locations?: Location[]; dataNotes?: Partial<DataNotes> }): CallStore;
  //   dataNotes default: cleanExport(loadFixture([])).dataNotes, then the overrides
  export const range: (start: string, end: string) => ResolvedRange;   // days counted, clamped false
  export const many: (n: number, over?: Partial<CleanCall>) => CleanCall[];            // n makeCall()s, each its own caller
  export const callAt: (startedAtIso: string, over?: Partial<CleanCall>) => CleanCall; // startedAt set; localDate = the ISO date unless overridden
  export function officeCalls(locationId: string, shape: { calls: number; answered: number; booked: number; missedSlot?: { weekday: number; hour: number } }, over?: Partial<CleanCall>): CleanCall[];
  //   booked <= answered <= calls. First `booked` calls are answered+booked (revenue 100), the next answered-booked are answered 'not_qualified' (revenue 0), the rest unanswered 'missed' at missedSlot (default weekday 3, hour 10).
  export function basisCalls(campaignId: string, channel: Channel, shape: { answered: number; booked: number }): CleanCall[];
  //   answered calls with an outcome on localDate 'YYYY-MM-DD' well before every test range ('2026-08-01'), booked ones at $100
  export function expectAllFinite(value: unknown): void;   // walks objects, arrays and numbers; fails on NaN or Infinity
  ```

- [ ] **Step 1: Write the failing tests** in `viewContext.test.ts`. Store: calls on `'2026-09-01'` through `'2026-09-14'` (span 14 days, `dataNotes.outcomeLagDays` 3, `badRows` 12).
  - `a range with an equal previous period gets a comparison`: `range('2026-09-08','2026-09-14')`: `notes.comparison` is `{ available: true, previous: { start: '2026-09-01', end: '2026-09-07' }, reason: null, overlaps: false }`; `previous` holds only calls dated in that window; `current` only calls in the range, inclusive at both ends.
  - `all data has no comparison`: `range('2026-09-01','2026-09-14')`: `available: false`, `previous` is the would-be window `2026-08-18..2026-08-31`, `reason` starts `No full previous period`, `context.previous` is `null`, `incompleteCurrent` is `{ includesFirstDay: true, includesLastDay: true }`, `incompletePrevious` is `{ includesFirstDay: false, includesLastDay: false }`.
  - `the caveat flags come from the store`: `skippedRows` is 12; `outcomeLag` is `{ days: 3, applies: true }` for a range ending on the last day, and `applies: false` for `range('2026-09-01','2026-09-07')`; `asOf` is `'2026-09-14'`; `clamped` copies `range.clamped`.
  - `an explicit second range is used`: previous `{ start: '2026-09-01', end: '2026-09-03' }` for a 3-day range `2026-09-08..2026-09-10`: available, `current`/`previous` split as expected.
  - `a malformed or inverted second range is not an error`: previous `{ start: '2026-02-30', end: '2026-03-02' }` gives `available: false`, `previous: null`, `reason` containing `2026-02-30`, `context.previous` null, and it does not throw. (Review Focus 3)
  - `an unequal-length second range gives no comparison`: 7-day current with a 3-day previous: `available: false`, `reason` starts `No like-for-like comparison`.
  - `a store with no calls builds a context`: `makeViewContext(makeStore([]), range('2026-09-01','2026-09-07'))` does not throw, `current` is `[]`, `previous` is `null`, `asOf` is `'2026-09-07'`, `comparison.available` false. (Review Focus 4)
  - `calls outside the range are not current`, using a call at `startedAt 2026-09-11T02:00:00Z` with `localDate '2026-09-10'`: it is in a range ending `2026-09-10`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/core/views/viewContext.test.ts`
  Expected: FAIL, cannot resolve `../../../src/core/views/viewContext`.

- [ ] **Step 3: Implement `makeViewContext` and `fixtures.ts`.** Span is `dataSpan(store.calls) ?? range`. Call `resolveComparison(span, range, previous)`; on `ok: false` set `available: false`, `previous: null`, `reason: error.message`. `previous` calls are loaded only when `available`. `incompletePrevious` is computed from the would-be window when there is one. Fixture `makeStore` fills `campaigns` and `locations` with empty arrays unless given.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/core/views/viewContext.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/views/viewContext.ts tests/core/views/fixtures.ts tests/core/views/viewContext.test.ts
  git commit -m "feat: shared view context with the inline caveat notes

  Every view resolves its comparison once and carries the caveats PLAN.md 3.3 wants next to the numbers; a bad second range yields a reason, not a crash.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 3: Campaigns view (4.2)

**Files:**
- Create: `src/core/views/campaignsView.ts`, `tests/core/views/campaignsView.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2; `tally`, `rate`, `estimatedSpend`, `costPerBooking`, `revenuePerBudgetDollar` (`metrics.ts`); `pickBestWorst`, `CampaignPerformance` (`ranking.ts`); `callsPerWeek`, `WeekBucket` (`weeks.ts`); `THRESHOLDS`.
- Produces:
  ```ts
  export interface CampaignRow {
    campaignId: string | null; name: string; channel: Channel | null;      // Unattributed: null id, name 'Unattributed', null channel
    calls: number; bookings: number; bookingRate: number | null; revenueUsd: number;
    estimatedSpendUsd: number | null;           // null for Unattributed
    estimatedCostPerBookingUsd: number | null;  // null: zero budget, zero bookings, or Unattributed
    revenuePerBudgetDollar: number | null;
    isBest: boolean; isWorst: boolean;
  }
  export interface UnattributedRow extends CampaignRow { trackingNumbers: { trackingNumber: string; calls: number }[] } // most calls first, ties by number
  export interface CampaignsView extends ViewBase {
    view: 'campaigns';
    rows: CampaignRow[];                        // every store campaign, calls desc, ties by campaign id
    unattributed: UnattributedRow | null;       // null when no unattributed call is in range
    bestWorst: { eligible: number; reason: string | null };   // reason only when nothing is marked
    weekly: { campaignId: string; name: string; weeks: WeekBucket[] } | null;
  }
  export interface CampaignsOptions { campaignId?: string }   // the weekly chart's campaign
  export function buildCampaigns(store: CallStore, range: ResolvedRange, previous?: DateRange, options?: CampaignsOptions): CampaignsView;
  ```
  Actions, in order, each present only when it applies:
  - `shift_budget`: `"Shift budget from {shift.worst.name} (est. {shift.worst.cost_per_booking} per booking) toward {shift.best.name} (est. {shift.best.cost_per_booking} per booking)."` Facts: `shift.worst.name`/`shift.best.name` (`name`), the two `cost_per_booking` (`usd`). Link `{ view: 'campaigns' }`. No projected extra bookings.
  - `fix_attribution`: `"{attribution.calls} ({attribution.bookings}, {attribution.revenue}) came in on {attribution.numbers} not tied to any campaign. Assign each to a campaign."` Facts: `calls` (noun call/calls), `bookings` (booking/bookings), `numbers` (tracking number/tracking numbers), `revenue` (`usd`). Link `{ view: 'campaigns' }`.
  - if neither applies, one `no_budget_shift` action. Fewer than two eligible: `"No budget shift is suggested: fewer than two campaigns have a daily budget and at least {no_shift.min_bookings} in this range."` with `no_shift.min_bookings` a `count` fact (noun booking/bookings). Two or more eligible but equal value: `"No budget shift is suggested: the eligible campaigns earn the same revenue per budget dollar."` When an action list holds `fix_attribution` but no shift, `bestWorst.reason` is still set. `bestWorst.reason` is the sentence after the colon, capitalised.

- [ ] **Step 1: Write the failing tests.** Fixture: campaigns Alpha `cmp_a` social $10, Beta `cmp_b` display $20, Gamma `cmp_c` referral $0, Delta `cmp_d` paid_search $5; locations one office; range `2026-09-01..2026-09-14` (14 days). Calls (`many`): Alpha 10 calls, 6 booked at $100; Beta 10 calls, 5 booked at $50; Gamma 8 calls, all booked at $100; Delta 4 calls, all booked at $100. Unattributed: three calls with `campaignId null, unattributed true`, two booked ($100, $50), tracking numbers `+1-555-0190` twice and `+1-555-0191` once.
  - `rows are every campaign, ranked by calls, ties by id`: order `cmp_a, cmp_b, cmp_c, cmp_d`; a fifth campaign with no calls in range appears last with `calls 0`, `bookingRate null`, `estimatedCostPerBookingUsd null`. (Review Focus 4)
  - `numbers`: Alpha is `calls 10, bookings 6, bookingRate 0.6, revenueUsd 600, estimatedSpendUsd 140`, `estimatedCostPerBookingUsd` close to `23.33`, `revenuePerBudgetDollar` close to `4.2857`; Beta spend `280`, cost per booking `56`.
  - `spend uses the days in the range`: the same data with a one-day range gives Alpha spend `10`.
  - `a zero budget has blank cost per booking and revenue per budget dollar, never infinity`: Gamma `estimatedSpendUsd 0`, both `null`; `expectAllFinite(view)`.
  - `best and worst are marked among eligible campaigns only`: Alpha `isBest`, Beta `isWorst`; Delta (4 bookings, higher value) and Gamma (budget 0) are neither; `bestWorst.eligible` is `2`, `reason` null.
  - `the shift action names both campaigns with their cost per booking`: `actions[0].text` is `'Shift budget from Beta (est. $56 per booking) toward Alpha (est. $23 per booking).'`, `kind 'shift_budget'`, `actionable true`, `link` `{ view: 'campaigns' }`; `templateSentence` equals it; `factSheet.entities` is `['Alpha', 'Beta']`.
  - `unattributed is its own row after the ranked ones, with blank spend columns`: `unattributed` has `campaignId null`, `name 'Unattributed'`, `calls 3, bookings 2, revenueUsd 150`, `estimatedSpendUsd null`, `estimatedCostPerBookingUsd null`, `revenuePerBudgetDollar null`, `trackingNumbers` `[{ '+1-555-0190', 2 }, { '+1-555-0191', 1 }]`; it is not in `rows`.
  - `the attribution action follows the shift action`: `actions.map(a => a.kind)` is `['shift_budget', 'fix_attribution']`; second text is `'3 calls (2 bookings, $150) came in on 2 tracking numbers not tied to any campaign. Assign each to a campaign.'`.
  - `a single unattributed call reads in the singular`: one booked call at $100 on one number gives `'1 call (1 booking, $100) came in on 1 tracking number not tied to any campaign. Assign each to a campaign.'`. (Review Focus 5)
  - `no unattributed calls in range means no attribution action`: unattributed calls exist only on a date outside the range: `unattributed` is `null` and no action has `kind 'fix_attribution'`.
  - `fewer than two eligible campaigns marks nothing and says why`: Beta has 4 bookings, so only Alpha is eligible: nobody `isBest`/`isWorst`, `bestWorst` is `{ eligible: 1, reason: 'Fewer than two campaigns have a daily budget and at least 5 bookings in this range.' }`; with the unattributed calls removed, `actions` is one `no_budget_shift` with text `'No budget shift is suggested: fewer than two campaigns have a daily budget and at least 5 bookings in this range.'`, `actionable false`; with them present, `actions[0].kind` is `'fix_attribution'`.
  - `two eligible campaigns with equal value mark nothing`: Beta tuned to Alpha's revenue per budget dollar gives the second `no_budget_shift` sentence and `reason` `'The eligible campaigns earn the same revenue per budget dollar.'`.
  - `the weekly chart defaults to the campaign with most calls`: `weekly.campaignId` is `'cmp_a'`, `weekly.name` `'Alpha'`, `weeks` has an entry per Monday-to-Sunday week the range touches (3 for `2026-09-01..2026-09-14`, the first and last `partial: true`); `options.campaignId: 'cmp_b'` switches it; an unknown id gives `weekly: null`. (Review Focus 2)
  - `an empty range builds`: a range with no calls gives zero rows, `unattributed null`, `weekly` with zero-filled weeks, one `no_budget_shift` action, `expectAllFinite(view)`. A store with no campaigns and no calls gives `rows: []`, `weekly: null`. (Review Focus 4)

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/core/views/campaignsView.test.ts`
  Expected: FAIL, cannot resolve `../../../src/core/views/campaignsView`.

- [ ] **Step 3: Implement `buildCampaigns`.** Per campaign: `tally` of its calls in range, then the Phase 3 spend and ratio functions with `range.days`. Feed `pickBestWorst` only the real campaigns. `bestWorst.eligible` comes from its result; when `best` is null and `eligible >= 2` the reason is the "same value" sentence. The `min_bookings` fact reads `THRESHOLDS.MIN_BOOKINGS_TO_RANK`. Weekly: filter `store.calls` to the chosen campaign and pass them to `callsPerWeek(calls, range, span)`. Fact sheet is `makeFactSheet('campaigns', ...)` over every action's facts.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/core/views/campaignsView.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/views/campaignsView.ts tests/core/views/campaignsView.test.ts
  git commit -m "feat: Campaigns view with best/worst, budget shift and attribution actions

  Cost per booking stays blank when it can't be computed, and a weak ranking says why instead of guessing.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 4: Busiest missed slot and Locations view (4.3)

**Files:**
- Create: `src/core/views/missedSlots.ts`, `src/core/views/locationsView.ts`, `tests/core/views/locationsView.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2; `tally`, `rate` (`metrics.ts`); `officeOutlier`, `bestCampaignAtOffice`, `OutlierResult`, `CampaignAtOffice` (`ranking.ts`); `THRESHOLDS`.
- Produces:
  ```ts
  export interface MissedSlot { locationId: string; weekday: number; hour: number; calls: number }
  /** Over the unanswered calls given. Most calls wins; ties go to the lower location id, then weekday, then hour (plain character order for the id). Null when none is unanswered. */
  export function busiestMissedSlot(calls: readonly CleanCall[]): MissedSlot | null;

  export interface BestCampaign { campaignId: string; name: string; calls: number; bookings: number; bookingRate: number }
  export interface LocationRow {
    locationId: string; name: string;
    calls: number; answered: number; answerRate: number | null;
    bookings: number; bookingRate: number | null; revenueUsd: number;
    bestCampaign: BestCampaign | null;          // highest booking rate among campaigns with MIN_CALLS_BEST_CAMPAIGN calls there; unattributed calls are not a campaign
    answerFlag: OutlierResult; bookingFlag: OutlierResult;   // the office against all other offices pooled, in range
  }
  export interface LocationsView extends ViewBase { view: 'locations'; rows: LocationRow[] }   // every store location, calls desc, ties by location id
  export function buildLocations(store: CallStore, range: ResolvedRange, previous?: DateRange): LocationsView;
  ```
  One action, chosen from every flag with `flagged && direction === 'worse'` by largest \|z\| (ties: answer before booking, then lower location id):
  - `review_office_answer`: `"{office_answer.office} answers {office_answer.office_rate} of calls versus {office_answer.rest_rate} at other offices. Its most-missed hour is {office_answer.weekday} {office_answer.hour} local."` (`name`, `rate`, `rate`, `weekday`, `hour`), the slot from `busiestMissedSlot` of that office's calls in range. If there is no slot the second sentence is left out (cannot happen for a flagged office; no test). Link `{ view: 'missed-calls', locationId }`.
  - `review_office_booking`: `"{office_booking.office} books {office_booking.office_rate} of calls versus {office_booking.rest_rate} elsewhere. Its best campaign there is {office_booking.campaign}."` (`campaign` is a `name` fact). With no best campaign the last sentence becomes `"No campaign there has at least {office_booking.min_calls} to name a best one."`, with `min_calls` a `count` fact (noun call/calls) read from `THRESHOLDS.MIN_CALLS_BEST_CAMPAIGN`. Link `{ view: 'campaigns' }`.
  - nothing flagged: `no_office_stands_out`, `"No office stands out on answer or booking rate. Missed calls are a company-wide issue."`, link `{ view: 'missed-calls' }`.
  - only "better" flags: `no_office_worse`, `"No office is doing worse than the rest on answer or booking rate. Missed calls are a company-wide issue."`, same link.

- [ ] **Step 1: Write the failing tests.** `locationsView.test.ts`, with `busiestMissedSlot` tests first, then the view. Offices `loc_a` "Office A", `loc_b` "Office B", `loc_c` "Office C"; campaigns Alpha `cmp_a`, Beta `cmp_b`. Use `officeCalls`. **Standard fixture L1**: A `{ calls 100, answered 30, booked 30, missedSlot { weekday 1, hour 9 } }`, B `{ 500, 250, 150 }`, C `{ 500, 250, 150 }`, all Alpha; range covering every call date.
  - `busiestMissedSlot counts only unanswered calls by local weekday and hour`: three unanswered at weekday 1 hour 9, two at weekday 4 hour 15, plus answered calls at weekday 4 hour 15: `{ weekday 1, hour 9, calls 3 }`; none unanswered gives `null`.
  - `busiestMissedSlot breaks ties by office, weekday, hour`: equal counts at `loc_b` weekday 0 and `loc_a` weekday 3 give `loc_a`; same office, weekday 2 vs 5 gives 2; same weekday, hour 9 vs 14 gives 9; the input order reversed gives the same answer.
  - `rows are every office, ranked by calls, ties by id`: order `loc_b, loc_c, loc_a`; A is `calls 100, answered 30, answerRate 0.3, bookings 30, bookingRate 0.3, revenueUsd 3000`.
  - `a worse answer rate is flagged with both rates`: A `answerFlag` is `flagged true, direction 'worse', officeRate 0.3, restRate 0.5`, `z` close to `-3.82`; A `bookingFlag.flagged` false; B and C not flagged either way.
  - `the answer action names the office, both rates and its most-missed hour`: `actions` has one entry, `kind 'review_office_answer'`, text `'Office A answers 30.0% of calls versus 50.0% at other offices. Its most-missed hour is Tuesday 09:00 local.'`, `link` `{ view: 'missed-calls', locationId: 'loc_a' }`, `factSheet.entities` `['Office A']`.
  - `a worse booking rate names the best campaign there`: fixture L2: A is two calls sets, both answered: Alpha `{ calls 60, answered 60, booked 25 }` and Beta `{ calls 40, answered 40, booked 5 }`; B `{ 1000, 1000, 500 }`. A `bookingFlag` is worse (`officeRate 0.3`, `restRate 0.5`), `answerFlag.flagged` false with `z` null. Text `'Office A books 30.0% of calls versus 50.0% elsewhere. Its best campaign there is Alpha.'`, link `{ view: 'campaigns' }`, `bestCampaign` Alpha with `bookingRate` close to `0.4167`. Entities `['Alpha', 'Office A']`.
  - `no campaign with enough calls at the office`: L2 with every A call unattributed (`campaignId null, unattributed true`): `bestCampaign` is `null`; text `'Office A books 30.0% of calls versus 50.0% elsewhere. No campaign there has at least 20 calls to name a best one.'`.
  - `an office flagged better changes no action`: L1 with A `answered 70, booked 30`: A `answerFlag` is `flagged true, direction 'better'`; `actions[0].kind` is `'no_office_worse'`, text `'No office is doing worse than the rest on answer or booking rate. Missed calls are a company-wide issue.'`, link `{ view: 'missed-calls' }` with no `locationId`.
  - `no office flagged gives the nothing-stands-out action`: L1 with A `answered 50, booked 30`: `kind 'no_office_stands_out'`, text `'No office stands out on answer or booking rate. Missed calls are a company-wide issue.'`, `actionable false`.
  - `the larger z wins, even on booking rate`: A `{ 100, 30, 3 }`, B `{ 1000, 500, 500 }`: A is flagged worse on both; the action is `review_office_booking` with text `'Office A books 3.0% of calls versus 50.0% elsewhere. Its best campaign there is Alpha.'`, and A's `answerFlag` still shows `worse`.
  - `equal z is broken by the office id, whatever the input order`: A `{ 100, 30, 30 }` and C `{ 100, 30, 30 }`, B `{ 1000, 500, 300 }`: both flagged worse on answer with identical `z`; the action names Office A; building again with `store.locations` and `calls` reversed names Office A too. (Review Focus 5)
  - `an office with too few calls is not flagged`: A `{ calls 49, answered 0, booked 0 }` against B `{ 1000, 500, 300 }`: `answerFlag.eligible` false, not flagged.
  - `an office with no calls in range still has a row`: A has calls only outside the range: `calls 0`, `answerRate null`, `bookingRate null`, `bestCampaign null`, both flags `eligible false`. (Review Focus 4)
  - `an empty range builds`: all rows zero, one `no_office_stands_out` action, `expectAllFinite(view)`; a store with no calls and no offices gives `rows: []`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/core/views/locationsView.test.ts`
  Expected: FAIL, cannot resolve `../../../src/core/views/missedSlots`.

- [ ] **Step 3: Implement both modules.** For each office, `rest` is the range total minus the office (`calls` and `successes`) fed to `officeOutlier` once for answered and once for bookings. `bestCampaignAtOffice` gets one `CampaignAtOffice` per campaign with calls at that office in range. Sort worse candidates by `Math.abs(z)` descending, then kind, then location id (plain `<`). Floating-point ties: the two tied offices must use identical arithmetic, so compute `rest` the same way for each.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/core/views/locationsView.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/views/missedSlots.ts src/core/views/locationsView.ts tests/core/views/locationsView.test.ts
  git commit -m "feat: Locations view with office outlier flags and one worst-first action

  A flag only becomes advice when it is worse; 'better' offices and thin samples never produce an action.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 5: Callback list (4.4)

**Files:**
- Create: `src/core/views/callbacks.ts`, `tests/core/views/callbacks.test.ts`
- Modify: `src/core/localTime.ts` (add `localDateTime`), `tests/core/localTime.test.ts`

**Interfaces:**
- Consumes: `CallStore`, `CleanCall`; `ResolvedRange`; `callsInRange`, `toCents` (`metrics.ts`); `MissedValueRates`, `estimateMissedCallValue` (`missedValue.ts`); `fixtures.ts`.
- Produces:
  ```ts
  // localTime.ts
  export function localDateTime(instant: Date, timeZone: string): string;   // "YYYY-MM-DD HH:mm" in that zone; hour 00-23

  // callbacks.ts
  export interface CallbackRow {
    callerHash: string; unansweredAttempts: number;      // in range (and at the filtered office, if any)
    lastAttemptAt: Date; lastAttemptLocal: string;       // localDateTime in the office's zone
    locationId: string; officeName: string;
    campaignId: string | null; campaignName: string;     // 'Unattributed' when null
    trackingNumber: string; estimatedValueUsd: number;   // the latest missed call's value only
  }
  export interface CallbackList {
    rows: CallbackRow[];                                 // value desc, ties by caller hash (plain character order)
    totalValueUsd: number;                               // sum in whole cents
    unidentifiedUnanswered: number;                      // unanswered calls with no caller hash: not listable
  }
  export function buildCallbackList(
    store: CallStore, range: ResolvedRange, rates: MissedValueRates, options?: { locationId?: string },
  ): CallbackList;
  ```
  A caller is listed when they have an unanswered call in range (at the filtered office, if given) and **no answered call strictly after the latest of those**, at any office, looking to the end of the export (not just the range). An answered call with no outcome (pending) counts as answered. Callers are matched by `callerHash` only.

- [ ] **Step 1: Write the failing tests.**
  - `localTime.test.ts` `localDateTime`: `2026-09-10T16:05:00Z` in `America/Phoenix` is `'2026-09-10 09:05'`; in `America/Denver` `'2026-09-10 10:05'`; `2026-09-10T06:30:00Z` in `America/Phoenix` is `'2026-09-09 23:30'` (previous local day); a local midnight (`2026-09-10T07:00:00Z`, Phoenix) is `'2026-09-10 00:00'`, never `24:00`; a half-hour zone (`Asia/Kolkata`, `2031-05-10T20:00:00Z`) is `'2031-05-11 01:30'`.
  - `callbacks.test.ts`. Fixture: offices `loc_a` "Office A" (Phoenix), `loc_b` "Office B" (Denver); campaigns Alpha `cmp_a` social, Beta `cmp_b` display; `basisCalls('cmp_a','social',{ answered 30, booked 6 })` (Alpha value $20 per missed call) and `basisCalls('cmp_b','display',{ answered 30, booked 3 })` (Beta $10); `rates = buildMissedValueRates(store.calls)`; range `2026-09-08..2026-09-14`. Use `callAt` with explicit `callerHash`.
    - `a caller who missed and then got through is left out`: miss `2026-09-10T16:00Z`, answered `2026-09-11T16:00Z`, same hash: no row.
    - `a caller who got through and then missed is listed`: answered `09-10`, missed `09-11`: one row.
    - `a caller who got through after the range ended is left out`: miss in range, answered `2026-09-20` (past the range end): no row.
    - `an answered call at another office counts as getting through`: miss at `loc_a`, answered at `loc_b` later: no row.
    - `an answered call with no outcome counts as getting through`: later call `answered true, outcome null, pending true`: no row.
    - `an answered call at the same instant or earlier does not count`: answered `09-10T16:00Z`, miss `09-10T16:00Z`: row present.
    - `several attempts: counted in range, valued by the latest only`: caller `h1` misses on `09-09` (Alpha), `09-10` (Alpha), `09-12` (Beta): `unansweredAttempts 3`, `estimatedValueUsd 10`, `campaignId 'cmp_b'`, `lastAttemptAt` the `09-12` call; a fourth miss on `2026-09-20` (after the range) is not counted.
    - `misses outside the range do not list a caller`: only miss on `2026-09-01`: no row.
    - `rows are sorted by value, then caller hash; the total is their sum`: three callers with values $20, $10, $20: order by value desc, the two $20 ones by hash; `totalValueUsd 50`.
    - `an unattributed caller is valued by channel and labelled`: miss with `campaignId null, unattributed true, channel 'social'`: `campaignName 'Unattributed'`, `campaignId null`, value from social's channel rates (`20`).
    - `the row carries office, tracking number and local time`: `officeName 'Office A'`, `trackingNumber` of the call, `lastAttemptLocal '2026-09-10 09:00'` for `16:00Z` at Phoenix.
    - `no caller hash: not listed, counted` (Review Focus 1): two unanswered calls with `callerHash ''` give `rows []`, `unidentifiedUnanswered 2`; with a third caller that has a hash, the list holds only that caller.
    - `an office filter limits the misses, not the got-through check`: misses at `loc_a` and `loc_b` by different callers: `{ locationId: 'loc_a' }` lists only the `loc_a` caller; a caller who missed at `loc_a` and got through at `loc_b` stays out.
    - `an unknown office id lists nobody` and `no missed calls gives an empty list`: `rows []`, `totalValueUsd 0`, `unidentifiedUnanswered 0`. (Review Focus 2)

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/core/views/callbacks.test.ts tests/core/localTime.test.ts`
  Expected: FAIL (`localDateTime` and `buildCallbackList` not defined).

- [ ] **Step 3: Implement `localDateTime` and `buildCallbackList`.** `localDateTime` uses its own cached `Intl.DateTimeFormat` with `hourCycle: 'h23'`, `minute: '2-digit'`, as `localParts` does. For the list: group the in-range unanswered calls by hash; compare each group's latest `startedAt` (ties by call id, plain `<`) with the latest answered `startedAt` per hash over **all** `store.calls`; keep the group when no answered call is strictly later. Value is `toCents(estimateMissedCallValue(rates, call).valueUsd)` for the latest call; total is summed in cents. Office name from `store.locations`, zone from the same record.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/core/views/callbacks.test.ts tests/core/localTime.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/localTime.ts src/core/views/callbacks.ts tests/core/localTime.test.ts tests/core/views/callbacks.test.ts
  git commit -m "feat: callback list of callers who never got through

  A caller is listed only if nobody answered them after their last miss, looking past the selected range to the end of the export.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 6: Missed calls view (4.4)

**Files:**
- Create: `src/core/views/missedCallsView.ts`, `tests/core/views/missedCallsView.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 5; `buildMissedValueRates`, `estimateMissedCallValue` (`missedValue.ts`); `toCents`; `THRESHOLDS`.
- Produces:
  ```ts
  export interface MissedCallsOptions { locationId?: string }
  export interface MissedCallsView extends ViewBase {
    view: 'missed-calls';
    /** The office filter applied; null = all offices. An unknown id gives { locationId, name: null } and an empty view. */
    officeFilter: { locationId: string; name: string | null } | null;
    unansweredCalls: number;                               // in range (at the filtered office)
    unidentifiedUnanswered: number;                        // same as callbacks.unidentifiedUnanswered
    heatmap: {
      byOffice: { locationId: string; name: string; hours: number[]; total: number }[];   // hours: 24 entries, zero-filled; every office (only the filtered one with a filter)
      byWeekday: { weekday: number; hours: number[]; total: number }[];                   // 7 rows, Monday first, zero-filled
    };
    lostValue: {
      estimatedUsd: number;                                // every unanswered call in range, per call in whole cents
      bySource: { campaign: number; channel: number; overall: number };  // how many calls each rate source valued
      formula: string;                                     // plain sentence, threshold read from THRESHOLDS.MIN_ANSWERED_FOR_RATE
    };
    callbacks: CallbackList;
    busiestSlot: (MissedSlot & { officeName: string }) | null;   // over the unanswered calls above
    limitNote: string;                                     // the export carries only a hashed caller number (PLAN.md 4.4)
  }
  export function buildMissedCalls(store: CallStore, range: ResolvedRange, previous?: DateRange, options?: MissedCallsOptions): MissedCallsView;
  ```
  Rates come from `buildMissedValueRates(store.calls)` (the whole export). Actions, one:
  - `call_back` (at least one row): `"Call back {callbacks.callers} who never got through (est. {callbacks.value} in bookings). Busiest missed slot: {slot.office} {slot.weekday} {slot.hour}."` (`callers` count noun caller/callers; `value` `usd` = `callbacks.totalValueUsd`; `slot.office` `name`). Link `{ view: 'missed-calls', locationId? }` (the filter, if any).
  - `no_callbacks` (unanswered calls exist but no row): `"There is no one to call back from this range. Busiest missed slot: {slot.office} {slot.weekday} {slot.hour}."`
  - `no_missed_calls` (no unanswered call): `"No calls went unanswered in this range."`

- [ ] **Step 1: Write the failing tests.** Same fixture as Task 5 (Alpha $20, Beta $10 per missed call; offices A Phoenix and B Denver), plus Gamma `cmp_c` display $0 budget with a thin basis (`basisCalls('cmp_c','display',{ answered 10, booked: 0 })`) and `basisCalls('cmp_d','display',{ answered 30, booked 6 })` for Delta `cmp_d`, so the display channel is $15 per call.
  - `the heatmap is zero-filled`: every `byOffice` row has 24 `hours`, `byWeekday` has 7 rows of 24; a cell with no misses is `0`; the sum of all `byOffice` totals and of all `byWeekday` totals equals `unansweredCalls`; an office with no misses still has a row of zeros. (Review Focus 4)
  - `the heatmap uses local weekday and hour`: a miss with `localWeekday 4, localHour 15` lands in `byWeekday[4].hours[15]` and the office's `hours[15]`, whatever its UTC time.
  - `answered calls are not in the heatmap or the counts`.
  - `lost value covers every unanswered call in range`: three Alpha misses and one Beta miss: `estimatedUsd 70`; a miss outside the range is not counted; a caller who got through later is **still** in lost value but not in `callbacks.rows`.
  - `a campaign too thin for its own rate uses its channel`: two misses on Gamma (10 answered): `estimatedUsd 30`, `bySource` `{ campaign: 0, channel: 2, overall: 0 }`; with Alpha's miss added, `campaign: 1`.
  - `the formula names the threshold`: `formula` contains `'30'` and `'channel'` and `'whole export'`.
  - `busiest slot names the office, weekday and hour`: `busiestSlot` is `{ locationId 'loc_a', weekday 1, hour 9, calls n, officeName 'Office A' }`.
  - `the call-back action`: two callers worth $20 and $20 gives `'Call back 2 callers who never got through (est. $40 in bookings). Busiest missed slot: Office A Tuesday 09:00.'`, `kind 'call_back'`, `actionable true`, `link { view: 'missed-calls' }`; one caller gives `'Call back 1 caller who never got through (est. $20 in bookings). ...'`; `factSheet.entities` is `['Office A']`. (Review Focus 5)
  - `everyone has since got through`: misses exist but every caller was answered later: `actions[0].kind` is `'no_callbacks'`, `lostValue.estimatedUsd` above 0, text `'There is no one to call back from this range. Busiest missed slot: Office A Tuesday 09:00.'`.
  - `no missed calls in range`: only answered calls, and separately an empty range: `unansweredCalls 0`, heatmap all zero, `estimatedUsd 0`, `callbacks.rows []`, `busiestSlot null`, one `no_missed_calls` action with text `'No calls went unanswered in this range.'`, `expectAllFinite(view)`.
  - `an office filter`: `{ locationId: 'loc_a' }` gives `officeFilter { 'loc_a', 'Office A' }`, one `byOffice` row, counts and callbacks only for that office, and the action's `link` is `{ view: 'missed-calls', locationId: 'loc_a' }`.
  - `an unknown office id gives an empty view, not all offices`: `officeFilter { 'nope', null }`, `unansweredCalls 0`, `byOffice []`, `no_missed_calls`. (Review Focus 2)
  - `unanswered calls with no caller hash`: they count in `unansweredCalls`, the heatmap and lost value, are counted in `unidentifiedUnanswered`, and are not in `callbacks.rows`. (Review Focus 1)
  - `the limit note says callers are identified by hash`: `limitNote` contains `'hash'`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/core/views/missedCallsView.test.ts`
  Expected: FAIL, cannot resolve `../../../src/core/views/missedCallsView`.

- [ ] **Step 3: Implement `buildMissedCalls`.** Unanswered calls are `!c.answered` over `ctx.current`, limited to the office when a filter is given. Heatmap rows build from `store.locations` (or just the filtered one), then fill from the calls. Lost value: `toCents(estimateMissedCallValue(rates, c).valueUsd)` per call, summed, divided by 100 once; count `source` per call. The `formula` and `limitNote` are fixed sentences with the threshold interpolated; neither contains a real date or dataset name.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/core/views/missedCallsView.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/views/missedCallsView.ts tests/core/views/missedCallsView.test.ts
  git commit -m "feat: Missed calls view with heatmap, lost-value estimate and call-back action

  Lost value uses rates from the whole export so it doesn't move with the range; the callback list is the only part that looks past the range.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 7: Overview view (4.1) and the views index

**Files:**
- Create: `src/core/views/overviewView.ts`, `src/core/views/index.ts`, `tests/core/views/overviewView.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 6; `tally`, `changeInCount`, `changeInRate`, `rate`, `Change` (`metrics.ts`).
- Produces:
  ```ts
  export interface Tile { current: number | null; previous: number | null; change: Change }   // previous null and change none when no comparison
  export interface OverviewView extends ViewBase {
    view: 'overview';
    tiles: { calls: Tile; uniqueCallers: Tile; answerRate: Tile; bookings: Tile; revenueUsd: Tile };   // answerRate is a fraction, null with no calls
    topActions: { view: ViewName; action: Action }[];      // Campaigns, Locations, Missed calls, in that order: each view's actions[0]
  }
  export function buildOverview(store: CallStore, range: ResolvedRange, previous?: DateRange): OverviewView;
  ```
  `index.ts` re-exports `buildOverview`, `buildCampaigns`, `buildLocations`, `buildMissedCalls`, their option and result types, `ViewBase`, `ViewNotes`, `Action`, `ActionKind`, `Fact`, `FactSheet`, `ViewName`, `fillPlaceholders`, and the `format*` functions. `actions` is the three top actions' list (same order). `templateSentence` is the text of the first actionable top action, else of the first one. Fact sheet: the tile facts below plus every top action's facts.

  Tile facts: `overview.calls`, `overview.callers`, `overview.bookings` (`count`, nouns call/calls, caller/callers, booking/bookings), `overview.answer_rate` (`rate`, only when not null), `overview.revenue` (`usd`); and for each tile with a `percent` change `overview.<name>_change` (`percent_change`) or with a `points` change (`points_change`). `new` and `none` produce no change fact.

- [ ] **Step 1: Write the failing tests.** Fixture: 14 days `2026-09-01..2026-09-14`; range `2026-09-08..2026-09-14` against the previous 7 days. Previous period: 10 calls, 8 answered, 4 booked at $100, 8 distinct callers. Current: 12 calls, 9 answered, 5 booked at $100, 12 distinct callers.
  - `tiles show current, previous and change`: `calls` is `{ current 12, previous 10, change { percent, 20 } }`; `uniqueCallers` `{ 12, 8, percent 50 }`; `answerRate` current `0.75`, previous `0.8`, `change` `{ points, -5 }` (`toBeCloseTo`); `bookings` `{ 5, 4, percent 25 }`; `revenueUsd` `{ 500, 400, percent 25 }`.
  - `no comparison on all data`: `range('2026-09-01','2026-09-14')`: every `previous` null, every `change` `{ kind: 'none' }`, `notes.comparison.reason` starts `No full previous period`; current values are still filled.
  - `a previous value of zero reads new, both zero reads none`: previous period with no calls: `calls.change` is `{ kind: 'new' }`, `answerRate` previous `null` and `change none`; two empty periods give `none` everywhere.
  - `revenue counts booked calls only` and `unique callers ignore blank hashes` (one non-booked call with `revenueUsd` 0, one call with `callerHash ''`).
  - `top actions are the three views' headlines in fixed order`: `topActions.map(t => t.view)` is `['campaigns','locations','missed-calls']`; each `action` deep-equals the matching `buildX(...).actions[0]` on the same inputs; `actions` equals `topActions.map(t => t.action)`.
  - `nothing to suggest still lists every view`: a store with no campaigns' bookings and no flags gives `topActions` of `no_budget_shift`, `no_office_stands_out`, `no_missed_calls`, all `actionable false`; `templateSentence` is the first one's text.
  - `the template sentence is the first actionable top action`: Campaigns has no shift but Missed calls has a call-back: `templateSentence` equals the call-back text.
  - `the fact sheet merges tiles and top-action facts without collisions`: `Object.keys(factSheet.facts).length` equals the tile facts plus each top action's fact count; `overview.calls` formats as `'12 calls'`, `overview.calls_change` as `'+20.0%'`, `overview.answer_rate_change` as `'-5.0 points'`; `entities` is the union of the top actions' names, each once.
  - `a bad or unequal second range builds with no comparison`: previous `{ '2026-02-30', '2026-03-02' }` and a 3-day previous for a 7-day range both give `change none` on every tile, a `reason`, no throw, `expectAllFinite(view)`. (Review Focus 3)
  - `an empty range and an empty store build`: zeros, `answerRate.current null`, three "none" actions, `expectAllFinite(view)`. (Review Focus 4)
  - `notes pass through`: `notes.skippedRows`, `notes.outcomeLag` and `incompleteCurrent` match `makeViewContext` for the same inputs.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/core/views/overviewView.test.ts`
  Expected: FAIL, cannot resolve `../../../src/core/views/overviewView`.

- [ ] **Step 3: Implement `buildOverview` and `index.ts`.** Compute the three other views with the same `(store, range, previous)`. Tile change: `changeInCount` for counts and revenue, `changeInRate` for the answer rate, only when `notes.comparison.available`; otherwise `previous: null`, `change: { kind: 'none' }`. Merge facts with a plain object spread; the test above guards against a collision.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/core/views/overviewView.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/core/views/overviewView.ts src/core/views/index.ts tests/core/views/overviewView.test.ts
  git commit -m "feat: Overview view with tiles, changes and top actions from the other views

  Changes appear only against a full previous period; a view with nothing to suggest still says so in its slot.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 8: Shipped and extended exports, and the hard-coding guard

**Files:**
- Create: `tests/snapshot/original-export-views.test.ts`, `tests/snapshot/extended-export-views.test.ts`
- Modify: `tests/core/different-names.test.ts`

**Interfaces:**
- Consumes: the four builders from `src/core/views/index.ts`; `cleanExport`, `readExportFromDir`, `resolveRange`, `dataSpan` as in `tests/snapshot/extended-export.test.ts`.
- Produces: nothing new in `src/`.

- [ ] **Step 1: Write the tests.**
  - `original-export-views.test.ts` (shipped export from `tests/fixtures/original-export/`, range `all`):
    - `overview tiles match the known totals`: `calls.current 5000`, `bookings.current 1204`, `revenueUsd.current 432894`, `uniqueCallers.current 2040`; every `change` is `none` (all data has no comparison); `answerRate.current` between 0 and 1.
    - `campaigns: best and worst are the original's`: `rows.find(r => r.isBest)?.campaignId` is `'cmp_11'` and `isWorst` is `'cmp_07'`; the shift action text contains both campaign names read from `store.campaigns` (not typed in the test) and each row's `formatUsd(estimatedCostPerBookingUsd)`.
    - `campaigns: unattributed is 144 calls on 10 numbers`: `unattributed.calls 144`, `trackingNumbers` length `10`, and `actions` has `fix_attribution` as its second action.
    - `locations: nothing stands out`: every `answerFlag`/`bookingFlag` not flagged; `actions[0].kind` is `'no_office_stands_out'`.
    - `missed calls: the totals`: `unansweredCalls 1055`, heatmap `byOffice` totals and `byWeekday` totals both sum to `1055`, `lostValue.estimatedUsd` above 0, `callbacks.rows.length` at most the number of distinct unanswered callers, every row's `estimatedValueUsd` at least 0, the action is `call_back`. Record observed `callbacks.rows.length` and `callbacks.totalValueUsd` in an `OBSERVED` constant after the first run, as Phase 4 did.
    - `last 28 days compares with a full 28 days`: `buildOverview` with `last28`: `notes.comparison.available`, `previous` days 28, `calls.change.kind` is `'percent'` or `'new'`, never `none`.
    - `every view is finite and every action text has no unfilled placeholder` (`expectAllFinite`, no `{`).
  - `extended-export-views.test.ts` (`data/extended/`, range `all`; mirror the helpers in `extended-export.test.ts`):
    - `locations flags exactly the four known flags` using the view's own rows (`loc_02 booking worse`, `loc_04 booking better`, `loc_06 answer worse`, `loc_08 answer better`).
    - `the locations action is for a planted office`: `actions[0].kind` is `review_office_answer` or `review_office_booking`; its text names `Canyon Office` or `Riverside Office` (read the names from `store.locations`); record which in `OBSERVED.headline`. If it is the answer action, `link.locationId` is `'loc_06'`.
    - `missed calls filtered to Canyon`: `buildMissedCalls(store, all, undefined, { locationId: 'loc_06' })`: `officeFilter.name` is Canyon's name, `busiestSlot.weekday` 0 to 4 and `hour` 9 to 11, `unansweredCalls` is Canyon's unanswered count in range.
    - `campaigns over the last 28 days see the surge and the fade`: with a comparison available, `buildOverview` builds and `buildCampaigns` row calls for `cmp_04` equal `OBSERVED.surge.current` (342) and for `cmp_06` `OBSERVED.fade.current` (113), the numbers `extended-export.test.ts` already pins.
    - `every view is finite`.
  - `different-names.test.ts`: add a `describe('views on a different export')` using the existing `CAMPAIGNS`/`LOCATIONS` fixtures and a few calls spread over the Quokka and Wombat campaigns, the three offices, a missed call and an unattributed call: for `all` and `last7`, `buildOverview`, `buildCampaigns`, `buildLocations` and `buildMissedCalls` return without throwing, `expectAllFinite` holds, every action has a non-empty `text`, `buildCampaigns` rows are named `Quokka Promo` and `Wombat Weekend`, and `buildMissedCalls({ locationId: 'zz_lon' })` names `London Desk`. This is the PLAN.md "different-names fixture builds every view".

- [ ] **Step 2: Run them**

  Run: `npx vitest run tests/snapshot/original-export-views.test.ts tests/snapshot/extended-export-views.test.ts tests/core/different-names.test.ts`
  Expected: PASS. If a known total is off, stop and report it; do not adjust the expected numbers. If the hard-coding guard fails, a real date, name or `+1-555` has slipped into `src/core/views/`; fix the source.

- [ ] **Step 3: Run the whole suite and typecheck**

  Run: `npm test` then `npm run typecheck`
  Expected: all tests pass, no type errors. Show both outputs, then stop and wait for review.

- [ ] **Step 4: Commit**

  ```bash
  git add tests/snapshot/original-export-views.test.ts tests/snapshot/extended-export-views.test.ts tests/core/different-names.test.ts
  git commit -m "test: pin the four views on the shipped and extended exports and on a differently named one

  Shows the shipped data says 'nothing stands out' while the extended data names the planted offices, and that no view depends on this dataset's names.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

## Edge-case coverage (PLAN.md Phase 5 list)

| PLAN.md edge case | Test |
| --- | --- |
| fewer than two campaigns eligible for best/worst | Task 3: `fewer than two eligible campaigns marks nothing and says why`, and the equal-value case |
| no unattributed calls in range (no attribution action) | Task 3: `no unattributed calls in range means no attribution action` |
| no office flagged ("nothing stands out") | Task 4: `no office flagged gives the nothing-stands-out action`; Task 8 on the shipped export |
| office flagged better rather than worse | Task 4: `an office flagged better changes no action`; Task 8 extended flags |
| no missed calls in range | Task 6: `no missed calls in range` |
| caller who missed then got through (excluded) | Task 5: `a caller who missed and then got through is left out` and its variants |
| caller who got through, then missed (included) | Task 5: `a caller who got through and then missed is listed` |
| campaign too thin for its own rate (channel fallback) | Task 6: `a campaign too thin for its own rate uses its channel` |
| empty range | Tasks 3, 4, 6, 7 (each view) and Task 2 (context) |

## Self-review notes

- **Spec coverage:** 4.1 tiles and top actions (Task 7); 4.2 table, best/worst, weekly chart, both actions, Unattributed row (Task 3); 4.3 table, best campaign per office, outlier flag, three action sentences (Task 4); 4.4 heatmap both ways, lost value with formula, callback list with its rule, action and stated limit (Tasks 5, 6); 3.3 caveat flags returned by every view (Task 2). The CSV download, takeaway endpoint and 400s are Phase 6; the AI and checker are Phase 9. `Takeaway source` marker (3.3) is Phase 9.
- **Type consistency:** `ViewBase`, `ViewNotes`, `ViewContext` (Task 2) are used by Tasks 3, 4, 6, 7; `Action`, `Facts`, `makeAction`, `makeFactSheet`, `fillPlaceholders` (Task 1) by Tasks 3, 4, 6, 7; `MissedSlot` and `busiestMissedSlot` (Task 4) by Task 6; `CallbackList` (Task 5) by Task 6; fixtures from Task 2 are used by every later test file.
- **Proportion:** PLAN.md section 4 and Phase 5 together are about 110 lines; this plan is longer because it pins each sentence and fixture, which is the point of a test-first plan, but it holds no function bodies.
- **Not in this phase:** formatting for the UI beyond the action sentences (the UI may reuse `format.ts`), sorting a table by another column, the CSV writer, any 400 response, and per-view takeaway text.
