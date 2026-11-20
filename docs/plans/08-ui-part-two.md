# Phase 8 (UI part 2: Locations and Missed calls) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two "Not built yet" pages with the Locations view (table, outlier flags, best-campaign column, action) and the Missed calls view (heatmap with toggle, estimated lost value with its formula, callback list, CSV download), built on the Phase 7 shell.

**Architecture:** Same split as Phase 7. Every decision (copy, order, blanks, heat step, what is hidden when empty) lives in a **pure TypeScript model** in `src/web/models/` that vitest tests in Node. Components in `src/web/components/` take a model and print it. The browser prints the API's numbers, formatted by the existing `format` functions; it computes no metric. No new package: the heatmap is an HTML `<table>`, not a Recharts chart.

**Tech Stack:** TypeScript (strict), React, vitest, `react-dom/server` for render tests. Nothing new to install.

**Spec:** `PLAN.md` (sections 3.3, 4.3, 4.4, 8 "Web", Phase 8 in section 9), `docs/BRIEF.md`, `CLAUDE.md`, `docs/plans/07-ui-part-one.md` (the shell, models and tests this phase extends), `src/core/views/locationsView.ts`, `src/core/views/missedCallsView.ts`, `src/core/views/callbacks.ts` (the JSON shapes), `src/server/app.ts` and `src/server/csv.ts` (the endpoints).

## Global Constraints

