# Phase 7 (UI part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Vite + React front end, served by the Phase 6 server, with the app shell, date range control (state in the URL), inline caveats, the dev-mode data notes panel, and the Overview and Campaigns views with their actions.

**Architecture:** The browser only formats and draws. Everything it shows comes from Phase 6 JSON. All decisions (what text, which tone, which order, which blank) live in small **pure TypeScript modules** (`src/web/*.ts`, `src/web/models/*.ts`) that vitest tests in Node with no browser. The React components (`src/web/components/*.tsx`) are thin: they take a model as props and print it. The URL is the single source of state; one hook reads it and `history.pushState` writes it.

**Tech Stack:** TypeScript (strict), React, Vite, Recharts, vitest. Five dependencies on PLAN.md's list plus two type packages that are not on it (Task 0 asks first). After the build, the S5 look was started early and added one font package, `@fontsource/ibm-plex-sans` (approved; see "Style change" below).

**Spec:** `PLAN.md` (sections 2, 3.1-3.4, 4.1, 4.2, 6 "Web app", 8 "Web", Phase 7 in section 9), `docs/BRIEF.md`, `CLAUDE.md`, `docs/plans/06-server.md` (the API this phase calls), `src/server/api.ts` (response types), `src/core/views/*.ts` (view types).

## Global Constraints

- Work **one task at a time**. After the last task run `npm test`, `npm run typecheck` and `npm run build`, run the click-through checklist at the end of this file, show the results, then **stop** and wait (CLAUDE.md).
- **Ask before adding the seven packages** (Task 0). Nothing else new. (The style change later added `@fontsource/ibm-plex-sans`, asked and approved.)
- Phase 7 done-when, from PLAN.md: the click-through checklist passes in the browser (copied, with exact steps, at the end of this file).
- **Every number the user sees comes from code. The web app does no arithmetic on metrics:** it prints values and strings from the API and formats them with the existing `src/core/views/format.ts` functions. It never sums, divides, ranks or rounds a metric itself. Choosing a label, a sort order or a tone from a value the API already supplied is fine. (CLAUDE.md, PLAN.md section 6)
- The app works with AI off and no key. Phase 7 never shows a takeaway and never reads `ANTHROPIC_API_KEY`; the takeaway is Phase 9's.
- Nothing hard-coded to this dataset: no campaign, office or channel names, tracking numbers or real dates in `src/web/` or `index.html`. In comments and copy write `YYYY-MM-DD`. `tests/core/different-names.test.ts` scans `src/`, so a slip fails it. Only the enums in the column contract (channels) may appear, and only inside the humanize rule, never as a list.
- Dates are `YYYY-MM-DD` strings end to end. **Never pass one to `new Date(string)` or `toLocaleDateString` without `timeZone: 'UTC'`**: the viewer's own time zone must not move a date.
- Estimates are labeled "est." wherever shown, with the formula one click away (PLAN.md 3.3). Caveats sit inline on the view they affect, never only in the dev panel.
- No raw color or motion-duration literals outside `src/web/styles/tokens.css` (Task 1 enforces it with a test), so S5 is a restyle.
- Names and text from the data are rendered as text only: no `dangerouslySetInnerHTML`, ever.
- Never read, print or `git add` `.env`. Do not write to `docs/AI_COST_LOG.md` (it has uncommitted edits of yours) or edit `docs/BRIEF.md`.
- Commit after each task, small, message says why, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stage files by name, never `git add -A`.
- Prefer simple, readable code; a reviewer will walk through all of it.

## Issues found in PLAN.md (all approved)

Each is recorded in `docs/DECISIONS.md` (rows dated 2026-11-19, "Phase 7 (approved)"). Issue 1 changed PLAN.md section 8 and section 6 (dependency list), which are already amended.

