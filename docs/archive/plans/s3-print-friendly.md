# Phase S3 (Print-friendly one-page summary) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A print view for the current range: the Overview tiles, the action and takeaway of each view, the estimate labels and the caveats from PLAN.md 3.3, no dev-mode content, on one A4 or Letter page.

**Architecture:** A `?print` flag in the URL (bare, like `?dev`) switches the page to its own document layout. The layout is built from requests the app already has: one `/api/overview` (tiles, notes, and each other view's headline action in `topActions`) and the four `/api/takeaway/:view` calls. Every decision (order, wording, what is shown while loading) lives in a pure model with tests; the component only draws it; a print stylesheet makes it fit.

**Tech Stack:** TypeScript (strict), vitest, React with `react-dom/server` render tests, plain CSS in `@media print`. Nothing new to install (`window.print()` is built in).

**Spec:** `PLAN.md` (3.1 to 3.3, 4.1, 7 "Failure handling", "S3: Print-friendly one-page summary" in section 9), `docs/BRIEF.md` (stretch goal 3), `CLAUDE.md`, `docs/plans/s2-daterange-compare.md` and `07-ui-part-one.md` (the code this extends), `src/web/urlState.ts`, `src/web/App.tsx`, `src/web/models/caveats.ts`, `overviewModel.ts`, `takeawayModel.ts`, `estimates.ts`.

## Global Constraints

- Work **one task at a time**. After the last task run `npm test`, `npm run typecheck` and `npm run build`, run the click-through checklist at the end of this file, show the results, then **stop** and wait (CLAUDE.md).
- **No new dependency.** If one seems needed, stop and ask.
- S3 done-when, from PLAN.md: browser print preview fits one A4/Letter page on both datasets; the README covers what this phase added. Edge cases PLAN.md lists: AI off (template text); long names wrapping. Each has tests below (Tasks 2 and 3), plus the print-preview checklist for the part a Node test cannot see (page fit).
- **Every number the user sees comes from code.** The print page formats the API's values through the existing format functions and computes nothing. No `new Date()` anywhere in the print path: "as of" is the data's last date (PLAN.md 3.1), never the clock.
- **No dev-mode content on paper**, whatever the URL says: no data notes panel or button, no takeaway reason note, no `?dev` in the print link.
- The app works with AI off; the print page then shows template text, marked "template".
- No hard-coded names, ids or dates in `src/`. `tests/core/different-names.test.ts` already scans `src/web` and `index.html`.
- No raw colour or duration literals outside `src/web/styles/tokens.css` (`tests/web/tokens.test.ts` scans every css, ts and tsx file). Print sizes are token overrides in `tokens.css`.
- Names from the data are shown as text only, never as markup, and never re-scanned for `{placeholders}`.
- Never read, print or `git add` `.env`. Do not write to `docs/AI_COST_LOG.md` or edit `docs/BRIEF.md`, `PLAN.md` or `CLAUDE.md`. **Stage files by name, never `git add -A`**; run `git status` first and leave uncommitted work in those files (today `docs/AI_COST_LOG.md`) alone.
- Commit after each task, small, message says why, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Prefer simple, readable code; a reviewer will walk through all of it.

## Gaps in PLAN.md this plan fills

PLAN.md's S3 is four lines. These are real decisions, proposed here and recorded in `docs/DECISIONS.md` as "awaiting review". Please confirm or change them before I build.

1. **"Each view's action" for Overview.** Overview's action *is* its top actions list, which already holds the headline action of Campaigns, Locations and Missed calls (and S1's alert entry). So the page shows the five tiles and the Overview takeaway, then one block per other view: that view's action(s) from `topActions`, grouped under it (the alert entry under Campaigns), and that view's takeaway. No action is printed twice.
2. **How it is reached.** `?print` in the URL (a bare flag, like `?dev`), with a "Print summary" link in the header that **opens in a new tab** (the app stays open in the first), and on the print page a Print button (`window.print()`) and an "Open the app" link. State stays in the URL, so a link or refresh reproduces it. It carries the range and comparison; it drops `dev`, `campaign` and `location` (the print is company-wide, like Overview's top actions, which are unfiltered).
3. **What it requests.** One `/api/overview` and four `/api/takeaway/:view`, all with the same query the screen would send, so the AI cache is shared with browsing. It does not fetch the Campaigns, Locations or Missed calls views (the callback list alone is hundreds of rows for one line). With a key, a first open can make up to four Haiku calls (about $0.0005 each, logged as usual); a repeat is four cache hits at $0.
4. **Fitting one page.** By compact print type and layout, never by dropping content: no caveat, number or estimate label is cut. A Node test cannot measure a page, so the proof is the print-preview checklist on both datasets plus a worst-case URL with every caveat; tests pin the bounded structure. **If the worst case spills onto a second page I stop and tell you**; my proposed fix would be two columns for the three view blocks.
5. **Estimate labels.** The page always carries a three-line "est." footnote (spend formula, revenue per budget dollar and missed-call value), because paper has no "one click away". The spend and revenue-per-dollar lines are the existing `estimateFormulas` text (the Campaigns action says "est. ... revenue per budget dollar"); the missed-call line is short and points to Missed calls for the full formula, since that formula's thresholds only exist in the Missed calls response.
6. **Print while loading.** The Print button stays disabled until the overview and all four takeaways have settled (ready or failed), so paper never carries "Loading takeaway...". A takeaway that failed leaves its block without a takeaway, as on screen; loading text is also hidden under `@media print` in case someone uses Ctrl+P anyway.

## Review Focus

Inputs the spec implies but no listed edge case names. Each has a test in the owning task.

1. **Print pressed (or Ctrl+P) while takeaways are still loading**: the button is disabled, no "Loading" text on paper. (Tasks 2, 3)
2. **A hand-edited `?print&view=missed-calls&location=…&campaign=…&dev`**: the summary is still company-wide, with no filter and no dev content. (Tasks 1, 3)
3. **An empty range, a one-day range, or "All data"**: "No calls in this range.", "1 day" not "1 days", the no-comparison reason printed once, no NaN. (Tasks 2, 4)
4. **A takeaway that failed, or AI budget reached**: the block shows its action and no error text. (Tasks 2, 3)
5. **A very long name with no spaces in an action or takeaway**: shown in full and wrapped, never cut or escaping the page; a name like `<b>x</b>` stays text. (Task 3)

---

## File Structure

```
src/web/urlState.ts                      (modify) UrlState.print; printHref, appHref, printParams; defaultsHref keeps print
src/web/models/printModel.ts             (create) printModel, canPrint
src/web/models/estimates.ts              (modify) printEstimateNotes
src/web/components/PrintSummary.tsx      (create) the document; PrintControls (screen only)
src/web/components/Header.tsx            (modify) "Print summary" link
src/web/App.tsx                          (modify) PrintShell, routing on state.print
src/web/main.tsx                         (modify) import print.css
src/web/styles/tokens.css                (modify) print type and space overrides
src/web/styles/print.css                 (create) @page and @media print rules, document layout
src/web/styles/base.css                  (modify) header link colour
README.md                                (modify) Print summary; `print` in the URL table
docs/DECISIONS.md                        (modify, done with this plan)
tests/web/urlState.test.ts, pageKey.test.ts, render.test.tsx   (modify) UrlState literals gain print: false; Header link
tests/web/printModel.test.ts             (create)
tests/web/render-print.test.tsx          (create)
tests/web/print-css.test.ts              (create)
tests/web/print-real-exports.test.ts     (create) both real exports
tests/core/different-names.test.ts       (modify) print model on the different-names export
```

---

### Task 1: URL state for the print page

**Files:**
- Modify: `src/web/urlState.ts`
- Test: `tests/web/urlState.test.ts`, plus `print: false` added to every `UrlState` literal that `npm run typecheck` flags (known: `tests/web/pageKey.test.ts`, `tests/web/render.test.tsx`, `tests/web/urlState.test.ts`)

**Interfaces:**
- Consumes: `UrlState`, `rangePairs`, `apiParams`, `toSearch`, `ViewName`.
- Produces:
  - `UrlState.print: boolean`: true when the `print` parameter is present, whatever its value (like `dev`).
  - `toSearch` writes a bare `print` before a bare `dev`.
  - `printHref(state: UrlState): string`: `/` + search with `print` on; keeps `view`, range and comparison; drops `campaign`, `location`, `dev`.
  - `appHref(state: UrlState): string`: `/` + search with `print` off, everything else kept (the "Open the app" link).
  - `printParams(state: UrlState, view: ViewName): URLSearchParams`: `apiParams` with `campaign` and `location` removed; used for the overview request and all four takeaway requests.
  - `defaultsHref` keeps `print` (so "Reset to defaults" on a print page stays on it).

- [ ] **Step 1: Write the failing tests** in `urlState.test.ts`:
  1. `parse`: `?print` and `?print=1` give `print: true`; no parameter gives false; `?print&dev` gives both true.
  2. `toSearch`: `{ print: true }` alone is `?print`; with `range: last7` is `?range=last7&print`; with `dev` too is `?print&dev`; a state with a range, comparison and print round-trips through `parseUrlState`.
  3. `printHref` (Review Focus 2): from `{ view: 'missed-calls', range: last7, compare: {2026-09-01, 2026-09-07}, campaign: 'cmp_a', location: 'loc_a', dev: true }` the href holds `view=missed-calls`, `range=last7`, both compare dates and `print`, and holds none of `campaign`, `location`, `dev`.
  4. `appHref`: from the same state with `print: true` drops only `print`.
  5. `printParams` (Review Focus 2): for each of the four views, with `campaign` and `location` set, the result has neither and keeps range and comparison; and for a state with neither set, `printParams(s, v).toString()` equals `takeawayParams(s, v).toString()` (the cache is shared with the screen).
  6. `defaultsHref` of a print state still contains `print`; the other helpers (`withRange`, `withCompare`, `withView`) keep `print`; `csvHref` is unchanged.
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/web/urlState.test.ts`. Expected: FAIL (`printHref` not exported).
- [ ] **Step 3: Implement** the field, parser line, `toSearch` change and the three functions in `urlState.ts`; add `print` to `defaultsHref`'s literal. Then `npm run typecheck` and add `print: false` to each flagged literal.
- [ ] **Step 4: Run** `npx vitest run tests/web` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** the files by name, "feat: a ?print flag in the URL state, so a link reproduces the print page".

---

### Task 2: The print model

**Files:**
- Create: `src/web/models/printModel.ts`, `tests/web/printModel.test.ts`
- Modify: `src/web/models/estimates.ts`

**Interfaces:**
- Consumes: `OverviewView` (`range`, `tiles`, `notes`, `topActions`), `Meta` (`skippedRows`), `TakeawayResponse`, `RequestState` (`src/web/requestState.ts`), `overviewModel` and `TileModel`, `caveatsFor`, `comparisonLine`, `takeawayModel` and `TakeawayShow`, `VIEW_LABELS`, `formatDateSpan`, `formatLongDate`, `formatSkippedRows`, `formatCount`, `estimateFormulas`.
- Produces:
  - `printEstimateNotes(days: number): string[]` in `estimates.ts`: three lines. Line 1 is `estimateFormulas(days)[0].formula` (the spend formula). Line 2 is `estimateFormulas(days)[2].formula` (revenue per budget dollar). Line 3, exact: `Est. missed-call value = the campaign's booking rate × its average booking value, using rates from the whole export. Missed calls shows the full formula.`
  - ```ts
    export interface PrintBlock {
      view: 'campaigns' | 'locations' | 'missed-calls';
      label: string;                                      // VIEW_LABELS
      actions: { text: string; actionable: boolean }[];   // topActions entries for this view, API order
      takeaway: TakeawayShow;                             // always built with { dev: false }
    }
    export interface PrintModel {
      rangeLine: string;              // `${formatDateSpan(start, end)} (${formatCount(days, ['day','days'])})`
      asOf: string;                   // `Data as of ${formatLongDate(span.end)}`
      skipped: string | null;         // formatSkippedRows(meta.skippedRows)
      comparisonLine: string | null;  // comparisonLine(notes, range)
      comparisonReason: string | null;// overviewModel's comparisonReason, printed once
      caveats: Caveat[];              // caveatsFor(notes, span, { comparing: true, range, view: 'overview' })
      tiles: TileModel[];
      empty: boolean;
      overviewTakeaway: TakeawayShow;
      blocks: PrintBlock[];           // campaigns, locations, missed-calls, in that order
      estimateNotes: string[];
    }
    export type PrintTakeaways = Record<ViewName, RequestState<TakeawayResponse> | null>;
    export function printModel(input: { view: OverviewView; meta: Meta; span: DateRange; takeaways: PrintTakeaways }): PrintModel
    export function canPrint(overview: RequestState<unknown> | null, takeaways: PrintTakeaways): boolean
    ```
    `canPrint` is true only when `overview` is `ready` and every takeaway state is `ready`, `failed` or `null` (null means no request was made).

- [ ] **Step 1: Write the failing tests** in `printModel.test.ts`, using `overviewFor`, `metaFor` and `serverFixture()` from `tests/web/fixtures.ts` (data `2026-09-01` to `2026-09-14`) and takeaway states built with the shapes in `requestState.ts`:
  1. `range, as-of and skipped lines`: `range=last7` gives `rangeLine` equal to the string built from `formatDateSpan('2026-09-08', '2026-09-14')` + ` (7 days)`; a one-day range (`start=end=2026-09-10`) ends `(1 day)` and the span prints once (Review Focus 3); `skipped` is `12 rows skipped` for `skippedRows: 12` and null for 0.
  2. `blocks follow the Overview's top actions`: three blocks in the order campaigns, locations, missed-calls; each block's `actions` equal the `{ text, actionable }` of the `topActions` entries with that view; no action appears in two blocks. A non-actionable action is kept with `actionable: false`.
  3. `an alert entry is grouped under Campaigns`: take real overview JSON and append a second `topActions` entry with `view: 'campaigns'` (hand-edit, say so in a comment): the Campaigns block has two actions in that order, the other blocks one each.
  4. `takeaway markers` (PLAN.md edge case "AI off"): an `ai` response gives `{ kind: 'ready', marker: 'AI', note: null }`; for **each** `TakeawayReason` in a table (`ai_off`, `budget_reached`, `no_facts`, `timeout`, `api_error`, `refusal`, `malformed`, `check_failed`, `log_unavailable`) a template response gives `marker: 'template'` and `note: null` (never a dev reason, Review Focus 4); the text is the response's text unchanged.
  5. `a failed or missing takeaway is hidden` (Review Focus 4): `failed` and `null` give `{ kind: 'hidden' }` for the overview and for a block; a `loading` one gives `{ kind: 'loading', … }`.
  6. `canPrint` (Review Focus 1), table: overview null or loading or failed is false; overview ready with any takeaway loading is false; all four ready is true; a mix of ready, failed and null is true.
  7. `caveats are the screen's caveats`: `caveats` equals `caveatsFor(view.notes, span, { comparing: true, range: view.range, view: 'overview' })`; on a per-day comparison (`start=2026-09-08&end=2026-09-14&compareStart=2026-09-01&compareEnd=2026-09-03`) the `per_day` caveat appears once; a clamped range (`start=2026-08-25&end=2026-09-14`) gives `clamped`.
  8. `All data has no comparison` (Review Focus 3): `range=all` gives `comparisonLine` null, `comparisonReason` the server's sentence (starts "No full previous period"), and every tile's `unavailable` holds its headline.
  9. `an empty range` (Review Focus 3): on `emptyRangeStore()` with `start=2026-09-10&end=2026-09-12`, `empty` is true and `JSON.stringify(model)` matches no `/NaN|Infinity|undefined/`.
  10. `estimate notes`: `printEstimateNotes(28)` has three lines; line 1 equals `estimateFormulas(28)[0].formula`; line 2 equals `estimateFormulas(28)[2].formula`; line 3 equals the exact string above; `model.estimateNotes` equals it for `view.range.days`; one day reads "1 day" (`printEstimateNotes(1)[0]` contains `1 day`).
  11. `no clock`: with `vi.useFakeTimers()` and `vi.setSystemTime('2031-05-05T12:00:00Z')`, `JSON.stringify(printModel(...))` does not contain `2031`.
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/web/printModel.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `printEstimateNotes`, `printModel` and `canPrint`. `printModel` composes the existing models (`overviewModel` for tiles, empty and comparison reason; `takeawayModel(state, { dev: false })` for every takeaway); it does no arithmetic.
- [ ] **Step 4: Run** `npx vitest run tests/web/printModel.test.ts` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** the three files by name, "feat: the print summary's content is decided in a pure model, never showing dev notes or loading text".

---

### Task 3: The page, the link and the print stylesheet

**Files:**
- Create: `src/web/components/PrintSummary.tsx`, `src/web/styles/print.css`, `tests/web/render-print.test.tsx`, `tests/web/print-css.test.ts`
- Modify: `src/web/App.tsx`, `src/web/components/Header.tsx`, `src/web/main.tsx`, `src/web/styles/tokens.css`, `src/web/styles/base.css`, `tests/web/render.test.tsx`

**Interfaces:**
- Consumes: `PrintModel`, `printModel`, `canPrint`, `printParams`, `printHref`, `appHref`, `defaultsHref`, `RequestFrame`, `Link`, `useApi`.
- Produces:
  - `PrintSummary({ model }: { model: PrintModel })`: the document, root `<article className="print-page">`. No links, no buttons, no `dev` content.
  - `PrintControls({ canPrint, backHref }: { canPrint: boolean; backHref: string })`: the Print button (`window.print()`, `disabled` unless `canPrint`) and the "Open the app" `Link`; the wrapper has class `no-print`.
  - `Header` gains prop `printLink: string`; renders a plain `<a href={printLink} target="_blank" rel="noopener">Print summary</a>` in its row, always (not dev-only). It is not the in-app `Link`, which changes the URL in the same tab.
  - `App` routes: `screen.screen === 'ready'` and `state.print` renders `PrintShell` instead of `ReadyShell`. `PrintShell` makes five `useApi` calls: `/api/overview` and `/api/takeaway/<view>` for each view, all with `printParams(state, view)`; the takeaway requests never use `state.view`. It renders `PrintControls` then `RequestFrame` (loading label "Loading the summary...") around `PrintSummary`. No Header, Nav, RangeControl or DataNotes in it.
  - Copy, exact: link `Print summary`; button `Print`, link `Open the app`; section headings are `VIEW_LABELS`; page title `Inbound call performance summary`.
  - `print.css`: `@page { margin: … }` with no `size` (so A4 and Letter both work); `@media print` hides `.no-print`, `.loading` and `[role="status"]` loading lines, sets `break-inside: avoid` on blocks and tiles, forces text on white (`--color-panel`), removes shadows; `.print-page` has `overflow-wrap: anywhere`. On screen `.print-page` is a centred column about the width of a page so the checklist matches paper.
  - `tokens.css`: a `@media print { :root { … } }` block overriding only `--text-*` and `--space-*` to a compact scale. Put it **before** the reduced-motion block (a test slices from that block to the end of the file). It overrides no colour, so the contrast test is unaffected.

- [ ] **Step 1: Write the failing tests.**
  `render-print.test.tsx` (render with `renderToStaticMarkup`; models from the real builders as in Task 2):
  1. `prints the page`: title, `rangeLine`, `asOf`, the five tile labels and values, each `PrintBlock` heading with its action text, and the estimate notes each exactly once; the comparison line once.
  2. `caveats print once each` (all `caveats` texts present once) and the skipped-rows line appears when `skipped` is set, absent when null.
  3. `AI off` (PLAN.md edge case): all four takeaways template: the text of each appears, the marker `template` appears four times and `AI` as a marker never, and no reason text (no "AI is off", "budget") appears.
  4. `AI on`: an `ai` takeaway shows the marker `AI` and its text.
  5. `no loading text, no empty section` (Review Focus 1, 4): `loading` takeaways render no "Loading takeaway..." and no takeaway section; `hidden` ones render the block's action with no takeaway section.
  6. `no dev content and no links` (Review Focus 2): the markup contains no `<a `, `<button`, "Data notes" or "dev".
  7. `long names wrap` (PLAN.md edge case, Review Focus 5): hand-edit real overview JSON so a campaign name in an action text is 200 letters with no spaces; the full 200 characters are in the markup (not cut) and the root element has class `print-page`.
  8. `names stay text`: an action naming `<b>x</b>` renders as `&lt;b&gt;x&lt;/b&gt;` with no raw `<b>`.
  9. `an empty range` prints "No calls in this range." once; `All data` prints the comparison reason once.
  10. `PrintControls`: `canPrint: false` renders the Print button `disabled`; `true` renders it enabled; the back link has the given `href`; the wrapper has class `no-print`; the `Print` button has `type="button"`.
  `render.test.tsx` (Header): the "Print summary" link is present with `href` equal to `printHref(state)`, `target="_blank"` and a `rel` containing `noopener`, present without `dev`, and its href has no `dev` when `dev` is on.
  `print-css.test.ts` (reads `src/web/styles/print.css` and `tokens.css` as text, the same way `tokens.test.ts` does): `print.css` contains `@page` and no `size:` declaration inside it (fits A4 and Letter); contains `break-inside: avoid`; the `.print-page` rule has `overflow-wrap: anywhere` (PLAN.md edge case "long names wrapping"); a `@media print` block hides `.no-print`; `tokens.css` has a `@media print` block that overrides `--text-md` and `--space-3` and no `--color-` name; and that block appears before `prefers-reduced-motion`.
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/web/render-print.test.tsx tests/web/print-css.test.ts tests/web/render.test.tsx`. Expected: FAIL on the new tests only.
- [ ] **Step 3: Implement** `PrintSummary.tsx`, the `PrintShell` route in `App.tsx`, the Header link, `print.css` (imported from `main.tsx` after `base.css`) and the token overrides. Give the header link a colour token in `base.css` so it reads on the dark chrome. Type sizes: start at about 10pt body and 9pt notes via the print token overrides; tiles in one row of five; blocks in one column.
- [ ] **Step 4: Run** `npx vitest run tests/web` and `npm run typecheck`. Expected: PASS (`tokens.test.ts` passes with the new files).
- [ ] **Step 5: Commit** the files by name, "feat: a one-page print summary at ?print, with its own layout and print stylesheet".

---

### Task 4: Both real exports, and the different-names export

**Files:**
- Create: `tests/web/print-real-exports.test.ts`
- Modify: `tests/core/different-names.test.ts`

**Interfaces:**
- Consumes: `cleanExport` and `readExportFromDir` as `tests/web/real-exports.test.ts` does (shipped: `tests/fixtures/original-export`; extended: `data/extended`), `overviewFor`, `campaignsFor`, `locationsFor`, `missedCallsFor` (their `templateSentence` stands in for the AI-off takeaway), `printModel`, `PrintSummary`.
- Produces: nothing for later tasks. No `src/` change.

- [ ] **Step 1: Write the tests.** For each export, range `range=last28` (the default), takeaways = the four real `templateSentence`s as template responses:
  1. `structure is bounded`: 5 tiles, 3 blocks in order, every block has at least one action; **shipped: one action per block (3 in all); extended: the Campaigns block has two (the S1 alert entry), 4 in all.** If a count differs from this, stop and tell me; do not change the number.
  2. `renders clean`: the markup matches no `/NaN|Infinity|undefined|\{[a-z]/` (no unfilled placeholder), and has no `<a `.
  3. `visible text has a ceiling`: probe the visible text length (markup with tags stripped) for each export, record both in a comment, and assert each is under the probe rounded up to the next 250 characters. This is a tripwire against the page growing, **not proof of fit**; the print preview is the proof.
  4. `All data` and the one-day range on both exports build with no comparison line and no NaN (Review Focus 3).
  `different-names.test.ts`: on the different-names export (other names, zones, dates) build the print model for a 7-day range and for `All data`; it is finite, has three blocks, and no text contains `undefined` or `NaN`.
- [ ] **Step 2: Run** `npx vitest run tests/web/print-real-exports.test.ts tests/core/different-names.test.ts`. Expected: PASS (the code exists from Tasks 1 to 3). Report the two probed lengths.
- [ ] **Step 3: Commit** the two test files, "test: the print summary on both real exports and the different-names export".

---

### Task 5: README and the full check

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Add `print` to the URL table ("add `?print` for the one-page print summary") and a "Print summary" subsection after "Alerts": what is on the page (tiles, each view's action and takeaway with its AI or template marker, the caveats, the estimate footnote); how to reach it (the "Print summary" link, which opens a new tab, or `?print` on any URL with the range you want) and that it keeps the range and comparison but ignores the campaign and office choice and never shows dev content; that Print waits for the takeaways to load; that it asks for the Overview and the four takeaways only, shares the AI cache with browsing, and with a key a first open can cost up to four calls (logged); that it fits one A4 or Letter page by using small type and never by dropping caveats; and the known limit (page fit is checked by eye on the two datasets and a worst-case range; a name far longer than any in the data is wrapped, not cut, and could push it to a second page).
- [ ] **Step 2:** Run `npm test`, `npm run typecheck`, `npm run build`. Expected: all green. Show me the counts.
- [ ] **Step 3:** Run the checklist below in the browser (`npm start`, then `DATA_DIR=data/extended npm start`) and show me the result, including what the print preview showed for page count.
- [ ] **Step 4: Commit** `README.md` (and any `docs/DECISIONS.md` rows added during the build), "docs: README covers the print summary".

## Click-through checklist (S3)

Use Chrome or Edge print preview. Set Paper size to **A4**, then **Letter**; Scale 100%; Margins Default; Background graphics off. The page count must read **1 page**.

**Shipped export, default Last 28 days:**
- The header has "Print summary". Click it: URL gains `print`, the page is a plain document (no dark band, nav, range control or data notes), with Print and "Open the app" above it. It opened in a **new tab**; the first tab is still on the app.
- Network tab shows only `/api/meta`, `/api/overview` and the four `/api/takeaway/*` calls; none for campaigns, locations or missed-calls.
- Slow the network ("Slow 3G"): Print is disabled until the takeaways land.
- Preview: 1 page on A4 and on Letter; five tiles in a row; Campaigns, Locations and Missed calls blocks each with an action and a takeaway marked `template` (no key); the estimate footnote and every caveat visible; no buttons, no link colours.
- "Open the app" (in the print tab) goes to the app with the same range; a refresh on `?print` keeps the page.
- `?print&dev&view=missed-calls&location=<any office id>`: still the company-wide summary, no Data notes button, no reason text.
- `?print&range=all`: no change figures, the reason printed once, still 1 page.
- `?print&start=2026-10-29&end=2026-10-29`: reads "Oct 29, 2026 (1 day)", 1 page.

**Extended export, Last 28 days:** four actions (the alert entry under Campaigns), still 1 page on both sizes.

**Worst case, extended export:** `?print&start=2026-08-25&end=2026-11-05&compareStart=2026-08-31&compareEnd=2026-09-06` (range cut at both ends, comparison inside it, 60 days against 7). Expected caveats: clamped, first day, last day, comparison includes the first day, outcome lag, overlap, per day. If one does not show, pick another combination that shows them all and tell me. Still **1 page** on both sizes; if not, stop (Gap 4).

**Long names:** automated by the render and CSS tests. For a look, point `DATA_DIR` at a scratch copy of the shipped export (outside the repo) with one campaign renamed to about 120 characters with no spaces, and print: the name wraps inside the page.

**With a key (optional, costs under a cent):** the first open of a range you have not browsed makes up to four calls and the markers read `AI`; reopening is four log lines at $0.

## Self-review

- **Spec coverage:** PLAN.md S3 delivers (print view for the current range; Overview tiles; each view's action and takeaway; estimate labels and caveats from 3.3; no dev content; one page): Tasks 2 and 3 (content), 3 (layout and print stylesheet), 4 (both datasets), Gap 1 (what "each view's action" means). Done-when (one A4/Letter page on both datasets; README): checklist and Task 5. Edge cases: AI off: Tasks 2 (test 4), 3 (test 3); long names wrapping: Task 3 (tests 7, `print-css`), the checklist.
- **Types:** `PrintTakeaways` is `Record<ViewName, RequestState<TakeawayResponse> | null>` in Tasks 2 and 3; `printParams(state, view)` feeds both the overview and takeaway requests; `canPrint(overview, takeaways)` is the only thing that enables the Print button; `PrintModel.blocks[].view` is the three-name subset of `ViewName`.
- **Tests I will have to update:** the `UrlState` literals in `pageKey.test.ts`, `render.test.tsx` and `urlState.test.ts` (Task 1; typecheck lists them), and `render.test.tsx`'s Header renders (Task 3).
- **Open for your review:** Gaps 1 to 6 (all proposed, none built), especially 1 (Overview's action is the top-actions list, grouped under the views) and 4 (page fit is proven by eye, with two columns as the fallback). Decided with you: Print opens in a new tab, so the print page has no history to go Back to; it has an "Open the app" link instead.