- Work **one task at a time**. After the last task run `npm test`, `npm run typecheck` and `npm run build`, run the click-through checklist at the end of this file, show the results, then **stop** and wait (CLAUDE.md).
- **No new dependency.** If one seems needed, stop and ask.
- Phase 8 done-when, from PLAN.md: the click-through checklist passes on the shipped **and** the extended data: the flag appears where the extended data plants it and "nothing stands out" appears on the original; the Locations action links to Missed calls filtered to that office; the CSV downloads and opens correctly.
- **Every number the user sees comes from code.** Metrics (counts, rates, dollars, estimates) are the API's, formatted with `src/core/views/format.ts` (`formatUsd`, `formatRate`, `formatCount`, `formatHour`, `formatWeekday`); the browser never recomputes one. Display arithmetic (a heat colour step, page numbers and row ranges) is fine in a pure, tested model.
- The app works with AI off and no key. This phase shows no takeaway (Phase 9's).
- Nothing hard-coded to this dataset: no campaign, office or channel names, tracking numbers or real dates in `src/web/`. Tests may name `loc_06` and friends; `src/` may not. `tests/core/different-names.test.ts` scans `src/` and `index.html`.
- Dates are `YYYY-MM-DD` strings; `lastAttemptLocal` is `YYYY-MM-DD HH:mm` already in the office's zone and is printed as sent, never through `new Date`. `CallbackRow.lastAttemptAt` is a `Date` in core and an ISO string in JSON; **the web never reads it**.
- Estimates are labeled "est." wherever shown, with the formula one click away (PLAN.md 3.3). Caveats sit inline on the view they affect.
- No raw colour or duration literals outside `src/web/styles/tokens.css` (the Phase 7 guard enforces it). Heat colours are tokens; meaning is never colour alone (each heat cell prints its count).
- Names and text from the data are rendered as text only: no `dangerouslySetInnerHTML`. Long unbroken names wrap in table cells.
- Never read, print or `git add` `.env`. Do not write to `docs/AI_COST_LOG.md` (it has uncommitted edits of yours) or edit `docs/BRIEF.md`. `PLAN.md` and `docs/plans/06-server.md`, `07-ui-part-one.md` also have uncommitted edits of yours: stage files by name, never `git add -A`, and never stage those.
- Commit after each task, small, message says why, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Prefer simple, readable code; a reviewer will walk through all of it. Before writing the heatmap, read the `dataviz` skill.

## Gaps in PLAN.md this plan fills

PLAN.md is silent on these; the plan just decides them. Only the first two are real decisions, and both are in `docs/DECISIONS.md`.

1. **The callback list is paginated** (25 rows a page, Previous and Next, "Rows 26–50 of 445"). The page is local state, not URL state. The CSV always holds every row.
2. **Locations is sortable by any column**, like Campaigns, defaulting to calls descending.
3. The Missed calls office filter gets a picker (`All offices` plus every office) and `location` is URL state like `campaign`; picking one keeps the last reply on screen, marked "Updating…", so the picker keeps focus (`keepPreviousFor` treats `location` like `campaign`). The heatmap's office/weekday toggle is local.
4. A heat colour is one of five steps from `heatLevel(count, max)`, with token colours of tested contrast; each cell also prints its count.
5. Two lines of copy: callers are checked against calls up to the last data day, so anyone who got through later is still listed; and tracking numbers start with an apostrophe in the CSV so a spreadsheet keeps them as text.
6. Locations and Missed calls pass `comparing: false` to `caveatsFor`, since they show no comparison. Locations shows every flag with direction and both rates, "better" included; only a "worse" flag drives the action (Decisions 56, 60, 64). On the extended export that is four flags, not one.
7. `ComingSoon` and its test are deleted.

## Review Focus

Inputs the spec implies but no listed edge case names. Each has a test in the owning task.

1. **A hand-edited or stale office id** (`?view=missed-calls&location=nope`, or an office id with `&` and a space): the server says 400 `unknown_location`; the page shows that message with a Reset link that drops the bad id, never a blank page; a legal id with special characters round-trips through the URL and the CSV link. (Tasks 1, 6)
2. **A filtered office with no missed calls** (valid id, zero misses): "No calls went unanswered at {office} in this range.", no empty heatmap or table, no download button. (Tasks 4, 6)
3. **The callback list is long, and the page can go stale:** pages of 25 with an honest "Rows 26–40 of 40"; a page number past the end (after the data shrinks) clamps instead of showing an empty table; changing the range or office returns to page 1; the CSV link carries the same range and office as the screen so the file matches what is on screen. (Tasks 1, 4, 6)
4. **Office names that are markup or 300 characters with no spaces** in the Locations table, the heatmap row labels, the office picker and the callback table: shown whole, as text. (Tasks 2, 3, 4, 6)
5. **Offices too small to test:** most real exports have offices under the outlier minimum. They must read "Too few calls to compare", not look like a clean bill of health. (Task 2)

---

## File Structure

```
src/web/urlState.ts                    (modify) withLocation, csvHref
src/web/models/keepPrevious.ts         (modify) location counts like campaign
src/web/models/locationsModel.ts       locationsModel
src/web/models/heatmapModel.ts         heatLevel, heatmapModel
src/web/models/missedCallsModel.ts     missedCallsModel, CALLBACK_PAGE_SIZE
src/web/components/LocationsView.tsx   LocationsView, LocationTable
src/web/components/MissedCallsView.tsx MissedCallsView (office picker, lost value, download, notes)
src/web/components/Heatmap.tsx         Heatmap (toggle + table)
src/web/components/CallbackTable.tsx   CallbackTable
src/web/components/ComingSoon.tsx      (delete)
src/web/App.tsx                        (modify) all four views are real
src/web/styles/tokens.css              (modify) heat tokens
src/web/styles/base.css                (modify) heatmap and the new tables, tokens only
tests/web/fixtures.ts                  (modify) locationsFor, missedCallsFor, planted and idle-office stores
tests/web/urlState.test.ts             (modify)
tests/web/screen.test.ts               (modify) keepPrevious cases live here
tests/web/tokens.test.ts               (modify) contrast for the heat pairs
tests/web/locationsModel.test.ts, heatmapModel.test.ts, missedCallsModel.test.ts
tests/web/real-exports.test.ts         Locations and Missed calls models on the shipped and extended data
tests/web/csv-link.test.ts             the web's CSV link against the real app
tests/web/render.test.tsx              (modify) remove ComingSoon, add the new components
README.md                              (modify)
docs/DECISIONS.md                      (modify) already holds this plan's two decisions
```

---

### Task 1: URL helpers and the keep-previous rule

**Files:**
- Modify: `src/web/urlState.ts`, `src/web/models/keepPrevious.ts`, `tests/web/urlState.test.ts`, `tests/web/screen.test.ts`

**Interfaces:**
- Consumes: Phase 7 `UrlState`, `apiParams`, `toSearch`, `keepPreviousFor`.
- Produces:
  ```ts
  export function withLocation(state: UrlState, id: string | null): UrlState;   // like withCampaign
  export function csvHref(state: UrlState): string;
  //   '/api/missed-calls/callbacks.csv' + ('?' + apiParams(state, 'missed-calls') when not empty)
  ```
  `keepPreviousFor(previousKey, nextKey)` is true when the path and every parameter other than `campaign` and `location` are equal, and `campaign` or `location` differs. (Paths differ per view, so each view only ever varies its own.)

- [ ] **Step 1: Write the failing tests.**
  - `urlState.test.ts`:
    - `withLocation sets and clears`, and keeps view, range, compare, campaign and dev.
    - `csvHref`: default state gives exactly `/api/missed-calls/callbacks.csv` (no `?`); preset `last7` plus `location 'loc_a'` gives `/api/missed-calls/callbacks.csv?range=last7&location=loc_a`; a custom range carries `start` and `end`; `view`, `dev` and `campaign` never appear; an id `a&b c` is percent-encoded and decodes back to `a&b c` through `new URL(href, 'http://x').searchParams` (Review Focus 1, 3).
    - `a link to Missed calls for an office with special characters round-trips`: `parseUrlState(search of actionHref(state, { view: 'missed-calls', locationId: 'a&b c' })).location` is `a&b c`.
    - `defaultsHref from Missed calls drops the office`: state `{ view: 'missed-calls', location: 'nope', dev: true }` gives `/?view=missed-calls&dev` (Review Focus 1).
  - `screen.test.ts`, in `keepPreviousFor`: `/api/missed-calls?range=last28&location=a#0` to `...location=b#0` is true; from no location to `b` is true; from `a` to none is true; a range change, a comparison change, a retry-only change, and a switch to `/api/overview` are false; in `displayState`, a loading key differing only by `location` keeps the old data with `busy: true`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/web/urlState.test.ts tests/web/screen.test.ts`
  Expected: FAIL (`withLocation` and `csvHref` do not exist; the location cases return false).

- [ ] **Step 3: Implement.** In `keepPrevious.ts`, `parts()` removes both `campaign` and `location` from the params and returns them joined as one `filters` string; the comparison is `before.filters !== next.filters`. Keep the existing behavior for `campaign`.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/web/urlState.test.ts tests/web/screen.test.ts`
  Expected: PASS, including every Phase 7 case unchanged.

- [ ] **Step 5: Commit**

  ```bash
  git add src/web/urlState.ts src/web/models/keepPrevious.ts tests/web/urlState.test.ts tests/web/screen.test.ts
  git commit -m "feat: URL helpers for the office filter and the CSV link; keep the screen while the office changes

  The Locations action links to Missed calls for one office, so the office is URL state like the campaign; picking one must not unmount the screen.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 2: Fixtures and the Locations model

**Files:**
- Modify: `tests/web/fixtures.ts`
- Create: `src/web/models/locationsModel.ts`, `tests/web/locationsModel.test.ts`

**Interfaces:**
- Consumes: `LocationsView`, `LocationRow`, `OutlierResult` (type-only); `Cell` from `campaignsModel`; `BLANK`, `humanize`-style helpers from `src/web/format.ts`; `formatRate`, `formatCount`, `formatUsd`; `ActionLink`, `ActionKind`; `VIEW_LABELS`.
- Produces:
  ```ts
  // tests/web/fixtures.ts (queryFor now takes the wants object so a missed-calls query can carry `location`)
  export function locationsFor(search: string, store?: CallStore): LocationsView;       // real buildLocations as JSON
  export function missedCallsFor(search: string, store?: CallStore): MissedCallsView;   // search may carry location=
  export function plantedStore(kind: 'answer-worse' | 'booking-worse' | 'better-only' | 'none'): CallStore;
  export function idleOfficeStore(): CallStore;   // 14 days; loc_a calls daily; loc_b only on 2026-09-01; loc_c never. Range 2026-09-08..14 leaves b and c with zero calls.

  // locationsModel.ts
  export type LocationColumnKey = 'name' | 'calls' | 'answerRate' | 'bookings' | 'bookingRate' | 'revenueUsd' | 'bestCampaign';
  export interface LocationFlagModel { metric: 'answer' | 'booking'; direction: 'better' | 'worse'; text: string }
  export interface LocationRowModel {
    id: string; name: string;
    cells: Record<LocationColumnKey, Cell>;
    flags: LocationFlagModel[];          // flagged metrics only, answer first
    flagNote: string | null;             // set exactly when flags is empty
  }
  export interface LocationsModel {
    empty: boolean;                      // every office has 0 calls (also when there are no offices)
    columns: { key: LocationColumnKey | 'flags'; label: string; numeric: boolean }[];
    rows: LocationRowModel[];            // sorted by `sort`
    action: { kind: ActionKind; text: string; actionable: boolean; link: ActionLink; linkLabel: string };
    flagsNote: string;                   // fixed explanation under the table
  }
  export type LocationSortKey = LocationColumnKey;
  export interface LocationSort { key: LocationSortKey; dir: 'asc' | 'desc' }
  export const DEFAULT_LOCATION_SORT: LocationSort;                           // calls, desc
  export function nextLocationSort(current: LocationSort, key: LocationSortKey): LocationSort;   // same key flips; name and bestCampaign start asc, the rest desc
  export function sortLocationRows(rows: LocationRow[], sort: LocationSort): LocationRow[];     // pure, returns a copy
  export function locationsModel(view: LocationsView, sort: LocationSort): LocationsModel;
  ```
  Sorting reads the API's raw values, never the formatted text: `bestCampaign` sorts by the best campaign's name (case-insensitive); a null rate or null best campaign sorts last in both directions; ties break by office id ascending; the flags column is not sortable. If this is the same comparison `sortCampaignRows` uses, extract one small helper in `src/web/models/sorting.ts` and have both call it, with the Campaigns tests unchanged.
  Exact copy. Column labels: `Office`, `Calls`, `Answer rate`, `Bookings`, `Booking rate`, `Revenue`, `Best campaign there`, `Compared with other offices`. Cells: calls and bookings `formatCount`; rates `formatRate`; revenue `formatUsd`; best campaign `` `${name} (${formatRate(bookingRate)} booked, ${formatCount(calls, ['call','calls'])})` ``. A blank cell is `BLANK` with a `note`: a null rate (no calls) `No calls in this range.`; a null best campaign with calls `No campaign has enough calls at this office to name a best one.`, with no calls `No calls in this range.` Flag text: `` `${Metric} ${direction}: ${formatRate(officeRate)} here, ${formatRate(restRate)} at other offices.` `` with Metric `Answer rate` or `Booking rate`. `flagNote` when nothing is flagged: office has 0 calls `No calls in this range.`; not eligible (`!answerFlag.eligible`) `Too few calls to compare.`; eligible `In line with other offices.` `flagsNote`: `Each office is compared with all other offices pooled. Only offices with enough calls are tested, and a difference is flagged only when chance does not explain it.` Action: `text`, `kind`, `actionable`, `link` pass through from `actions[0]`; `linkLabel` is `` `See ${VIEW_LABELS[view]}` `` plus `` ` for ${officeName}` `` when `link.locationId` is set (the office's name from `rows`, else the id).

- [ ] **Step 1: Write the failing tests** (data through `locationsFor` and the planted stores; assert on values read from the JSON, not retyped numbers). Build each planted store with the shapes of the matching test in `tests/core/views/locationsView.test.ts` (lines 60, 92, 116, 128), so the flag outcome is already proven in core.
  - `columns`: the eight columns in order, the last one not sortable.
  - `sorting`: `DEFAULT_LOCATION_SORT` order equals the API's row order (calls descending, ties by id); sort by `name` ascending is case-insensitive; by `answerRate` descending and ascending both leave null-rate offices last; by `bestCampaign` leaves offices with none last; ties break by office id; the input array is not mutated; `nextLocationSort(DEFAULT_LOCATION_SORT, 'calls')` flips to ascending, `name` and `bestCampaign` start ascending, `revenueUsd` descending.
  - `cells print the API's values`: for the `answer-worse` store each cell equals the matching `format*` of the JSON field.
  - `a worse answer rate is flagged with both rates`: one row has `flags[0].metric 'answer'`, `direction 'worse'`, text equal to the copy above built from that row's `answerFlag.officeRate` and `restRate`; its `flagNote` is `null`; every other row has no worse flag.
  - `a worse booking rate`: `booking-worse` store gives a `Booking rate worse: ...` flag and the action's `link.view` is `campaigns`.
  - `better flags show and never become the action` (Decision 64): `better-only` has `direction 'better'` flags with text `Answer rate better: ...`; the action `kind` is `no_office_worse`.
  - `nothing stands out`: `none` store (every office eligible, none flagged): every row `flagNote` `In line with other offices.`; action kind `no_office_stands_out`, `link` `{ view: 'missed-calls' }`, `linkLabel` `See Missed calls`.
  - `too few calls is not a clean bill of health` (Review Focus 5): on `serverFixture()` (14 calls per office) every `flagNote` is `Too few calls to compare.`.
  - `an office with no calls in range` (PLAN.md edge case): `idleOfficeStore()` with `range=2026-09-08..14` (use `start=`/`end=`): `loc_c` and `loc_b` rows have `calls` `0`, rate cells `BLANK` with the `No calls in this range.` note, best campaign `BLANK` with that note, `flags` empty, `flagNote` `No calls in this range.`; `empty` is false while `loc_a` has calls; with a range where every office is idle (hand-edited copy of the JSON with every row's calls set to 0), `empty` is true; `rows: []` is `empty` true.
  - `linkLabel names the office`: the `answer-worse` action link carries `locationId`; `linkLabel` is `See Missed calls for ${thatOfficeName}`.
  - `blank is never infinity or NaN`: across every cell and flag text on every planted store, no `Infinity`, `NaN` or `undefined`.
  - `long and markup names stay whole` (Review Focus 4): names of 300 characters with no spaces and `<img src=x onerror=alert(1)>` are returned unchanged in `name`, in the best-campaign cell and in `linkLabel`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/web/locationsModel.test.ts`
  Expected: FAIL, cannot resolve `../../src/web/models/locationsModel`.

- [ ] **Step 3: Implement** `locationsModel.ts` and the fixture helpers. No arithmetic: every value is formatted from an API field. Move nothing out of `tests/core`; import `officeCalls`, `makeStore`, `office`, `campaign` from `tests/core/views/fixtures`.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/web/locationsModel.test.ts` then `npx vitest run tests/web`
  Expected: PASS, and every earlier web test still passes.

- [ ] **Step 5: Commit**

  ```bash
  git add tests/web/fixtures.ts src/web/models/locationsModel.ts tests/web/locationsModel.test.ts
  git commit -m "feat: Locations view model: flags with both rates, blanks with reasons, link label

  A small office reads 'too few calls', not 'fine'; the action never comes from a better-than-average flag.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 3: Heatmap model

**Files:**
- Create: `src/web/models/heatmapModel.ts`, `tests/web/heatmapModel.test.ts`

**Interfaces:**
- Consumes: `MissedCallsView['heatmap']` (type-only); `formatCount`, `formatHour`, `formatWeekday`.
- Produces:
  ```ts
  export type HeatmapMode = 'office' | 'weekday';
  export type HeatLevel = 0 | 1 | 2 | 3 | 4;
  export function heatLevel(count: number, max: number): HeatLevel;
  //   0 when count <= 0, max <= 0 or either is not finite; else min(4, max(1, ceil(count / max * 4))).
  export interface HeatCell { text: string; level: HeatLevel; label: string }
  //   text: formatCount(count), or '' when count is 0. label: `${row label}, ${formatHour(hour)}: ${formatCount(count, ['missed call','missed calls'])}`
  export interface HeatRow { key: string; label: string; cells: HeatCell[]; total: string }   // total: formatCount(row.total)
  export interface HeatmapModel { mode: HeatmapMode; hourLabels: string[]; rows: HeatRow[]; empty: boolean }
  //   hourLabels: '00' to '23'. One max over every cell of the chosen mode. rows: byOffice in API order, or byWeekday Monday first with formatWeekday labels. empty: no row has a count.
  export function heatmapModel(heatmap: MissedCallsView['heatmap'], mode: HeatmapMode): HeatmapModel;
  ```

- [ ] **Step 1: Write the failing tests.**
  - `heatLevel`: `(0, 10)` 0; `(1, 10)` 1; `(3, 10)` 2; `(10, 10)` 4; `(5, 5)` 4; `(1, 1)` 4; `(7, 0)` 0; `(0, 0)` 0; `(-1, 5)` 0; `(11, 10)` 4; `(NaN, 5)`, `(5, Infinity)`, `(5, NaN)` all 0. A smallest positive count is never 0 (it never reads as empty).
  - `a zero cell` (PLAN.md edge case): a cell with count 0 has `text ''`, `level 0`, and a `label` ending `0 missed calls`; a count of 1 ends `1 missed call`.
  - `office mode`: rows in API order with the office name as `label`, 24 cells each, `hourLabels` 24 entries `00`..`23`, `total` the API's row total formatted.
  - `weekday mode`: seven rows `Monday`..`Sunday` in order.
  - `one scale per mode`: the cell holding the largest count in the chosen mode has level 4, whichever row it is in; a row whose counts are all lower than the global max never reaches 4.
  - `a filtered office` (one `byOffice` row) works; `empty` true and every level 0 when all counts are 0.
  - `names stay whole`: a 300-character unbroken office name and `<b>x</b>` pass through `label` unchanged (Review Focus 4).
  - `no Infinity, NaN or undefined` in any `text`, `label`, `total`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/web/heatmapModel.test.ts`
  Expected: FAIL, cannot resolve.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/web/heatmapModel.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/web/models/heatmapModel.ts tests/web/heatmapModel.test.ts
  git commit -m "feat: heatmap model with five colour steps; a zero cell is empty, never a faint number

  Steps rather than a continuous scale keep the legend honest and the contrast testable; the printed counts stay the API's.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 4: Missed calls model

**Files:**
- Create: `src/web/models/missedCallsModel.ts`, `tests/web/missedCallsModel.test.ts`

**Interfaces:**
- Consumes: `MissedCallsView`, `CallbackRow` (type-only); `Cell`; `formatUsd`, `formatCount`; `formatLongDate`, `BLANK`; `DateRange`.
- Produces:
  ```ts
  export const CALLBACK_PAGE_SIZE = 25;
  export interface CallbackRowModel { key: string; cells: string[] }          // key: callerHash; cells in column order
  export interface MissedCallsModel {
    filterLabel: string | null;             // `Showing ${name} only.`; `Showing office ${id} only.` when the name is null
    noMissed: string | null;                // set when unansweredCalls is 0; the view then shows only this, the action and the picker
    unanswered: string;                     // formatCount(unansweredCalls, ['unanswered call','unanswered calls'])
    lostValue: { label: string; value: string; note: string; formula: string; sources: string[] };
    callbacks: {
      summary: string;
      columns: { label: string; numeric: boolean; estimate: boolean }[];
      rows: CallbackRowModel[];             // the current page, API order
      pager: { page: number; pages: number; label: string; hasPrevious: boolean; hasNext: boolean } | null;   // null when everything fits on one page
      emptyNote: string | null;             // set when the API has no callback rows
      canDownload: boolean;                 // API rows > 0
      downloadNote: string;
    };
    unidentifiedNote: string | null;
    reachNote: string;
    limitNote: string;                      // the API's limitNote, unchanged
    action: { kind: ActionKind; text: string; actionable: boolean };
  }
  export function missedCallsModel(view: MissedCallsView, span: DateRange, page?: number): MissedCallsModel;   // page is 1-based, default 1; out of range clamps to the first or last page
  ```
  Exact copy. `noMissed`: `No calls went unanswered in this range.`, or with a filter `` `No calls went unanswered at ${name} in this range.` ``. Lost value: `label` `Est. lost value`, `value` `formatUsd(estimatedUsd)`, `formula` the API's `lostValue.formula` unchanged, `note` `This covers every unanswered call in range. The call-back list is smaller: a caller who got through later is left out, and each caller counts once.`, `sources` one string per source above zero: `` `${formatCount(n, ['call','calls'])} valued at their campaign's rates` ``, `... at their channel's rates`, `... at the overall rates`. Callbacks: `summary` `` `${formatCount(rows, ['caller','callers'])} to call back, est. ${formatUsd(totalValueUsd)} in bookings.` `` (rows = the API's full count); columns `Caller`, `Unanswered calls in range`, `Last attempt (office local time)`, `Office`, `Campaign`, `Tracking number`, `Est. value` (the last has `estimate: true`; the second and last are numeric); cells `callerHash`, `formatCount(unansweredAttempts)`, `lastAttemptLocal`, `officeName`, `campaignName`, `trackingNumber`, `formatUsd(estimatedValueUsd)`. `pager` when the API has more than 25 rows: `page` is the clamped page, `pages` the page count, `label` `` `Rows ${formatCount(from)}–${formatCount(to)} of ${formatCount(total)}, highest value first. The CSV has all of them.` `` (en dash). `emptyNote` `No one to call back from this range.` `downloadNote` `The file has every caller, one per row. Tracking numbers start with an apostrophe so a spreadsheet keeps them as text.` `unidentifiedNote` when `unidentifiedUnanswered > 0`: `` `${formatCount(n, ['unanswered call','unanswered calls'])} had no caller number, so ${n === 1 ? 'that caller' : 'those callers'} cannot be listed.` `` else `null`. `reachNote`: `` `Callers are checked against calls up to ${formatLongDate(span.end)}, the last day in the data. Anyone who got through after that is still listed.` `` Action from `actions[0]`.

- [ ] **Step 1: Write the failing tests** (data via `missedCallsFor` on `serverFixture()` and hand-built stores; hand-edited copies of real JSON where noted).
  - `lost value`: `value` equals `formatUsd(view.lostValue.estimatedUsd)`; `label` contains `est.` case-insensitively; `formula` is the API's string byte for byte (the formula is never retyped); `sources` lists only sources above zero and sums nothing.
  - `callbacks print the API's values`: the first row's cells equal the formatted JSON fields; `lastAttemptLocal` appears exactly as sent (`YYYY-MM-DD HH:mm`), and the model never reads `lastAttemptAt`: delete that field from every row of a copy and the model's output is unchanged.
  - `summary and total`: `summary` uses the API's `totalValueUsd` and the full row count on every page.
  - `pagination` (Review Focus 3): a copy with 40 rows: page 1 has rows 1 to 25 in API order, `label` `Rows 1–25 of 40, highest value first. The CSV has all of them.`, `hasPrevious` false, `hasNext` true, `pages` 2; page 2 has the last 15, `Rows 26–40 of 40...`, `hasNext` false; page 0, -3 and `NaN` give page 1; page 99 gives page 2; exactly 25 rows gives `pager` null; 26 gives 2 pages with a 1-row second page (`Rows 26–26 of 26`); `summary` always uses the full count and total value, not the page's.
  - `an empty callback list` (PLAN.md edge case): a store whose every missed caller got through later (use the shape from `tests/core/views/callbacks.test.ts`'s "missed then got through" case): `rows` empty, `emptyNote` set, `canDownload` false, `summary` still defined without NaN.
  - `no missed calls` (PLAN.md edge case): `unansweredCalls` 0 gives `noMissed` set and `canDownload` false; with an office filter the sentence names the office; with `officeFilter: { locationId: 'x', name: null }` it says `office x`.
  - `a filtered office with no missed calls` (Review Focus 2): the real view for a valid office with zero misses in the range (an office with only answered calls in `serverFixture`'s `loc_a`): `filterLabel` `Showing Office A only.`, `noMissed` names `Office A`.
  - `unidentified callers`: `1` gives `that caller cannot`, `3` gives `those callers cannot`; `0` gives `null`; with no rows and `unidentifiedUnanswered > 0` both `emptyNote` and `unidentifiedNote` are set.
  - `reach note` carries `formatLongDate(span.end)` (`Oct 29, 2026` for a span ending `2026-10-29`) and is present on every view.
  - `limit note` equals the API's `limitNote` unchanged.
  - `download note` always mentions the apostrophe.
  - `names and hashes stay whole` (Review Focus 4): a 300-character unbroken office and campaign name and `<img src=x onerror=alert(1)>` come back unchanged in the callback cells and in `filterLabel`.
  - `blank is never infinity or NaN`: no `Infinity`, `NaN` or `undefined` in any string of the model, on the fixture and on the zero-miss and empty-list cases.
  - `action passes through`: `kind`, `text`, `actionable` equal `actions[0]`; `no_missed_calls` has `actionable false`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/web/missedCallsModel.test.ts`
  Expected: FAIL, cannot resolve.

- [ ] **Step 3: Implement.** Row counts come from `.length` and `slice`; no metric is computed.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/web/missedCallsModel.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/web/models/missedCallsModel.ts tests/web/missedCallsModel.test.ts
  git commit -m "feat: Missed calls view model: estimate with its formula, a paged callback list, honest empty states

  The list is only 'never got through' up to the last data day, and the file differs from the screen on tracking numbers; both are said on the page.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 5: Heat tokens, components, App wiring

**Files:**
- Create: `src/web/components/LocationsView.tsx`, `MissedCallsView.tsx`, `Heatmap.tsx`, `CallbackTable.tsx`
- Delete: `src/web/components/ComingSoon.tsx`
- Modify: `src/web/App.tsx`, `src/web/styles/tokens.css`, `src/web/styles/base.css`, `tests/web/tokens.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 4; Phase 7 `Caveats`, `Link`, `RequestFrame`, `caveatsFor`, `actionHref`, `csvHref`, `withLocation`, `displayState`.
- Produces (props only; no component fetches or decides):
  ```ts
  LocationsView({ view: LocationsData; state: UrlState; span: DateRange })      // owns the sort in useState(DEFAULT_LOCATION_SORT)
  LocationTable({ model: LocationsModel; sort: LocationSort; onSort(key: LocationSortKey): void })   // exported for render tests
  MissedCallsView({ view: MissedCallsData; state: UrlState; span: DateRange; offices: Meta['locations']; busy?: boolean; onSelectOffice(id: string | null): void })
  Heatmap({ model: HeatmapModel; mode: HeatmapMode; onModeChange(mode: HeatmapMode): void })
  CallbackTable({ model: MissedCallsModel['callbacks']; onPage(page: number): void })   // exported for render tests
  ```
  Tokens: `--color-heat-0` to `--color-heat-4` (a one-hue ramp from the panel colour up, six-digit hex), `--color-heat-ink` (text on steps 0 to 2), `--color-heat-ink-inverse` (text on steps 3 and 4).
  **LocationsView:** `Caveats` from `caveatsFor(view.notes, span, { comparing: false, range: view.range })`; an **Action** section with the model's `text` (muted when not actionable) and a `Link` (`actionHref(state, action.link)`) labelled `linkLabel`; when `empty`, `No calls in this range.` replaces the table; else the `LocationTable` then `flagsNote`. **LocationTable:** one `<table>`; headers are buttons with `aria-sort` on the sorted column (the flags column is plain text), as in `CampaignTable`; a blank cell shows `BLANK` and its note as `title` plus visually hidden text (as `CampaignTable` does); the last column prints each flag as `Better`/`Worse` text badge plus the flag text (tone class from direction, never colour alone), or the `flagNote` muted; `name` cells carry `title={name}`.
  **MissedCallsView:** `Caveats` (`comparing: false`); the action section; an office `<select>` (`All offices` with value `''`, then `offices`; value `state.location ?? ''`; change calls `onSelectOffice(value || null)`); `filterLabel`; when `busy`, `Updating…` with `role="status"` and `aria-busy` on the section; when `noMissed`, only that sentence (`role="status"`) and `limitNote`; else: `unanswered`; the **heatmap** section (toggle state is local `useState<HeatmapMode>('office')`; caption `Hours are local to each office.`); the **lost value** block (label, value, `note`, `sources`, and one `<details>` "How this estimate works" holding `formula`); the **callback list** section (`summary`, `unidentifiedNote`, table (with its pager) or `emptyNote`, and when `canDownload` a plain `<a href={csvHref(state)} download>` "Download CSV" plus `downloadNote`); `reachNote` and `limitNote` under the list. **Heatmap:** two buttons `By office`, `By weekday` with `aria-pressed`; a `<table>` with a `<caption>` (visually hidden), column headers `hourLabels`, row headers `label`, a final `total` column; each cell prints `text`, carries `data-level`, class from `level`, and `title`/visually hidden `label`; scrolls inside `.table-wrap`; a legend of the five steps labelled `Fewer` to `More missed calls`. **CallbackTable:** one `<table>`, `estimate` header contains `est.`, cells as text, long values wrap; when `pager` is set, `Previous` and `Next` buttons (disabled at the ends) and `pager.label`, calling `onPage(page - 1)` or `onPage(page + 1)`. **MissedCallsView** keeps the page in local state and passes it to `missedCallsModel`; the state is keyed on the range and office, so changing either returns to page 1.
  **App:** every view is real; delete the `hasView` and `ComingSoon` branch; the request is always made; the render callback picks the view with `state.view`; Missed calls gets `offices={meta.locations}`, `busy={shown.busy}` and `onSelectOffice={(id) => navigate(withLocation(state, id))}`.

- [ ] **Step 1: Extend the contrast test first.** In `tests/web/tokens.test.ts` add to the `text` pairs: `--color-heat-ink` on `--color-heat-0`, `-1`, `-2`; `--color-heat-ink-inverse` on `--color-heat-3`, `-4`; to `nonText`: `--color-heat-1`..`4` on `--color-panel` at 3:1 (a filled step must be visible against the panel). Add a test that the five heat tokens are declared. Run it; it fails (no tokens).

  Run: `npx vitest run tests/web/tokens.test.ts`
  Expected: FAIL.

- [ ] **Step 2: Implement** the tokens, the four components, the App change and `base.css` (tokens only; `overflow-wrap: anywhere` on table cells; heat classes `heat-0`..`heat-4` set `background` and `color` from the tokens; the heatmap table is as wide as 24 hour columns need and scrolls inside its wrapper).

- [ ] **Step 3: Verify**

  Run: `npx vitest run tests/web/tokens.test.ts` then `npm run typecheck`, `npm test`, `npm run build`
  Expected: the token tests pass (raw-value guard, `var()` defined, contrast); no type errors; every test passes except the Phase 7 `ComingSoon` render test, which fails to import: delete that test in Task 6 and, to keep this commit green, delete it now in `tests/web/render.test.tsx` together with its import.

  Run: `PORT=3917 npm start` in the background; open `/?view=locations&range=all` and `/?view=missed-calls&range=last28`; stop the server. Check by eye that both render and the numbers match `curl -s .../api/locations?range=all` and `.../api/missed-calls?range=last28`. The full click-through is Task 7.

- [ ] **Step 4: Commit**

  ```bash
  git add src/web/components/LocationsView.tsx src/web/components/MissedCallsView.tsx src/web/components/Heatmap.tsx src/web/components/CallbackTable.tsx src/web/App.tsx src/web/styles/tokens.css src/web/styles/base.css tests/web/tokens.test.ts tests/web/render.test.tsx
  git rm src/web/components/ComingSoon.tsx
  git commit -m "feat: Locations and Missed calls screens replace the placeholders

  Heat colours are tokens with a tested contrast; each cell also prints its count, so colour is never the only signal.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 6: Render tests, real-export tests, the CSV link

**Files:**
- Modify: `tests/web/render.test.tsx`
- Create: `tests/web/real-exports.test.ts`, `tests/web/csv-link.test.ts`

**Interfaces:**
- Consumes: the components from Task 5; models from Tasks 2 to 4; `cleanExport`, `readExportFromDir`, `resolveRange`, `dataSpan`; `createApp` (`src/server/app.ts`); `get` from `tests/server/helpers.ts`.
- Produces: nothing.

- [ ] **Step 1: Write the render tests** in `render.test.tsx` (string markup, helpers `esc`, `count`, `rowsOf` already there).
  - `LocationTable` (PLAN.md edge cases; planted and idle stores): a flagged row prints a `Worse` badge and the flag text in words; a `better` flag prints `Better`; an office with no calls renders dashes with their notes, `No calls in this range.` in the flag column, and no `Infinity`, `NaN` or `undefined` anywhere; an ineligible office reads `Too few calls to compare.`; sort headers are buttons and the default-sorted one has `aria-sort="descending"`, the flags header has none; a 300-character name appears whole in markup and in `title`; `<img src=x onerror=alert(1)>` appears as `&lt;img` and the markup has no `<img` (Review Focus 4).
  - `LocationsView`: the action text and a link whose `href` equals `actionHref(state, action.link)`; for the `answer-worse` store that href is `/?view=missed-calls&range=all&location=<id>` (the office id from the JSON) and keeps `&dev` when `dev` is on; an `empty` view prints `No calls in this range.` and no `<table`; `flagsNote` shows under the table; caveats appear (first-day note for a range including it) and **no previous-period caveat appears even with an unusable comparison in the URL** (the view passes `comparing: false`).
  - `Heatmap`: the zero cell has class `heat-0`, empty text and a visually hidden `0 missed calls`; the busiest cell has `data-level="4"`; the `By office` button is `aria-pressed="true"` when `mode` is `office` and `By weekday` is `false`, and the reverse for `weekday`; `weekday` mode renders seven rows; a filtered single-office model renders one row; the legend is present; office names escaped (Review Focus 4).
  - `CallbackTable`: 25 body rows on page 1 of a 40-row list, 15 on page 2; `Previous` is `disabled` on page 1 and `Next` on the last page; no pager markup for 25 rows or fewer; the `Est. value` header contains `est.`; a hash or office name with markup is escaped; a long unbroken value is whole.
  - `MissedCallsView`: the lost-value block shows `Est. lost value` and a `<details>` containing the API's formula text; a `Download CSV` link whose `href` equals `csvHref(state)` and carries `download`; with `location` in the state the `href` carries it; the office `<select>` has `All offices` first and one option per office, with `selected` on the state's office (Review Focus 1: a state naming an office not in `offices` selects `All offices` and does not crash); `busy` renders `Updating…` and `aria-busy="true"`; with a `noMissed` view (zero-miss office) there is **no** `<table`, no `Download CSV`, no lost-value block, but the action and the picker are present (Review Focus 2, PLAN.md edge case); an empty callback list renders `No one to call back from this range.` and no download link; a long list renders the pager label; the `reachNote`, `limitNote` and `downloadNote` are present.
  - `no placeholder remains`: the markup of no view contains `Not built yet`.

- [ ] **Step 2: Write `real-exports.test.ts`** (done-when, automated half). Load the shipped export (`tests/fixtures/original-export`) and the extended one (`data/extended`) as the snapshot tests do; range `all`; run the real builders through `toJson` into `locationsModel` and `missedCallsModel`.
  - shipped: no row has flags; the action `kind` is `no_office_stands_out`; the action `linkLabel` is `See Missed calls`; `missedCallsModel(...).callbacks.rows` has 25 rows and `pager.label` ends its count with the total, which equals the API's row count (`Rows 1–25 of <total>`); `canDownload` true.
  - extended: the set of `${id} ${metric} ${direction}` over all rows equals `['loc_02 booking worse', 'loc_04 booking better', 'loc_06 answer worse', 'loc_08 answer better']`; the action `link.locationId` is `loc_06` and `actionHref` of it with the `all` range is `/?view=missed-calls&range=all&location=loc_06`; the Missed calls model for `loc_06` has `filterLabel` naming that office, one `heatmap` row, and `noMissed` null.
  - both: no string in either model contains `Infinity`, `NaN` or `undefined`.

- [ ] **Step 3: Write `csv-link.test.ts`** (the link against the real endpoint). `createApp(serverFixture())`; for states `''`, `?view=missed-calls&range=last7`, and `?view=missed-calls&range=all&location=loc_b`: `get(app, csvHref(parseUrlState(search)))` returns 200, `content-type` starting `text/csv`, a `content-disposition` of `attachment; filename="callbacks-` ... `.csv"`, a body starting with the byte-order mark, CRLF line ends, the header `caller_hash,unanswered_attempts,last_attempt_local,office,campaign,tracking_number,estimated_value_usd`, and a data-row count equal to the matching `missedCallsFor(...).callbacks.rows.length` (so the file holds exactly the rows the list is built from, not the 25 shown). A state whose `location` is `nope` returns 400 with `error.code` `unknown_location` and `error.field` `location` (Review Focus 1). A campaign pick in the state does not change the file.

- [ ] **Step 4: Run, expect the tests to pass or expose real gaps**

  Run: `npx vitest run tests/web/render.test.tsx tests/web/real-exports.test.ts tests/web/csv-link.test.ts`
  Expected: PASS. A failure is a gap in a component, a model or the link: fix that, not the test. If a Recharts-free component still fails to render under Node, say so and render its table piece alone.

- [ ] **Step 5: Run the whole suite and typecheck**

  Run: `npm test` then `npm run typecheck`
  Expected: all pass. Show both outputs.

- [ ] **Step 6: Commit**

  ```bash
  git add tests/web/render.test.tsx tests/web/real-exports.test.ts tests/web/csv-link.test.ts
  git commit -m "test: render, real-export and CSV-link checks for Locations and Missed calls

  Pins the edge cases PLAN.md lists for this phase, the flag on the extended data and 'nothing stands out' on the shipped data, and that the download link fetches exactly the rows the list is built from.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 7: README, hard-coding guard, and the click-through

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md`'s "Web app" section.** Remove the "Not built yet" sentence. Say what Locations shows (flags, best campaign per office) and what Missed calls shows (heatmap by office or weekday, estimated lost value, call-back list, CSV). Add `location` to the URL table (`the office Missed calls is filtered to`). Say the CSV starts tracking numbers with an apostrophe, and that on the extended export (`DATA_DIR=data/extended npm start`) Locations flags four offices, two of them better than the rest, because each office is tested against all others pooled. Say nothing about features that don't exist.

- [ ] **Step 2: Run the guard and the full suite**

  Run: `npx vitest run tests/core/different-names.test.ts` then `npm test`, `npm run typecheck`, `npm run build`
  Expected: all pass. A failure means a real name, date or `+1-555` slipped into `src/web/`; fix the source. Show the outputs.

- [ ] **Step 3: Run the click-through checklist** below in a real browser against `npm start` on the shipped export, then the marked items again with `DATA_DIR=data/extended npm start`. If you have no browser, **say so, give me the commands, and do not report the checklist as passed.** Report each item as pass, fail or not run, with what you saw. Show the results and **stop and wait for review**.

- [ ] **Step 4: Commit**

  ```bash
  git add README.md
  git commit -m "docs: README covers Locations, Missed calls and the office filter

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

## Click-through checklist (PLAN.md Phase 8 done-when, expanded into steps)

Shipped export first (`npm start`, default range Last 28 days); items marked **[ext]** repeat on `DATA_DIR=data/extended npm start`.

1. **Nav and links:** Locations and Missed calls open real pages (no "Not built yet"). From Overview, each Top action link opens its view, with the same range in the URL.
2. **Locations, shipped:** click a header to sort and again to reverse (`aria-sort` changes, blanks stay last). With All data, no office shows a flag; every row reads `In line with other offices.`; the action says no office stands out and links to Missed calls (unfiltered). A one-day range shows offices with `Too few calls to compare.`, not a clean bill.
3. **Locations, extended [ext]:** with All data, Canyon Office shows `Answer rate worse` with both rates and Riverside Office `Booking rate worse`; Midtown Office and Hillcrest Office show `Better`; the action names Canyon Office, both rates and its most-missed hour; the link reads `See Missed calls for Canyon Office`.
4. **Action link:** click that link: Missed calls opens filtered to Canyon Office (`location=loc_06` in the URL), the picker shows Canyon Office, `Showing Canyon Office only.` appears, and the heatmap has one row with its weekday-morning hours darkest. **[ext]**
5. **Office picker:** choose another office, then All offices: the URL changes, the picker keeps focus, a brief `Updating…` shows, and numbers never appear under the wrong office label. Back and forward follow.
6. **Heatmap:** By office shows one row per office, 24 hour columns and a total; By weekday shows Monday to Sunday; the busiest cell is the darkest; a zero cell is empty; each cell has its count printed (not colour alone); the legend reads Fewer to More; the table scrolls sideways inside its box on a narrow window, the page does not.
7. **Lost value:** `Est. lost value` shows a dollar figure with the note; `How this estimate works` opens the formula; the sources line lists campaign, channel and overall counts.
8. **Callback list:** the summary matches the action's caller count and value; the table shows 25 rows with `Rows 1–25 of N...`; Next and Previous page through all N (Previous disabled on the first page, Next on the last); changing the range or office returns to page 1; the reach note names the last data day; the limit note about caller hashes is visible.
9. **CSV:** click Download CSV: a file named `callbacks-<start>-to-<end>.csv` downloads; it opens in a spreadsheet with seven columns, one row per caller (all N, not one page), non-ASCII office names readable, tracking numbers kept as text (shown with a leading apostrophe), and the same first rows as page 1 on screen. With an office picked, the file holds only that office's callers.
10. **Empty states:** pick an office and a one-day range with no unanswered calls (or a range of one day on the shipped data): `No calls went unanswered at <office> in this range.`, no heatmap, no table, no download button, the picker still works. Pick a range in which every caller got through: `No one to call back from this range.` and no download link.
11. **Bad input:** open `/?view=missed-calls&location=nope`: a plain message from the server with `Reset to defaults`, which opens Missed calls with no office. Open `/?view=missed-calls&start=2026-10-05&end=2026-10-01`: the message shows beside the range control, the control still works.
12. **Caveats, no dev mode:** a range ending on the last data day shows the last-day and outcome-lag notes on both new views; the comparison notes do not appear on them.
13. **Long and odd names:** (temp export with a 300-character office name and `<b>x</b>`) the table, heatmap row, picker and callback table wrap or scroll inside their boxes; the page does not scroll sideways; the markup shows as text.
14. **Other time zone:** with the browser in a zone far from the offices, the as-of date and the callback "last attempt" times are unchanged.

## Edge-case coverage (PLAN.md Phase 8 list and done-when)

| PLAN.md item | Test |
| --- | --- |
| an office with no calls in range | Task 2 (`an office with no calls in range`, `empty`), Task 6 (`LocationTable`, dashes with notes), checklist 2 |
| a heatmap cell with zero calls | Task 3 (`a zero cell`, `heatLevel(0, n)`), Task 6 (`Heatmap`: `heat-0`, hidden `0 missed calls`), checklist 6 |
| an empty callback list | Task 4 (`an empty callback list`, `no missed calls`), Task 6 (`MissedCallsView`: no table, no download link), checklist 10 |
| the flag appears where the extended data plants it | Task 6 (`real-exports`: four flags on the extended export, `loc_06` link), checklist 3 |
| "nothing stands out" on the original | Task 2 (`nothing stands out`), Task 6 (`real-exports`: shipped export), checklist 2 |
| the Locations action links to Missed calls filtered to that office | Task 1 (`actionHref` round trip), Task 2 (`linkLabel`), Task 6 (`LocationsView` href, `real-exports`), checklist 3, 4 |
| the CSV downloads and opens correctly | Task 1 (`csvHref`), Task 6 (`csv-link`: status, headers, BOM, header row, row count against the view), checklist 9 |
| estimated lost value labeled, formula visible | Task 4 (`lost value`), Task 6 (`MissedCallsView`), checklist 7 |

## Self-review notes

- **Spec coverage:** Locations table, outlier flag with direction and both rates, best-campaign column, the three actions (Tasks 2, 5); Missed calls heatmap with toggle, estimated lost value with formula, callback list, CSV (Tasks 3, 4, 5); the Missed calls "stated limit" (`limitNote`, Task 4); every Phase 8 edge case and done-when item (table above); caveats from 3.3 inline on both views (Task 5).
- **Type consistency:** `Cell` (Phase 7 `campaignsModel`) is reused by Task 2; `HeatmapModel` (Task 3) is the input to `Heatmap` (Task 5); `MissedCallsModel['callbacks']` (Task 4) is the prop of `CallbackTable`; `csvHref`, `withLocation` (Task 1) are used by Tasks 5 and 6; `locationsFor`, `missedCallsFor`, `plantedStore`, `idleOfficeStore` (Task 2) are used by Tasks 4 and 6 (`missedCallsFor` is defined in Task 2 and first used in Task 4).
- **Proportion:** PLAN.md's Phase 8 is about 12 lines; the plan is longer because it fixes the exact copy, the empty and truncated states, the heat scale and the link to the CSV endpoint, none of which PLAN.md says. Components are described by behavior, not code.
- **Not in this phase:** takeaways and the AI/template marker (Phase 9); a second-range picker (S2); print layout (S3); motion (S5); the heatmap toggle, the sort and the page in the URL.