1. **"No component tests" conflicts with this phase's edge cases.** PLAN.md section 8 says no component tests, yet Phase 7 lists four edge cases (loading and error states, empty range, blank cost-per-booking cells, very long names) and two done-when items (panel absent without `?dev`, estimates labeled) that only show in rendered output. Approved: every decision lives in a pure module with its own test (Tasks 2 to 7, no DOM), and one small extra task (Task 11) renders the dumb components to a string with `react-dom/server` and asserts on the markup. That needs no DOM, no jsdom, no testing library and no new package. PLAN.md section 8 now says this. Long names wrapping stays a checklist item, because clipping is CSS.
2. **Overview links to views that don't exist yet.** Overview's Top actions link to Locations and Missed calls, which are Phase 8. Approved: the nav shows all four views; those two render a plain "Not built yet (Phase 8)" page, so no link is dead. Phase 8 replaces the page.
3. **Two packages not on PLAN.md's list:** `@types/react` and `@types/react-dom`. React ships no types, and `tsc --noEmit` is part of `npm run typecheck`. Reason goes in `docs/DECISIONS.md` (PLAN.md section 6 requires it).
4. **`npm start` must now build the web app.** The Phase 6 decision says Phase 7 adds the build step. Approved: `npm start` = `vite build` then the server; `npm run build` builds only; `npm run dev` runs the server and Vite together with `/api` proxied.
5. **The URL contract for the browser.** PLAN.md says state lives in the URL but not how. Approved: the view is `?view=` (absent means overview; this matches the Phase 6 note that the UI keeps `view` and `dev` in the URL), and every other parameter keeps the **API's own names** (`range`, `start`, `end`, `compareStart`, `compareEnd`, `campaign`, `location`), so the API call is the URL minus `view` and `dev`. `?dev` means dev mode by presence alone (`?dev`, `?dev=1`, `?dev=0` all turn it on), so a reviewer needs no syntax. The table's sort order is local, not in the URL (PLAN.md lists range, comparison, view and campaign only).
6. **No comparison picker yet.** PLAN.md 3.1 says the date control has "a comparison to the previous period". Phase 7 shows that comparison (the server's default) and the URL carries `compareStart`/`compareEnd` through, but the control to choose a second range is S2.
7. **The tile's reason text.** PLAN.md 3.2 says a tile shows "No full previous period" with a one-line reason. The server's reason is one sentence that starts either "No full previous period" or "No like-for-like comparison" and continues after a colon. Approved: each tile shows the part before the colon and the full sentence shows once under the tiles. A test builds both sentences from the real `resolveComparison`, so a wording change in core fails it.
8. **A range the data doesn't fully cover.** The server clamps a partly-outside range and rejects a wholly-outside one. Approved: the date inputs carry `min`/`max` from the data span, a clamped range gets an inline caveat naming what is shown, and a rejected one shows the server's message with a "Reset to defaults" link. PLAN.md 3.3 doesn't list the clamp caveat; it is added because showing 14 days under a "last 28 days" label would be a quiet partial-period comparison.

## Style change (S5 look started early, 2026-11-19, approved)

After the twelve tasks and the review fixes, the user judged the plain look too rough and asked for the look half of S5 now, ahead of Phase 8. Motion (Framer Motion) stays in S5 and needs its own ask. Recorded in `docs/DECISIONS.md` (row "S5 look").

- **Source of the look:** Invoca's own design language, read from the public stylesheet and pages of invoca.com. Two earlier attempts (a warm editorial serif, then a generic blue analytics look) were rejected as generic.
- **What it is:** a dark evergreen header and nav band (`--color-chrome`) with a brand-green underline on the active view; sand background; white panels with a soft border and 12px radius; green filled action buttons; a mint-tinted pressed preset; the headline numbers as one joined strip, not separate cards; weight-500 headings with tight tracking; chart bars in green, partial weeks in indigo with the hatch kept.
- **Contrast adjustments:** Invoca's brand green `#00b388` is about 2.5:1 on sand, so it stays on the dark band only. Links, buttons and text use `#00684f`, and chart bars use `#00936c`.
- **Type:** IBM Plex Sans (`@fontsource/ibm-plex-sans`, weights 400, 500 and 600, bundled locally, no external request) stands in for Invoca's commercial Saans. `@fontsource/fraunces` was tried and removed. One family does not meet PLAN.md S5's "type pairing" criterion; Invoca itself uses one. Left for the user to decide at S5 sign-off.
- **Look only:** `tokens.css`, `base.css`, the font imports in `main.tsx` and `tests/web/tokens.test.ts` changed. No markup, number, copy or action changed, and the render tests are untouched.
- **Task 1 amended** (below): new tokens, and the token test now also checks contrast and named colors.
- **Still S5:** motion, and the user's sign-off on the look in a real browser.

## Review Focus

Inputs the spec implies but no listed edge case names. Each has a test in the owning task.

1. **A slow earlier response overwriting a newer one:** the user clicks Last 7, then All data; the first reply lands last. The screen must show All data's numbers, never Last 7's under All data's label. (Task 4)
2. **The API isn't running, or the reply isn't JSON** (`npm run dev` with no server, a proxy error page, the SPA fallback `index.html` returned for an `/api` path): a plain sentence saying what to check, never `Unexpected token <` or a blank page. (Task 4)
3. **A hand-edited or old URL:** `?view=zzz`, `?range=`, a repeated parameter, `?start=` with no `end`, back and forward buttons. It never crashes; a bad range shows the server's message with a reset link, and the range control is still on screen to fix it. (Tasks 2, 8)
4. **The viewer's own time zone moving a date:** someone in Sydney or Honolulu must see the same "Data as of Oct 29, 2026" and the same week labels as the office. (Task 3, run under three zones)
5. **Names that are markup or very long and unbroken:** a campaign called `<img src=x onerror=alert(1)>` or a 300-character name with no spaces appears as text, in full, in the table, the chart title and the picker. (Tasks 6, 11)

---

## File Structure

```
index.html                           Vite entry at the repo root
vite.config.ts                       react plugin, build to dist/, dev proxy of /api
scripts/dev.ts                       `npm run dev`: the server (watching) and Vite together
src/web/main.tsx                     mounts <App/>
src/web/App.tsx                      container: URL state, meta, the view request, the screen
src/web/urlState.ts                  UrlState, parseUrlState, toSearch, apiParams, with*, actionHref, defaultsHref
src/web/format.ts                    BLANK, date, skipped-rows and enum formatting
src/web/api.ts                       fetchApi, ClientError, ApiResult
src/web/requestState.ts              RequestState, requestReducer (pure)
src/web/useApi.ts                    the hook over fetchApi and requestReducer
src/web/useUrlState.ts               the hook over parseUrlState, pushState and popstate
src/web/models/screen.ts             screenFor
src/web/models/errors.ts             describeError
src/web/models/caveats.ts            caveatsFor
src/web/models/estimates.ts          estimateFormulas
src/web/models/overviewModel.ts      overviewModel
src/web/models/campaignsModel.ts     campaignsModel, sorting, campaignChoices
src/web/models/weeklyChart.ts        weeklyChartModel
src/web/models/dataNotesModel.ts     dataNotesModel
src/web/components/                  Header, Nav, Link, RangeControl, RequestFrame, Caveats, EstimateNote,
                                     OverviewView, CampaignsView, CampaignTable, WeeklyChart, DataNotesPanel, ComingSoon
src/web/styles/tokens.css            design tokens: color, type, space, motion
src/web/styles/base.css              layout and component styles, tokens only
tests/web/fixtures.ts                real view and notes JSON from the Phase 5 builders
tests/web/*.test.ts, render.test.tsx
package.json, package-lock.json      (modify) dependencies, scripts
tsconfig.json                        (modify) "jsx": "react-jsx"; include vite.config.ts
vitest.config.ts                     (modify) include .test.tsx
README.md                            (modify) commands and the web app
docs/DECISIONS.md                    (modify) already holds this plan's approved rows
```

Components never import a model's internals and never format a number themselves. Models import types from `src/core` and `src/server/api.ts` with `import type` only.

---

### Task 0: Approve and install the dependencies; build and dev wiring

**Files:**
- Modify: `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `docs/DECISIONS.md`
- Create: `index.html`, `vite.config.ts`, `scripts/dev.ts`, `src/web/main.tsx`, `src/web/App.tsx` (placeholder page: the text "Inbound call performance")

**Interfaces:**
- Consumes: Phase 6 server (`npm start`, `PORT`).
- Produces: `npm run build`, `npm run dev`, `npm start` (builds, then serves); `.tsx` files typecheck and vitest runs `.test.tsx`.

- [ ] **Step 1: Ask the user** (CLAUDE.md; PLAN.md: at the start of the phase that needs it). Name `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `recharts` (all on PLAN.md's list) and `@types/react`, `@types/react-dom` (not on it: React ships no types and `npm run typecheck` needs them). Say `vite`, the plugin and the two type packages go under `devDependencies`, and `react`, `react-dom`, `recharts` under `dependencies`. **Install nothing until they say yes.** If they decline one, stop and report what that changes.

- [ ] **Step 2: Install**

  Run: `npm install react react-dom recharts` then `npm install -D vite @vitejs/plugin-react @types/react @types/react-dom`
  Expected: added under the right section; lockfile updated. If npm reports an unmet peer dependency, stop and ask rather than adding it.

- [ ] **Step 3: Configure.**
  - `tsconfig.json`: add `"jsx": "react-jsx"` and `vite.config.ts` to `include`.
  - `vitest.config.ts`: `include: ['tests/**/*.test.{ts,tsx}']`.
  - `vite.config.ts`: the React plugin; `build.outDir: 'dist'` (the Phase 6 server's default web root); `server.proxy` sending `/api` to `http://127.0.0.1:${process.env.PORT ?? 3000}` (a blank `PORT` counts as 3000).
  - `index.html`: a root `<div id="root">`, `<title>Inbound call performance</title>`, the module script `/src/web/main.tsx`.
  - `package.json` scripts: `"build": "vite build"`, `"start": "vite build && tsx src/server/cli.ts"`, `"dev": "node scripts/dev.ts"`.
  - `scripts/dev.ts`: imports only `node:child_process`; starts two children with `process.execPath` (so Windows needs no shell): `--import tsx --watch src/server/cli.ts` and `node_modules/vite/bin/vite.js`, inheriting stdio. If either exits, kill the other and exit with its code (so a `Cannot start: ...` from the server ends `npm run dev` instead of leaving Vite up with a dead API). Ctrl+C stops both.

- [ ] **Step 4: Verify**

  Run: `npm run typecheck` then `npm test`
  Expected: no type errors; every existing test passes.

  Run: `npm run build`
  Expected: `dist/index.html` and `dist/assets/*` exist.

  Run: `PORT=3917 npm start` in the background, then `curl -s http://127.0.0.1:3917/` and `curl -s http://127.0.0.1:3917/api/meta`; stop the server.
  Expected: the first returns the built `index.html` (not the "web app isn't built" placeholder); the second returns JSON. This proves the Phase 6 static handler serves the real build.

- [ ] **Step 5: Commit**

  ```bash
  git add package.json package-lock.json tsconfig.json vitest.config.ts index.html vite.config.ts scripts/dev.ts src/web/main.tsx src/web/App.tsx docs/DECISIONS.md
  git commit -m "chore: add React, Vite and Recharts; npm start now builds the web app

  All five are on PLAN.md's list; the two type packages are needed for npm run typecheck. The Phase 6 decision deferred the build step to this phase.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 1: Design tokens and the no-raw-values guard

**Files:**
- Create: `src/web/styles/tokens.css`, `src/web/styles/base.css`, `tests/web/tokens.test.ts`
- Modify: `src/web/main.tsx` (import both stylesheets)

**Interfaces:**
- Consumes: nothing.
- Produces: the custom properties below, the only place a color, font, spacing step or motion duration is defined. Later tasks write `var(--...)` and nothing else.

  | Group | Names |
  | --- | --- |
  | color | `--color-text`, `--color-text-muted`, `--color-bg`, `--color-surface`, `--color-border`, `--color-accent`, `--color-accent-text`, `--color-up`, `--color-down`, `--color-notice-bg`, `--color-notice-text`, `--color-chart-bar`, `--color-chart-bar-partial` |
  | type | `--font-body`, `--font-heading`, `--font-mono`, `--text-sm`, `--text-md`, `--text-lg`, `--text-xl` |
  | space | `--space-1` to `--space-6`, `--radius` |
  | motion | `--motion-fast` (150ms), `--motion-base` (200ms), `--motion-slow` (300ms), `--ease-standard` |

  Added by the style change (the test still requires only the names above):

  | Group | Names |
  | --- | --- |
  | color | `--color-panel` (white panels), `--color-rule` (decorative hairline, exempt from contrast), `--color-accent-soft` (pressed preset, Best badge), `--color-chrome`, `--color-chrome-text`, `--color-chrome-muted`, `--color-chrome-accent` (the dark header and nav band) |
  | type | `--text-xs`, `--text-2xl`, `--tracking-caps`, `--tracking-tight` |
  | space | `--radius-sm` (buttons, inputs, badges; `--radius` is now the 12px panel radius) |

  Text on every background must reach WCAG AA contrast (4.5:1); meaning is never carried by color alone (change tone has a sign and a word, best/worst a text badge, partial weeks a hatch). Under `@media (prefers-reduced-motion: reduce)` the three motion durations are `0ms`.

  After the review and the style change, `tokens.test.ts` also checks:
  - **Contrast, computed from the hex values:**
    - Text at 4.5:1 or more: text, text-muted, accent, up and down on bg, panel and surface; accent and up on accent-soft; accent-text on accent; notice-text on notice-bg; chrome-text and chrome-muted on chrome.
    - Non-text at 3:1 or more: border, chart bar and chart bar partial on bg, panel and surface; chrome-accent on chrome.
  - **Named colors:** a CSS named color (`red`, `white`) used as a value outside `tokens.css` fails, the same as a hex code.

- [ ] **Step 1: Write the failing tests** in `tokens.test.ts` (reads files with `node:fs`).
  - `tokens.css defines every token the plan names`: each name in the table above appears as a declaration (`--name:`).
  - `reduced motion zeroes the durations`: `tokens.css` contains `prefers-reduced-motion: reduce` and, inside it, `--motion-fast: 0ms`, `--motion-base: 0ms`, `--motion-slow: 0ms`.
  - `no raw colors or durations outside tokens.css`: for every `*.css` under `src/web/styles` except `tokens.css`, and every `*.tsx`/`*.ts` under `src/web`, no match for `#[0-9a-fA-F]{3,8}\b`, `rgb(`, `rgba(`, `hsl(`, `hsla(`, or a number followed by `ms` or `s` as a time (`\b\d+(\.\d+)?m?s\b` in a CSS `transition`/`animation` line). The test prints the file and line on failure.
  - `every var() used is defined`: collect `var(--name)` from `src/web` CSS and TSX; each `name` is declared in `tokens.css`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/web/tokens.test.ts`
  Expected: FAIL (`tokens.css` does not exist).

- [ ] **Step 3: Write `tokens.css` and `base.css`.** `base.css`: a readable single-column layout with a maximum content width, header, nav, tile grid, table, notice, badge and chart styles, all through tokens; visible `:focus-visible` outlines; table cells `overflow-wrap: anywhere` so a long unbroken name wraps instead of widening the page; tables scroll horizontally inside their own wrapper on narrow screens. Plain and quiet: BRIEF.md says no polished UI; S5 restyles. (Superseded by the style change above: the S5 look was applied early, through these two files only. Column headings no longer break inside a word, and a minimum width on the table and on its text cells keeps a channel like "Paid search" on one line and the numbers from squeezing.)

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/web/tokens.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/web/styles/tokens.css src/web/styles/base.css src/web/main.tsx tests/web/tokens.test.ts
  git commit -m "feat: design tokens in one file, with a test that nothing else sets a color or duration

  S5 then restyles by editing tokens, not hunting literals; reduced motion is handled at the source.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 2: URL state

**Files:**
- Create: `src/web/urlState.ts`, `tests/web/urlState.test.ts`

**Interfaces:**
- Consumes: `ViewName`, `ActionLink` (`src/core/views/facts.ts`, type-only).
- Produces:
  ```ts
  export type RangeChoice =
    | { kind: 'preset'; preset: string }                  // raw: the server judges it
    | { kind: 'custom'; start: string; end: string };     // either may be '' (hand-edited URL)
  export interface UrlState {
    view: ViewName;
    range: RangeChoice | null;                             // null = the server's default
    compare: { start: string; end: string } | null;        // either may be ''
    campaign: string | null;
    location: string | null;
    dev: boolean;
  }
  export const VIEW_ORDER: readonly ViewName[];            // overview, campaigns, locations, missed-calls
  export function parseUrlState(search: string): UrlState;
  export function toSearch(state: UrlState): string;       // '' or '?view=campaigns&range=last7&dev'
  export function apiParams(state: UrlState, view: ViewName): URLSearchParams;
  export function withView(state: UrlState, view: ViewName): UrlState;
  export function withRange(state: UrlState, range: RangeChoice | null): UrlState;   // clears compare
  export function withCampaign(state: UrlState, id: string | null): UrlState;
  export function customRange(start: string, end: string): RangeChoice | null;      // null if either is blank after trim
  export function presetOf(state: UrlState, defaultPreset: string): string | null;  // null when custom
  export function actionHref(state: UrlState, link: ActionLink): string;
  export function defaultsHref(state: UrlState): string;
  ```
  Parse is total and never throws. Rules: `view` must match a name exactly, else overview. A repeated parameter uses its first value. An empty value is absent. If `range` and `start`/`end` are both present, `range` wins and the pair is dropped. `start` or `end` alone makes a custom range with the other as `''`; the same for `compareStart`/`compareEnd`; both blank means `null`. `dev` is true when the key is present, with any value or none. `toSearch` order: `view` (omitted for overview), `range` or `start`+`end`, `compareStart`, `compareEnd`, `campaign`, `location`, `dev` (written bare, no `=`); blanks are omitted. `apiParams` carries range and compare for every view, plus `campaign` for campaigns and `location` for missed-calls, never `view` or `dev`, blanks omitted. `actionHref` goes to `link.view` with `link.locationId` as `location`, keeps range, compare and dev, drops `campaign`. `defaultsHref` keeps view and dev and drops everything else.

- [ ] **Step 1: Write the failing tests.**
  - `no search is the defaults`: `''` and `'?'` give `{ view: 'overview', range: null, compare: null, campaign: null, location: null, dev: false }`.
  - `each view parses`: `?view=campaigns|locations|missed-calls`; `zzz`, `Campaigns`, `` and `overview` give overview.
  - `ranges`: `?range=last7` is a preset; `?range=banana` is kept as a preset `banana`; `?range=` is null; `?start=2026-09-01&end=2026-09-05` is custom; `?start=2026-09-01` is custom with `end ''`; `?range=last7&start=2026-09-01&end=2026-09-05` is the `last7` preset only; `?range=last7&range=all` is `last7`.
  - `compare`: both given; one given (other `''`); neither null.
  - `dev by presence`: `?dev`, `?dev=1`, `?dev=0`, `?dev=` are true; none and `?devx` are false (Review Focus 3).
  - `garbage never throws` (it.each): `?%E0%A4%A`, `?&&&`, `?=x`, `?view`, `?campaign=%00`, a 10,000-character value, `?range[]=x`: returns a `UrlState`, and `toSearch` of it returns a string.
  - `round trip` (it.each over six states: default; campaigns plus campaign; custom range plus compare; missed-calls plus location plus dev; preset plus dev; custom with a blank end): `parseUrlState(toSearch(s))` deep-equals `s`.
  - `toSearch is canonical`: default is `''`; `{ view: 'campaigns', range: preset last7, dev: true }` is `'?view=campaigns&range=last7&dev'`; a campaign id with `&` and a space is percent-encoded and round-trips.
  - `apiParams`: overview with everything set yields only `range`; campaigns adds `campaign`; missed-calls adds `location`; custom adds `start` and `end`; blanks and `null` are omitted; `view` and `dev` never appear; the default state yields an empty set.
  - `withRange clears the comparison`; `withView keeps the rest`; `withCampaign(null)` removes it.
  - `customRange`: `('2026-09-01', ' 2026-09-05 ')` trims; either blank gives `null`.
  - `presetOf`: null range with default `last28` gives `last28`; preset `last7` gives `last7`; custom gives `null`.
  - `actionHref`: a link to `missed-calls` with `locationId 'loc_a'` from a state with preset `last7`, a campaign and dev gives `/?view=missed-calls&range=last7&location=loc_a&dev`; a link without a location gives no `location`; a link to `campaigns` carries no stale `location`.
  - `defaultsHref`: from a messy state with dev on and view campaigns gives `/?view=campaigns&dev`; from a plain overview gives `/`. Both `...Href` functions always start with `/`, so a link is never an empty href.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/web/urlState.test.ts`
  Expected: FAIL, cannot resolve `../../src/web/urlState`.

- [ ] **Step 3: Implement the module.** `URLSearchParams` for parsing; build the output string by hand so `dev` stays bare. `toSearch` returns `''` for the default; the `*Href` helpers return `` `/${toSearch(s)}` ``.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/web/urlState.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/web/urlState.ts tests/web/urlState.test.ts
  git commit -m "feat: URL state for the web app, parsed totally and written canonically

  The URL is the only state, so a link, refresh or back button reproduces the screen; a hand-edited URL must never crash it.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 3: Formatting and dates

**Files:**
- Create: `src/web/format.ts`, `tests/web/format.test.ts`

**Interfaces:**
- Consumes: `formatCount` (`src/core/views/format.ts`).
- Produces:
  ```ts
  export const BLANK = '—';                                   // the em dash, written as '—' in source
  export function formatLongDate(date: string): string;       // '2026-10-29' -> 'Oct 29, 2026'
  export function formatShortDate(date: string): string;      // -> 'Oct 29'
  export function formatDateSpan(start: string, end: string): string;  // 'Sep 1 – Sep 14, 2026'; across years both carry the year; one day -> that day
  export function formatSkippedRows(n: number): string | null;        // 0 -> null; 1 -> '1 row skipped'; 12 -> '12 rows skipped'
  export function humanize(value: string | null): string;    // 'paid_search' -> 'Paid search'; null or '' -> BLANK
  export function formatSpendUsd(usd: number): string;        // '$0.0012': AI spend is cents or less, so 4 decimals
  ```
  Date functions format in `timeZone: 'UTC'` from the parsed year, month and day, never `new Date('YYYY-MM-DD')` in local time. An input that isn't `YYYY-MM-DD` is returned unchanged; nothing throws.

- [ ] **Step 1: Write the failing tests.**
  - `dates`: `2026-10-29` gives `Oct 29, 2026`; `2026-01-01` gives `Jan 1, 2026` (a local-time bug shows `Dec 31, 2025` west of UTC); `2026-12-31` and a leap day `2028-02-29`; `formatShortDate('2026-09-01')` is `Sep 1`.
  - `the viewer's time zone cannot move a date` (Review Focus 4): for `TZ` in `Pacific/Kiritimati` (UTC+14), `America/Los_Angeles`, `Pacific/Pago_Pago` (UTC-11), set `process.env.TZ`, assert `formatLongDate('2026-01-01')` is `Jan 1, 2026` and `formatShortDate('2026-03-08')` is `Mar 8`; restore `TZ` in `afterEach`.
  - `spans`: same year `Sep 1 – Sep 14, 2026`; across years `Dec 28, 2026 – Jan 3, 2027`; start equal to end gives one date.
  - `bad input is returned unchanged`: `banana`, `''`, `2026-13-45`, `2026-9-1` for each date function, no throw.
  - `skipped rows`: `0` null, `1` `1 row skipped`, `12` `12 rows skipped`, `1204` `1,204 rows skipped`.
  - `humanize`: `paid_search` `Paid search`, `social` `Social`, `qualified_lead` `Qualified lead`, `null` and `''` give `BLANK`.
  - `formatSpendUsd`: `0` `$0.0000`, `0.0012` `$0.0012`, `12.5` `$12.5000`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/web/format.test.ts`
  Expected: FAIL, cannot resolve `../../src/web/format`.

- [ ] **Step 3: Implement.** One `Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ... })` built from `Date.UTC(y, m - 1, d)`; validate the string with a strict `^\d{4}-\d{2}-\d{2}$` and a round-trip check so `2026-13-45` is rejected.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/web/format.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/web/format.ts tests/web/format.test.ts
  git commit -m "feat: date and label formatting that ignores the viewer's time zone

  The data is in office-local dates; a browser in another zone must not move a day.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 4: API client and request state

**Files:**
- Create: `src/web/api.ts`, `src/web/requestState.ts`, `src/web/useApi.ts`, `tests/web/api.test.ts`, `tests/web/requestState.test.ts`

**Interfaces:**
- Consumes: `ApiErrorCode`, `Meta`, `DataNotesResponse` (`src/server/api.ts`, type-only).
- Produces:
  ```ts
  // api.ts
  export type ClientErrorCode = ApiErrorCode | 'network' | 'bad_response';
  export interface ClientError { code: ClientErrorCode; message: string; field?: string; status?: number }
  export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ClientError };
  export async function fetchApi<T>(path: string, params?: URLSearchParams, signal?: AbortSignal, fetchFn?: typeof fetch): Promise<ApiResult<T>>;
  //   never throws. 2xx + JSON -> ok. A body shaped { error: { code, message, field? } } -> that error plus status.
  //   2xx but not JSON (HTML, empty) -> 'bad_response'. Non-2xx and not that shape -> 'network'. fetch rejects (incl. abort) -> 'network'.

  // requestState.ts
  export type RequestState<T> =
    | { status: 'loading'; key: string }
    | { status: 'ready'; key: string; data: T }
    | { status: 'failed'; key: string; error: ClientError };
  export type RequestAction<T> = { type: 'start'; key: string } | { type: 'done'; key: string; result: ApiResult<T> };
  export function requestReducer<T>(state: RequestState<T>, action: RequestAction<T>): RequestState<T>;
  export function initialRequest<T>(key: string): RequestState<T>;

  // useApi.ts
  export function useApi<T>(path: string | null, params: URLSearchParams): { state: RequestState<T> | null; retry(): void };
  //   null path = no request, state null. Key = path + '?' + params + '#' + attempt. One AbortController per request,
  //   aborted when the key changes or the component unmounts; an aborted request never dispatches.
  ```
  The reducer: `start` always gives `loading` with the new key and **drops any old data** (stale numbers are never shown under a new range label). `done` whose key differs from the state's key returns the state unchanged.

- [ ] **Step 1: Write the failing tests.** `api.test.ts` uses a fake `fetchFn` returning `new Response(...)`.
  - `ok`: 200 JSON `{ a: 1 }` gives `{ ok: true, data: { a: 1 } }`; the URL called is `/api/overview?range=last7` for those params and `/api/meta` for none (no trailing `?`).
  - `server errors keep code, message, field and status` (it.each over 400 `bad_date` with `field: 'start'`, 400 `outside_data`, 400 `unknown_campaign`, 409 `no_data`, 500 `internal`): the result's `error` equals the body's with `status` added.
  - `not the API` (Review Focus 2): a 200 with `content-type: text/html` and body `<html>app</html>`; a 200 with empty body; a 200 with `{not json`: each is `bad_response` with a message that names the API and says to check that the server is running, and contains neither `Unexpected token` nor `<`.
  - `server down`: a 502 with a plain-text body; a 500 with an empty body; `fetchFn` rejecting `TypeError('Failed to fetch')`: each is `network` with a message to check that `npm start` is running and no raw error text.
  - `aborted`: a controller aborted before the call: returns a `network` result, does not throw.
  - `a very long error message from the server is kept as sent` (the server already shortens echoed values): a 400 with a 150-character message arrives intact.
  - `requestState.test.ts`:
    - `start gives loading and drops old data`: from a `ready` state with data, `start` with a new key is `{ status: 'loading', key: new }` with no `data`.
    - `done ok gives ready; done error gives failed`.
    - `a stale reply is ignored` (Review Focus 1): `start('a')`, `start('b')`, then `done('a', ok)` leaves `loading b`; then `done('b', ok)` gives `ready b` with b's data; a second late `done('a', …)` after that leaves `ready b` unchanged.
    - `a reply for the current key after a failure replaces it` (retry: `start('a#1')`, failed, `start('a#2')` loading, `done('a#2')` ready).
    - `initialRequest` is `loading`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/web/api.test.ts tests/web/requestState.test.ts`
  Expected: FAIL, cannot resolve.

- [ ] **Step 3: Implement the three files.** `useApi` is `useReducer` plus one `useEffect` keyed on the string key; it needs no test of its own because every decision is in `fetchApi` and `requestReducer` (say so in a comment).

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/web/api.test.ts tests/web/requestState.test.ts` then `npm run typecheck`
  Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/web/api.ts src/web/requestState.ts src/web/useApi.ts tests/web/api.test.ts tests/web/requestState.test.ts
  git commit -m "feat: API client and request state that ignore stale replies and name every failure

  A slow earlier response must never overwrite a newer one, and a dead server must read as a sentence, not a JSON parse error.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 5: Caveats, estimate formulas, error copy, screen choice

**Files:**
- Create: `src/web/models/caveats.ts`, `src/web/models/estimates.ts`, `src/web/models/errors.ts`, `src/web/models/screen.ts`, `tests/web/fixtures.ts`, `tests/web/caveats.test.ts`, `tests/web/errors.test.ts`

**Interfaces:**
- Consumes: Tasks 3 and 4; `ViewNotes` (`src/core/views/viewContext.ts`); `DateRange`; `Meta`; the Phase 5 builders and `serverFixture` (`tests/server/helpers.ts`).
- Produces:
  ```ts
  // caveats.ts
  export interface Caveat { id: 'clamped' | 'first_day' | 'last_day' | 'previous_first_day' | 'previous_last_day' | 'outcome_lag' | 'overlap'; text: string }
  export function caveatsFor(notes: ViewNotes, span: DateRange, options: { comparing: boolean }): Caveat[];
  //   fixed order: clamped, first_day, last_day, previous_first_day, previous_last_day, outcome_lag, overlap.
  //   The three previous/overlap ones only when options.comparing AND notes.comparison.available.

  // estimates.ts
  export type EstimateKind = 'spend' | 'cost_per_booking' | 'revenue_per_dollar';
  export function estimateFormulas(days: number): { kind: EstimateKind; label: string; formula: string }[];

  // errors.ts
  export function describeError(error: ClientError): { title: string; message: string; canReset: boolean; canRetry: boolean };

  // screen.ts
  export type Screen =
    | { screen: 'loading' }
    | { screen: 'error'; error: ClientError }
    | { screen: 'empty'; notes: string[] }
    | { screen: 'ready'; meta: Meta };
  export function screenFor(meta: RequestState<Meta> | null): Screen;

  // tests/web/fixtures.ts
  export function toJson<T>(value: T): T;                       // JSON.parse(JSON.stringify(value)): the browser sees JSON, not objects
  export function overviewFor(search: string): OverviewView;    // real buildOverview on serverFixture(), range from parseUrlState-style presets
  export function campaignsFor(search: string): CampaignsView;
  export function emptyRangeStore(): CallStore;                 // calls only on the first and last date; a middle range has none
  export function metaFor(store: CallStore): Meta;              // as GET /api/meta builds it
  ```
  Exact copy:
  - `clamped`: `` `Showing ${formatDateSpan(range.start, range.end)}: the range you asked for reached outside the data and was cut to fit.` ``
  - `first_day`: `` `${formatLongDate(span.start)}, the first day in the data, may be incomplete.` `` (only when `incompleteCurrent.includesFirstDay`); `last_day` likewise with "last day".
  - `previous_first_day`: `The comparison period includes the first day in the data, which may be incomplete.`; `previous_last_day` likewise.
  - `outcome_lag` (when `outcomeLag.applies`): `` `Recent bookings and revenue may still rise: in this export an outcome can be recorded up to ${formatCount(days, ['day','days'])} after the call.` ``
  - `overlap`: `The comparison period overlaps the selected range.`
  - Estimate formulas: spend `Estimated spend = daily budget × ${formatCount(days, ['day','days'])} in this range. The export has no actual spend, so this is an estimate.`; cost per booking `Estimated cost per booking = estimated spend ÷ bookings. Blank when the budget is $0 or there are no bookings.`; revenue per budget dollar `Revenue per budget dollar = revenue ÷ estimated spend. Blank when estimated spend is $0.` Labels: `Est. spend`, `Est. cost per booking`, `Est. revenue per budget $`.
  - `describeError`: for `bad_date`, `start_after_end`, `outside_data`, `bad_param`, `unknown_campaign`, `unknown_location`: title `That range or filter can't be used`, `message` is the server's text unchanged, `canReset` true. `no_data`: title `This export has no calls`, canReset false. `internal`: title `The server hit an unexpected error`, message `Try again. If it keeps happening, look at the terminal running npm start.`, canRetry true. `network` and `bad_response`: title `Can't reach the data`, message is the client's own sentence, canRetry true. `not_found`, `unknown_view`: title `Something is missing`, canReset true. `canRetry` is false everywhere else.
  - `screenFor`: `null` and `loading` give `loading`; `failed` gives `error`; `ready` with `hasData: false` gives `empty` with `meta.notes`; `ready` with data gives `ready`.

- [ ] **Step 1: Write the failing tests.**
  - `caveats` (on real `notes` from the fixtures; `span` is the fixture's 2026-09-01 to 2026-09-14):
    - `a mid-data range has no caveats`: a range in the middle of a 30-day store, ending more than the outcome lag before the last day, with `comparing: true`, gives `[]`.
    - `the first and last day of the data`: a range including both gives `first_day` and `last_day` with the exact copy above; a range including only the last gives only `last_day`.
    - `clamped`: `start=2026-09-10&end=2026-09-30` includes `clamped` with the exact span text.
    - `outcome lag`: `applies: true`, `days: 3` gives the sentence with `3 days`; `days: 1` gives `1 day`; `applies: false` omits it. (Hand-edit a copy of real notes for these.)
    - `previous-period caveats need a usable comparison`: with `comparing: true` and an available comparison whose window includes the first day, `previous_first_day` appears; with `comparing: false` it does not; with `comparison.available: false` (from `?range=all`) it does not, even though `incompletePrevious` may be set.
    - `overlap`: a hand-set `compare` overlapping the range (equal length) gives `overlap` when comparing.
    - `order is fixed`: a notes object with everything set returns the ids in the listed order.
    - `estimateFormulas`: three entries in order; `days 14` text contains `14 days`; `days 1` contains `1 day` and not `1 days`; every `label` contains `est.` case-insensitively; every formula says `estimate` or `Blank`.
  - `errors.test.ts`:
    - `every code has a title and message` (it.each over all `ClientErrorCode` values, including `network` and `bad_response`): non-empty strings.
    - `the server's message passes through verbatim` for each 400-class code with a 120-character message; `canReset` true.
    - `retry vs reset`: `network`, `bad_response`, `internal` are `canRetry` and not `canReset`; the 400-class codes are `canReset` and not `canRetry`; `no_data` is neither.
    - `screenFor`: the four cases, plus `empty` carries the notes in order.
    - `comparison wording matches the real server` (guards Issue 7): `headline(reason)` is tested in Task 6; here, build both reasons with `resolveComparison` and assert they still contain a colon (so the Task 6 split can't silently stop working).

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/web/caveats.test.ts tests/web/errors.test.ts`
  Expected: FAIL, cannot resolve.

- [ ] **Step 3: Implement the four modules and `fixtures.ts`.**

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/web/caveats.test.ts tests/web/errors.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/web/models/caveats.ts src/web/models/estimates.ts src/web/models/errors.ts src/web/models/screen.ts tests/web/fixtures.ts tests/web/caveats.test.ts tests/web/errors.test.ts
  git commit -m "feat: inline caveat text, estimate formulas, error copy and screen choice

  The marketer must see incomplete-day, lag and estimate notes next to the numbers; the wording and its conditions are tested against real server notes.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 6: Overview and Campaigns models

**Files:**
- Create: `src/web/models/overviewModel.ts`, `src/web/models/campaignsModel.ts`, `tests/web/overviewModel.test.ts`, `tests/web/campaignsModel.test.ts`

**Interfaces:**
- Consumes: Tasks 3 and 5; `OverviewView`, `CampaignsView`, `CampaignRow`, `UnattributedRow`, `Tile`; `Change`; `formatUsd`, `formatUsdPerDollar`, `formatRate`, `formatCount`, `formatPercentChange`, `formatPointsChange` (`src/core/views/format.ts`); `ActionLink`.
- Produces:
  ```ts
  // overviewModel.ts
  export type Tone = 'up' | 'down' | 'flat' | 'new';
  export interface TileModel {
    key: 'calls' | 'uniqueCallers' | 'answerRate' | 'bookings' | 'revenueUsd';
    label: string;                                    // Calls, Unique callers, Answer rate, Bookings, Revenue
    value: string;                                    // BLANK when the API value is null
    previous: string | null;                          // 'was 1,150'; null when there is no usable previous period
    change: { text: string; tone: Tone } | null;      // null: no comparison, or both zero
    unavailable: string | null;                       // the headline of the reason, when the comparison is unavailable
  }
  export interface OverviewModel {
    empty: boolean;                                   // calls.current === 0
    tiles: TileModel[];                               // fixed order above
    comparisonReason: string | null;                  // the full sentence, shown once
    topActions: { viewLabel: string; text: string; actionable: boolean; link: ActionLink }[];   // API order
  }
  export function overviewModel(view: OverviewView): OverviewModel;
  export function reasonHeadline(reason: string): string;   // text before the first ':'; the whole text if none

  // campaignsModel.ts
  export type SortKey = 'name' | 'channel' | 'calls' | 'bookings' | 'bookingRate' | 'revenueUsd'
    | 'estimatedSpendUsd' | 'estimatedCostPerBookingUsd' | 'revenuePerBudgetDollar';
  export interface CampaignSort { key: SortKey; dir: 'asc' | 'desc' }
  export const DEFAULT_SORT: CampaignSort;              // calls, desc
  export function nextSort(current: CampaignSort, key: SortKey): CampaignSort;   // same key flips; name and channel start asc, the rest desc
  export interface Cell { text: string; note?: string }  // note: why a cell is blank
  export interface CampaignRowModel { id: string | null; name: string; marks: ('best' | 'worst')[]; cells: Record<SortKey, Cell> }
  export interface CampaignsModel {
    empty: boolean;                                   // no calls in range at all, unattributed included
    columns: { key: SortKey; label: string; numeric: boolean; estimate: boolean }[];
    rows: CampaignRowModel[];                         // sorted by `sort`; unattributed is NOT in here
    unattributed: (CampaignRowModel & { trackingNumbers: { text: string }[] }) | null;   // pinned last, never sorted
    bestWorstNote: string | null;                     // bestWorst.reason, only when nothing is marked
    actions: { kind: ActionKind; text: string; actionable: boolean }[];
    chartChoices: { id: string; name: string }[];     // every campaign, in rows order
    selectedCampaignId: string | null;                // weekly?.campaignId
  }
  export function campaignsModel(view: CampaignsView, sort: CampaignSort): CampaignsModel;
  export function sortCampaignRows(rows: CampaignRow[], sort: CampaignSort): CampaignRow[];   // pure, returns a copy
  ```
  Rules. Percent and points: text from `formatPercentChange` / `formatPointsChange`; `new` reads `new`; `none` is `null`. Tone from the sign of the value after rounding to one decimal (a +0.04 prints `0.0%` and is `flat`). The answer-rate tile's `value` is `formatRate`, revenue `formatUsd`, counts `formatCount`. `previous` is `` `was ${value}` `` when `tile.previous !== null`. `unavailable` is `reasonHeadline(notes.comparison.reason)` for every tile when `!notes.comparison.available`. Row cells: calls and bookings `formatCount`; booking rate `formatRate`; revenue `formatUsd`; est. spend `formatUsd` or BLANK; est. cost per booking `formatUsd` or BLANK; revenue per budget dollar `formatUsdPerDollar` or BLANK; channel `humanize`. A blank cell carries a `note`: Unattributed (null spend): `Not applicable: no campaign, so no budget.`; spend 0: `No estimate: this campaign has a $0 budget.`; spend above 0 and zero bookings (cost per booking only): `No estimate: no bookings in this range.`; booking rate null (no calls): `No calls in this range.` Sorting: nulls last in both directions; ties by campaign id ascending; the name column sorts case-insensitively; sorting never touches `unattributed`. Column labels: `Campaign`, `Channel`, `Calls`, `Bookings`, `Booking rate`, `Revenue`, `Est. spend`, `Est. cost per booking`, `Est. revenue per budget $`; the three estimate columns have `estimate: true`. The names `Best` and `Worst` are the `marks`.

- [ ] **Step 1: Write the failing tests** (data from `overviewFor`/`campaignsFor` on `serverFixture()` through `toJson`, plus hand-built cases where noted).
  - `reasonHeadline`: the real strings from `resolveComparison` (before the data start gives one starting `No full previous period`; a 2-day against a 3-day gives one starting `No like-for-like comparison`) become exactly those two headlines; a string with no colon is returned whole; `''` returns `''`.
  - `overview tiles`: five tiles in order with the labels; `?range=last7` gives `calls.value '14'`, `previous 'was 14'`; revenue `$1,400`; answer rate `50.0%`; the change on each tile matches the API's `change` kind (assert against the JSON, not retyped numbers).
  - `changes` (hand-built tiles through `overviewModel` on a copy of the view): `{ kind: 'percent', value: 12.54 }` gives `+12.5%` tone `up`; `-3` gives `-3.0%` tone `down`; `0.04` gives `0.0%` tone `flat`; `{ kind: 'points', value: 3.2 }` gives `+3.2 points`; `{ kind: 'new' }` gives text `new` tone `new`; `{ kind: 'none' }` with a usable previous gives `change null` (both zero: nothing shown).
  - `no comparison` (`?range=all`): every tile has `change null`, `previous null` and `unavailable` starting `No full previous period`; `comparisonReason` is the API's full sentence; with a usable comparison both are `null`.
  - `empty range` (`emptyRangeStore`, a middle range): `empty true`; the five tiles show `0` and, for the answer rate, `BLANK`; top actions still present.
  - `top actions`: three, in API order `campaigns`, `locations`, `missed-calls`, labeled `Campaigns`, `Locations`, `Missed calls`; `text` equals the API action's `text`; `link` is the API's link (a missed-calls one with `locationId` when present); `actionable` is passed through.
  - `sorting`: `DEFAULT_SORT` order equals the API's row order (calls descending, ties by id); sort by `name` asc is case-insensitive; by `estimatedCostPerBookingUsd` desc and asc both leave null rows last; ties break by campaign id; the input array is not mutated; `nextSort(DEFAULT_SORT, 'calls')` flips to asc; `nextSort(.., 'name')` starts asc; `nextSort(.., 'revenueUsd')` starts desc.
  - `blank cells explain themselves` (PLAN.md edge case): a campaign with a $0 budget has estimated spend `$0`, cost per booking `BLANK` with the `$0 budget` note, revenue per budget dollar `BLANK`; a campaign with a budget and zero bookings has cost per booking `BLANK` with the `no bookings` note; the Unattributed row has spend, cost and revenue-per-dollar `BLANK` with the `Not applicable` note.
  - `blank is never infinity or NaN`: across every cell in a model built from a store with zero-budget and zero-booking campaigns, no `text` contains `Infinity`, `NaN` or `undefined`.
  - `best and worst`: the API's `isBest`/`isWorst` rows get `marks ['best']`/`['worst']`; with fewer than two eligible, no marks and `bestWorstNote` equals `bestWorst.reason`; when marks exist `bestWorstNote` is `null`.
  - `unattributed`: present only when the API has it, never inside `rows`, with tracking numbers as `` `${number} · ${formatCount(calls, ['call','calls'])}` `` in the API's order; `null` when absent.
  - `actions`: `shift_budget` then `fix_attribution` as the API orders them, texts passed through; a view with only a `no_budget_shift` action keeps `actionable false`.
  - `chart choices`: every campaign in rows order, including zero-call ones; `selectedCampaignId` equals `weekly.campaignId`, and is `null` when `weekly` is `null`.
  - `very long names stay whole` (Review Focus 5, PLAN.md edge case): a 300-character name with no spaces and `<img src=x onerror=alert(1)>` as names: `name` and the `chartChoices` name are returned unchanged and untruncated.
  - `empty campaigns range`: `empty true` when every row and unattributed have zero calls.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/web/overviewModel.test.ts tests/web/campaignsModel.test.ts`
  Expected: FAIL, cannot resolve.

- [ ] **Step 3: Implement both modules.** No arithmetic on metrics: every value is formatted from the API field.

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/web/overviewModel.test.ts tests/web/campaignsModel.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/web/models/overviewModel.ts src/web/models/campaignsModel.ts tests/web/overviewModel.test.ts tests/web/campaignsModel.test.ts
  git commit -m "feat: Overview and Campaigns view models: change text, blanks with reasons, sorting

  Every choice about what the user reads is decided in tested pure code, so the components only print it.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 7: Weekly chart model and data notes model

**Files:**
- Create: `src/web/models/weeklyChart.ts`, `src/web/models/dataNotesModel.ts`, `tests/web/weeklyChart.test.ts`, `tests/web/dataNotesModel.test.ts`

**Interfaces:**
- Consumes: Tasks 3 and 6; `CampaignsView['weekly']`, `WeekBucket`; `DataNotesResponse`, `DataNotes`, `BadReason`, `BAD_REASONS`.
- Produces:
  ```ts
  // weeklyChart.ts
  export interface WeeklyChartModel {
    title: string;                                    // `Calls per week: ${name}`
    bars: { label: string; range: string; calls: number; partial: boolean }[];   // label 'Sep 7', range 'Sep 7 – Sep 13'
    hasPartial: boolean;
    allZero: boolean;
  }
  export function weeklyChartModel(weekly: CampaignsView['weekly']): WeeklyChartModel | null;

  // dataNotesModel.ts
  export interface NotesSection { title: string; items: { label: string; value: string }[]; list?: string[] }
  export function dataNotesModel(response: DataNotesResponse): NotesSection[];
  export function badReasonLabel(reason: BadReason): string;   // a Record<BadReason, string> inside, so a new reason is a compile error
  ```
  Sections, in order, with these labels: **Rows and duplicates** (Rows read; Calls after removing duplicates; Duplicate rows collapsed; Calls whose duplicate rows tied on updated_at); **Unattributed** (Calls with no campaign; Of those, no tracking number; list: `${trackingNumber} · ${count calls}`); **Pending** (Answered calls with no outcome yet); **Bad rows** (Rows skipped; Calls dropped as bad; one item per reason with a count above 0 using `badReasonLabel`; value `None` when `badRows` is 0; list: each `referenceIssues` entry as `${file} row ${rowNumber}: ${reason}`); **Revenue** (Revenue on non-booked calls, ignored: `${count} calls, ${formatUsd(usd)}`; Booked calls with no revenue); **Outcome lag** (Longest wait for an outcome: `formatCount(days, ['day','days'])`, or `No later updates seen` when 0); **AI** (Status: `Off (no API key)` / `On` / `Budget reached`; Spend so far: `formatSpendUsd`; Cache hits; Checker failures); **Load notes** (only when `notes` is non-empty; list is the notes).

- [ ] **Step 1: Write the failing tests.**
  - `weeklyChartModel`: `null` in gives `null`; weeks pass through with `partial`; the first and last weeks of a range wider than a week and clipped by the data are `partial true`, a full inside week `false`; labels and ranges use `formatShortDate` (`Sep 7`, `Sep 7 – Sep 13`); a zero-call week is kept with `calls 0`; `hasPartial` true when any; `allZero` true when every bar is 0; a one-week range that is wholly partial; the title carries the campaign name unchanged, including a 300-character one and `<b>x</b>`.
  - `dataNotesModel` on `serverFixture().dataNotes`: the nine section titles in order (`Load notes` only when notes exist; test both); every `value` is a non-empty string; none contains `undefined`, `NaN` or `[object`.
  - `values` on a hand-built `DataNotes` (rowsRead 5411, callsAfterDedup 5000, duplicateRowsCollapsed 411, tiedCalls 3, unattributedCalls 144, 10 tracking numbers, pendingCalls 41, revenueOnNonBookedCalls 2 with 530 dollars, bookedWithoutRevenueCalls 1, outcomeLagDays 3): `5,411`, `5,000`, `411`, `3`, `144`, `41`, `2 calls, $530`, `1`, `3 days`; the tracking list has 10 entries.
  - `bad rows`: with `badRows 0` the value is `None` and no per-reason items; with two reasons above 0 only those two appear, labelled by `badReasonLabel`, and `Rows skipped` shows the total; a `referenceIssues` entry appears in the list.
  - `badReasonLabel` is defined (non-empty, no underscore) for every `BAD_REASONS` entry.
  - `outcome lag 0` reads `No later updates seen`; `1` reads `1 day`.
  - `AI`: `off` is `Off (no API key)`, `on` is `On`, `budget_reached` is `Budget reached`; spend `0.0012` is `$0.0012`.

- [ ] **Step 2: Run to verify they fail**

  Run: `npx vitest run tests/web/weeklyChart.test.ts tests/web/dataNotesModel.test.ts`
  Expected: FAIL, cannot resolve.

- [ ] **Step 3: Implement both modules.**

- [ ] **Step 4: Run to verify they pass**

  Run: `npx vitest run tests/web/weeklyChart.test.ts tests/web/dataNotesModel.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/web/models/weeklyChart.ts src/web/models/dataNotesModel.ts tests/web/weeklyChart.test.ts tests/web/dataNotesModel.test.ts
  git commit -m "feat: weekly chart and data notes models

  Partial weeks are flagged in data the chart must draw, and every data-notes line from PLAN.md 3.4 is covered, including the case with no bad rows.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 8: Shell, range control, request frame, URL hook

**Files:**
- Create: `src/web/useUrlState.ts`, `src/web/components/Link.tsx`, `Header.tsx`, `Nav.tsx`, `RangeControl.tsx`, `RequestFrame.tsx`, `Caveats.tsx`, `EstimateNote.tsx`, `ComingSoon.tsx`
- Modify: `src/web/App.tsx`, `src/web/styles/base.css`

**Interfaces:**
- Consumes: Tasks 2 to 5.
- Produces (props only; no component fetches or decides):
  ```ts
  // useUrlState.ts
  export function useUrlState(): { state: UrlState; navigate(next: UrlState, mode?: 'push' | 'replace'): void };
  //   initial value from window.location.search; a popstate listener re-reads it; navigate writes toSearch via history.

  Link({ href: string; children; className? })               // plain left-click: pushState + notify; modified clicks and middle-click fall through to the browser
  Header({ meta: Meta; dev: boolean; dataNotesOpen: boolean; onToggleDataNotes(): void })
  Nav({ state: UrlState })                                    // four links from VIEW_ORDER, aria-current="page" on the active one, each keeps range, compare, dev
  RangeControl({ state: UrlState; meta: Meta; error: ClientError | null; onChange(range: RangeChoice | null): void })
  RequestFrame<T>({ state: RequestState<T> | null; loadingLabel: string; resetHref: string; onRetry(): void; children(data: T): ReactNode })
  Caveats({ items: Caveat[] })
  EstimateNote({ days: number })                              // one <details>: summary "How the estimates work", the three formulas
  ComingSoon({ view: string })                                // "Not built yet (Phase 8)."
  ```
  Behavior. **Header:** product title; `Data as of ${formatLongDate(meta.span.end)}`; `formatSkippedRows(meta.skippedRows)` when not null; a "Data notes" button **only when `dev`** (nothing, not a hidden element, otherwise). **RangeControl:** three preset buttons (`Last 7 days`, `Last 28 days`, `All data`) with `aria-pressed` on the active one (`presetOf`); two date inputs with `min`/`max` from `meta.span` and an Apply button disabled until `customRange` is non-null; picking a preset or Apply calls `onChange`; when `error` has `field` `start`/`end`/`compareStart`/`compareEnd` the message shows beside the control with `role="alert"`. It renders even when the view request failed. **RequestFrame:** `null` or `loading` renders `role="status"` with `loadingLabel`; `failed` renders `role="alert"` with `describeError`'s title and message, a **Reset to defaults** link (`resetHref`) when `canReset` and a **Try again** button when `canRetry`; `ready` renders `children(data)`. **App:** fetches `/api/meta` first; `screenFor(meta)` picks: loading and error through `RequestFrame`, `empty` shows the notes and no range control, `ready` shows Header, Nav, RangeControl and the active view (Overview and Campaigns arrive in Task 9; Locations and Missed calls show `ComingSoon`). The view request is `useApi(path, apiParams(state, view))`, skipped for `ComingSoon` views. A bad URL range surfaces as the view request's error; the RangeControl receives it when it has a `field`.

- [ ] **Step 1: Implement the components and hook** to the behavior above, with `base.css` styles through tokens only. Use native elements: `<nav>`, `<button>`, `<input type="date">`, `<details>`.

- [ ] **Step 2: Verify**

  Run: `npm run typecheck` then `npm test`
  Expected: no type errors, all tests pass (the token guard still passes).

  Run: `npm run build`
  Expected: builds.

  Run: `PORT=3917 npm start` in the background and open `http://127.0.0.1:3917/` and `http://127.0.0.1:3917/?view=campaigns&range=last7&dev`; stop the server. Check by eye: the shell, header, nav, presets and date inputs render; with `?dev` the Data notes button shows. (The views themselves arrive in Task 9. No automated test covers this task directly; Task 11 renders these components to a string.)

- [ ] **Step 3: Commit**

  ```bash
  git add src/web/useUrlState.ts src/web/components src/web/App.tsx src/web/styles/base.css
  git commit -m "feat: app shell with nav, range control, request frame and caveat components

  The URL drives everything; the range control stays usable when a request fails so a bad range can be fixed in place.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 9: Overview and Campaigns views, weekly chart

**Files:**
- Create: `src/web/components/OverviewView.tsx`, `CampaignsView.tsx`, `CampaignTable.tsx`, `WeeklyChart.tsx`
- Modify: `src/web/App.tsx`, `src/web/styles/base.css`

**Interfaces:**
- Consumes: Tasks 5 to 8.
- Produces:
  ```ts
  OverviewView({ view: OverviewView; state: UrlState; span: DateRange })
  CampaignsView({ view: CampaignsView; state: UrlState; span: DateRange; onSelectCampaign(id: string): void })
  CampaignTable({ model: CampaignsModel; sort: CampaignSort; onSort(key: SortKey): void })    // exported so Task 11 can render it alone
  WeeklyChart({ model: WeeklyChartModel })
  ```
  **OverviewView:** `Caveats` from `caveatsFor(view.notes, span, { comparing: true })`; five tiles from `overviewModel` (label, value, `previous`, the change with its sign and a word for the tone, and the short `unavailable` headline when there is no comparison); the full `comparisonReason` once under the tiles; when `empty`, the line `No calls in this range.`; then **Top actions**: three list items in API order, each the view label, the `text`, and a `Link` to `actionHref(state, link)`; a non-actionable item has the muted class and still links. **CampaignsView:** `Caveats` with `comparing: false`; the actions (text, plus the tracking-number list under `fix_attribution`); `EstimateNote` with `view.range.days`; the `CampaignTable`; the weekly chart section with a `<select>` of `chartChoices` (value `selectedCampaignId`, change calls `onSelectCampaign`); when `empty`, `No calls in this range.` replaces the table. **CampaignTable:** one `<table>`; headers are buttons with `aria-sort` on the sorted column; sort state is local `useState(DEFAULT_SORT)`; best and worst rows carry a text badge `Best` / `Worst` beside the name (not color alone); a blank cell shows its `text` and, when it has a `note`, the note as `title` and visually hidden text; `name` cells carry `title={name}`; the Unattributed row is last, styled apart, with its tracking numbers listed under the name; `bestWorstNote` shows above the table as `No best or worst marked: ${note}` when set. **WeeklyChart:** read the `dataviz` skill before writing it. A Recharts bar chart, one bar per week, calls on the y axis; partial bars use `url(#partial-hatch)` (an SVG hatch pattern in `--color-chart-bar-partial`) and the legend line `Hatched bars are partial weeks.` shows when `hasPartial`; the tooltip shows the week's `range`, the calls and `partial week` when partial; bars labelled with `label`; an accessible `<table>` alternative (visually hidden) lists the same values; colors only through `var(--color-chart-bar)` and `var(--color-chart-bar-partial)`.

- [ ] **Step 1: Implement the four components** and wire Overview and Campaigns into `App.tsx`. `onSelectCampaign` calls `navigate(withCampaign(state, id))`.

- [ ] **Step 2: Verify**

  Run: `npm run typecheck`, `npm test`, `npm run build`
  Expected: all green.

  Run: `PORT=3917 npm start` in the background; load `http://127.0.0.1:3917/?range=all`, `?view=campaigns&range=last28` and `?view=campaigns&range=last28&campaign=<an id from /api/meta>`; stop the server. Check by eye that numbers match `curl -s .../api/overview?range=all` (5,000 calls, 1,204 bookings, $432,894). The full click-through is Task 12.

- [ ] **Step 3: Commit**

  ```bash
  git add src/web/components/OverviewView.tsx src/web/components/CampaignsView.tsx src/web/components/CampaignTable.tsx src/web/components/WeeklyChart.tsx src/web/App.tsx src/web/styles/base.css
  git commit -m "feat: Overview and Campaigns views with actions, estimates and the weekly chart

  Each view ends in its action; every number printed is the API's, formatted.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 10: Dev-mode data notes panel

**Files:**
- Create: `src/web/components/DataNotesPanel.tsx`
- Modify: `src/web/App.tsx`, `src/web/styles/base.css`

**Interfaces:**
- Consumes: Tasks 4, 7, 8; `DataNotesResponse`.
- Produces:
  ```ts
  DataNotesPanel({ sections: NotesSection[]; onClose(): void })    // presentational; role="complementary", labelled "Data notes", a Close button
  ```
  `App` owns `dataNotesOpen` (local state, not in the URL). The panel and its Header button exist **only when `state.dev` is true**. Opening it for the first time runs `useApi<DataNotesResponse>('/api/data-notes', empty params)` inside a small wrapper component that is mounted only while the panel is open, wrapped in `RequestFrame`; so without `?dev` no `/api/data-notes` request is ever made. The panel is available from every view and keeps the current view on screen. Escape closes it and returns focus to the Header button.

- [ ] **Step 1: Implement the panel and the wiring.**

- [ ] **Step 2: Verify**

  Run: `npm run typecheck`, `npm test`, `npm run build`
  Expected: all green.

  Run: `PORT=3917 npm start` in the background; load `/?dev`, click Data notes on Overview and on Campaigns; load `/` without `dev` and confirm no button and (browser network tab) no `/api/data-notes` request; stop the server.
  Expected: the panel lists rows read 5,411, calls after duplicates 5,000, unattributed 144, pending 41, AI `Off (no API key)`.

- [ ] **Step 3: Commit**

  ```bash
  git add src/web/components/DataNotesPanel.tsx src/web/App.tsx src/web/styles/base.css
  git commit -m "feat: data notes panel, dev mode only

  PLAN.md 3.4: ?dev shows it from every view; without the flag neither the entry point nor the request exists.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 11: Render tests for the dumb components

**Files:**
- Create: `tests/web/render.test.tsx`

**Interfaces:**
- Consumes: the components from Tasks 8 to 10; `renderToStaticMarkup` from `react-dom/server` (part of `react-dom`; no new package); `tests/web/fixtures.ts`.
- Produces: nothing.

These are not browser tests: they render props to an HTML string in Node and assert on it. They cover only what a model test cannot: that the component prints the model, and that dev-only things are absent.

- [ ] **Step 1: Write the tests.**
  - `Header without dev has no data notes entry` (done-when): `dev: false` markup contains neither `Data notes` nor a `<button` for it; `dev: true` contains the button. The as-of text reads `Data as of Oct 29, 2026` for a meta whose span ends `2026-10-29`; `12 rows skipped` appears when `skippedRows` is 12 and nothing about skipped rows when 0.
  - `Nav marks the current view and keeps dev`: four links in order; the active one has `aria-current="page"`; with `dev` every `href` ends in `&dev` or is `/?dev`.
  - `RequestFrame states` (PLAN.md edge case): `null` and `loading` render `role="status"` and the label; `failed` with a 400 renders `role="alert"`, the server's message, the Reset link with the `resetHref` and no Try again; `failed` `network` renders Try again and no Reset; `ready` renders the children output.
  - `RangeControl`: with the default `last28` the matching button has `aria-pressed="true"` and the others `false`; the date inputs carry `min` and `max` from the span; Apply is `disabled` with blank dates; an `error` with `field: 'start'` shows `role="alert"` with the message; it renders for a state whose view failed (Review Focus 3).
  - `Caveats` renders each item's text and nothing for `[]`. `EstimateNote` renders a `<details>` with all three formulas and the day count.
  - `OverviewView`: five tiles; with `?range=all` each tile shows `No full previous period` once per tile and the full reason once; no change element on a tile with `change null`; a `new` change reads `new`; empty range renders `No calls in this range.`; Top actions are three items in order with hrefs from `actionHref`; a non-actionable item has the muted class.
  - `CampaignTable` (PLAN.md edge cases): a blank cost cell renders the dash and its note; the Unattributed row is the last `<tr>` of `<tbody>`; the sorted header has `aria-sort="descending"` for the default and none elsewhere; Best and Worst badges appear as text; `bestWorstNote` renders with its prefix; a 300-character name appears whole in the markup and in `title`; a name `<img src=x onerror=alert(1)>` appears escaped (`&lt;img`) and the markup contains no `<img`; every estimate column header contains `est.` case-insensitively; no cell contains `Infinity`, `NaN` or `undefined`.
  - `DataNotesPanel`: renders each section title and item; has `role="complementary"` and a Close button.
  - `ComingSoon` says `Not built yet`.

- [ ] **Step 2: Run to verify they fail or pass as expected**

  Run: `npx vitest run tests/web/render.test.tsx`
  Expected: PASS if Tasks 8 to 10 followed their behavior notes. Any failure is a real gap in a component: fix the component, not the test. If Recharts will not render under Node, render `CampaignTable` alone (it is exported for this) and say so.

- [ ] **Step 3: Run the whole suite and typecheck**

  Run: `npm test` then `npm run typecheck`
  Expected: all pass. Show both outputs.

- [ ] **Step 4: Commit**

  ```bash
  git add tests/web/render.test.tsx
  git commit -m "test: render the web components to strings to pin dev-only, blank and escaped output

  The edge cases PLAN.md lists for this phase show only in rendered output; this checks them without a browser or a new package.

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 12: README, hard-coding guard, and the click-through

**Files:**
- Modify: `README.md`, `tests/core/different-names.test.ts` (only if it needs to cover `src/web`; it scans `src/` recursively, so check first)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new in `src/`.

- [ ] **Step 1: Update `README.md`.** Commands table: `npm start` builds the web app then serves it and the API at `http://127.0.0.1:3000`; `npm run build`; `npm run dev` (server watching plus Vite with hot reload, `/api` proxied; the page is at Vite's address, printed on start). Add a short "Web app" section: the four nav items (Locations and Missed calls arrive in Phase 8), the URL parameters (`view`, `range`, `start`, `end`, `campaign`, `dev`), "add `?dev` to the URL to open the Data notes panel", and that the extended export is opened with `DATA_DIR=data/extended npm start`. Say nothing about features that don't exist.

- [ ] **Step 2: Run the hard-coding guard and the full suite**

  Run: `npx vitest run tests/core/different-names.test.ts` then `npm test`, `npm run typecheck`, `npm run build`
  Expected: all pass. If the scan fails, a real date, name or `+1-555` slipped into `src/web/`; fix the source. Show the outputs.

- [ ] **Step 3: Run the click-through checklist** below in a real browser against `npm start` on the shipped export, then the Campaigns items again with `DATA_DIR=data/extended npm start`. If you have no browser, **say so, give me the commands, and do not report the checklist as passed.** Report each item as pass, fail or not run, with what you saw. Show the results and **stop and wait for review**.

- [ ] **Step 4: Commit**

  ```bash
  git add README.md
  git commit -m "docs: README covers the web app, npm start's build step and ?dev

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

## Click-through checklist (PLAN.md Phase 7 done-when, expanded into steps)

Run on the shipped export with `npm start`; the data spans 60 days and the default is Last 28 days.

1. **Loads:** open `http://127.0.0.1:3000/`. Header shows `Data as of <the last data day>` and `N rows skipped`; Overview shows five tiles with changes against the 28 days before; Top actions lists Campaigns, Locations, Missed calls, each with a number. Locations and Missed calls links open a "Not built yet" page (Phase 8).
2. **Presets:** click Last 7 days, Last 28 days, All data. Each reloads, the pressed button changes, and the URL gains `?range=last7` etc.
3. **Custom range:** pick two dates inside the data and Apply: the URL gains `start` and `end`, the tiles change. Apply stays disabled until both dates are set. Pick a start after the end: the server's message shows beside the control, the control stays usable, and picking a good range recovers. Pick a range partly past the data end: a caveat says it was cut to fit.
4. **Refresh keeps state:** with a custom range on Campaigns with a campaign chosen, press F5. Same view, range, campaign. Back and forward move through the earlier states. Paste `/?view=zzz&range=` : the Overview opens with defaults, no error.
5. **All data hides change, with a reason:** on All data every tile shows `No full previous period` and the one-line reason appears once under the tiles. A custom 3-day range at the very start of the data shows the same.
6. **Caveats without dev mode:** a range ending on the last data day shows the last-day-may-be-incomplete note and the outcome-lag note; a range starting on the first data day shows the first-day note. Switch to a range ending a month before the end: the lag note and last-day note disappear.
7. **Campaigns:** the table is ranked by calls; click any header to sort and click again to reverse (`aria-sort` changes, blanks stay last); Best and Worst badges appear on two rows with their est. revenue per budget dollar; Organic and Direct show `—` for cost per booking and hover or read the note; the Unattributed row is last with its tracking numbers; the shift-budget and fix-attribution actions read with numbers; `How the estimates work` opens three formulas; "est." is in three headers.
8. **Weekly chart:** it shows the top campaign by calls; changing the picker changes the chart and the URL (`campaign=`); the first and last bars are hatched with the legend `Hatched bars are partial weeks.`; hovering a bar shows its week range and calls.
9. **Dev mode:** with `?dev`, a Data notes button shows and opens the panel from Overview and from Campaigns; it lists rows read 5,411, calls after duplicates 5,000, unattributed 144, pending 41, and AI `Off (no API key)`; Escape closes it. Without `?dev` there is no button, and the browser network tab shows no `/api/data-notes` request.
10. **States:** throttle the network in the dev tools and switch ranges: a loading message shows, never the old numbers under the new range. Stop the server and click a preset: a plain "Can't reach the data" message with Try again, and Try again works after restarting. Start with an empty-header `calls.csv` in a temp `DATA_DIR`: the page says the export has no calls and shows the load note.
11. **Empty range and long names:** choose a one-day range with no calls (extended or a fixture) and see `No calls in this range.` with no error. With a campaign name of 300 characters in a temp export, the table wraps it, the page does not scroll sideways, the picker still works.
12. **Other time zone:** set the operating system or browser to a zone far from the offices; the as-of date and week labels do not move.
13. **Extended export:** `DATA_DIR=data/extended npm start`; on Campaigns last 28 days, the surge campaign tops the list; the chart for it shows the jump; the numbers still match `curl -s '.../api/campaigns?range=last28'`.

## Edge-case coverage (PLAN.md Phase 7 list and done-when)

| PLAN.md item | Test |
| --- | --- |
| loading and error states for each request | Task 4 (`fetchApi`, `requestReducer`: server down, not JSON, 400, 409, 500, stale), Task 5 (`describeError`, `screenFor`), Task 11 (`RequestFrame` for meta, view and data notes), checklist 10 |
| empty range | Task 6 (`overviewModel` and `campaignsModel` `empty`), Task 11, checklist 11 |
| blank cost-per-booking cells | Task 6 (`blank cells explain themselves`, `blank is never infinity or NaN`), Task 11 |
| very long campaign names | Task 6 and 7 (kept whole), Task 11 (whole, escaped, `title`), checklist 11 (wrapping is CSS) |
| presets, custom range, refresh keeps state | Task 2 (parse, round trip, `withRange`), Task 11 (`RangeControl`), checklist 2 to 4 |
| change hidden on "All data" with a reason | Task 6 (`no comparison`, `reasonHeadline`), Task 5 (real server wording), Task 11, checklist 5 |
| best/worst marked | Task 6 (`best and worst`), Task 11, checklist 7 |
| weekly chart switches campaign | Task 2 (`withCampaign`, `apiParams`), Task 6 (`chart choices`), checklist 8 |
| partial weeks marked | Task 7 (`weeklyChartModel`), checklist 8 |
| `?dev`: panel from every view; absent without | Task 2 (`dev by presence`), Task 11 (`Header`), Task 10 and checklist 9 (no request without the flag) |
| estimates labeled; lag and incomplete-day notes without dev mode | Task 5 (`caveatsFor`, `estimateFormulas`), Task 6 (column labels), Task 11, checklist 6, 7 |

## Self-review notes

- **Spec coverage:** app shell with navigation (Tasks 8, 9); date range with presets and custom and state in the URL (Tasks 2, 8); inline caveats from PLAN.md 3.3 except the takeaway marker, which is Phase 9's (Task 5, 9); dev-mode data notes panel with every line of 3.4 (Tasks 7, 10); Overview and Campaigns with actions, best/worst, unattributed row, weekly chart and partial weeks (Tasks 6, 7, 9); design tokens in one place (Task 1); the click-through checklist (end of file, Task 12).
- **Type consistency:** `UrlState`, `RangeChoice`, `apiParams`, `actionHref`, `defaultsHref` (Task 2) are used by Tasks 8 to 10; `ClientError`, `RequestState` (Task 4) by Tasks 5, 8, 10; `Caveat`, `estimateFormulas`, `describeError`, `screenFor` (Task 5) by Tasks 8 and 9; `OverviewModel`, `CampaignsModel`, `SortKey`, `CampaignSort` (Task 6) by Tasks 9 and 11; `WeeklyChartModel`, `NotesSection` (Task 7) by Tasks 9 and 10.
- **Proportion:** PLAN.md's Phase 7 is about 25 lines; this plan is far longer because it fixes the URL contract, the exact copy, every blank and caveat rule, and the test for each edge case, none of which PLAN.md says. Components hold no logic worth a test of their own; they are described by behavior, not code.
- **Not in this phase:** Locations and Missed calls views, the CSV download button, the heatmap (Phase 8); takeaways and the AI/template marker (Phase 9); a picker for a second range (S2); print layout (S3); motion (S5); component tests with a DOM; Framer Motion. The look half of S5 was done early (see "Style change"); its S5 sign-off is still the user's.
