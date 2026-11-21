# Phase S5 (Visual polish with motion) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the look PLAN.md S5 asks for and add short, eased motion that is fully off under `prefers-reduced-motion`, without changing any number, action or sentence the app shows.

**Architecture:** The colour look already shipped early (DECISIONS 2026-11-19, "S5 look"). What is left is motion, the type pairing, an accent audit and tests that pin the look criteria. Motion durations and easing stay in `tokens.css`; a pure module reads them into a `MotionSettings` object, and every animated component takes its timing from that one object, which is "off" under reduced motion. Components stay thin; decisions (what tweens, from what, what is keyed) live in pure modules with Node tests.

**Tech Stack:** TypeScript (strict), vitest, React with `react-dom/server` render tests, Framer Motion (ask first), Recharts' own animation props for bars, plain CSS tokens. Possibly `@fontsource/ibm-plex-mono` (ask first).

**Spec:** `PLAN.md` ("S5: Polished visual design with motion", section 6 "Dependencies", section 8 "Web"), `docs/BRIEF.md` (the slice is never at risk), `CLAUDE.md`, `docs/DECISIONS.md` (rows "S5 look", Phase 7 rows on loading, `keepPrevious` and tokens), `src/web/styles/tokens.css`, `base.css`, `print.css`, `src/web/App.tsx`, `components/OverviewView.tsx`, `WeeklyChart.tsx`, `Takeaway.tsx`, `Heatmap.tsx`, `models/overviewModel.ts`.

## Global Constraints

- Work **one task at a time**. After the last task run `npm test`, `npm run typecheck` and `npm run build`, run the click-through checklist at the end of this file, show the results, then **stop** and wait (CLAUDE.md). S5 is done only when you sign off on the look in the browser.
- **Ask before each install** (PLAN.md section 6, CLAUDE.md): Framer Motion, and, if you approve Gap 6, the Plex Mono font package. Nothing else is added. If something else seems needed, stop and ask.
- **No number, action, sentence, URL parameter or API shape changes.** Every number still comes from code and every one is formatted by the existing core format functions. Animation only moves between values the server already sent, and it ends on the exact formatted text (Task 4).
- **All motion is 150 to 300 ms, eased, and off under `prefers-reduced-motion`.** Durations and the ease live only in `tokens.css` (`--motion-fast` 150ms, `--motion-base` 200ms, `--motion-slow` 300ms, `--ease-standard`); no duration or easing literal anywhere else in `src/web`.
- **The print summary and printed pages never show a half-finished animation** (Review Focus 4). `PrintSummary.tsx`, `printModel.ts` and the print shell import nothing from Framer Motion.
- The app works with AI off; the takeaway animation is cosmetic and the takeaway stays an add-on.
- No hard-coded names, ids or dates in `src/`; `tests/core/different-names.test.ts` already scans `src/web` and `index.html`.
- No raw colour or duration literals outside `tokens.css` (`tests/web/tokens.test.ts` scans every css, ts and tsx file).
- Names from the data are text only, never markup. Never read, print or `git add` `.env`. Do not write to `docs/AI_COST_LOG.md` or edit `docs/BRIEF.md`, `PLAN.md` or `CLAUDE.md`. **Stage files by name, never `git add -A`**; run `git status` first and leave today's uncommitted `docs/AI_COST_LOG.md` alone.
- Commit after each task, small, message says why, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Prefer simple, readable code; a reviewer will walk through all of it.

## Gaps in PLAN.md this plan fills

PLAN.md's S5 is a list of criteria, **with no "Edge cases" line** (every other phase has one). So I treated each look criterion, each motion criterion and each done-when line as the requirement that needs a test, and added the Review Focus below for the inputs the spec implies. Criteria that need eyes (generous spacing, "does not read as generic") cannot be tested in Node; they go to the sign-off checklist and are labelled that way. The rest are proposed here and recorded in `docs/DECISIONS.md` as "awaiting review". Please confirm or change them before I build.

1. **Reduced motion is gated by us, not only by Framer.** In the installed typings, `MotionConfig reducedMotion="user"` "switches transform animations off"; opacity and number animations keep running. So the app wraps everything in `MotionConfig reducedMotion="user"` **and** every animation reads `MotionSettings.enabled`, which is false under reduced motion (live: it follows the OS setting while the app is open) and whenever a duration token reads 0 or is unreadable. Durations are read from the CSS custom properties at run time, so `tokens.css` stays the one source and its existing `0ms` reduced-motion block is honoured.
2. **Which numbers tween: the five Overview tiles only.** Tables (they sort and paginate, so a tweened column would pass through out-of-order values), action sentences, takeaways, the callback list and the lost-value figure never tween. A tile tweens from the last value that tile showed (kept in memory across the loading gap, so no stale number is ever on screen while loading) to the new one. First load, an unchanged value, a blank, and reduced motion show the value at once. Mid-flight frames go through the same formatter as the final text and are display only; the text at rest is always the server's value, exactly.
3. **"Charts animating between datasets".** The weekly chart stays mounted when only the chosen campaign changes (DECISIONS Phase 7 review fix, `keepPreviousFor`), so there the bars animate from one dataset to the other. A range change still shows the loading message and no old numbers (DECISIONS Phase 7, rule 9 and CLAUDE.md), so there the bars grow in from the baseline. I am not reversing the loading rule to get a smoother range change. The heatmap's two modes cross-fade.
4. **Bars use Recharts' own animation, not Framer Motion.** PLAN.md says Framer Motion for all motion, but Framer cannot animate a Recharts bar. The chart's animation flag, duration and easing come from the same `MotionSettings` (Task 3), so reduced motion and the durations stay in one place. Recharts takes keyword easing, so the chart gets `ease-out`, the nearest keyword to the token's curve.
5. **View transitions** are a short fade and a few pixels of rise on the content below the range control, keyed by the view (the answer page is its own key). Range, campaign and office changes never change the key, so the chart select keeps focus and the table keeps its sort. `AnimatePresence` runs in `wait` mode and not on first load. The header, nav, ask box and range control do not animate.
6. **Type pairing (your call).** The criterion says "a deliberate type pairing (not default system or Inter-only)"; today the app has one family (DECISIONS "S5 look" said this was your call). I propose **IBM Plex Sans** (text, headings) **with IBM Plex Mono** for the figures and small-caps labels: same superfamily, so it reads as designed, and it needs one more package, `@fontsource/ibm-plex-mono` (latin 400 and 500). If you say no, the app stays on one family, the pairing criterion is reported as **not met** at sign-off, and Task 7's pairing test is replaced by "the first family is not Inter or a system font".
7. **"One accent used for actions".** The brand green is the accent and may appear only on things you can act on: links, buttons, the current tab, focus rings, the download link. Data marks (bars, heat steps) keep their own tokens (`--color-chart-bar`, the heat ramp). A test lists the selectors that use `--color-accent*` and fails on any other. Task 7 starts by listing today's uses and showing you the ones that are not actions before moving them to a neutral token.
8. **The look criteria that can be tested are tested** (Task 7): no gradient except the existing hatch, no backdrop blur, no emoji, no purple-hued colour token, no card on the tile strip. "Uniform rounded-card grids" is otherwise your judgement at sign-off.

## Review Focus

Inputs the spec implies but no listed edge case names. Each has a test in the owning task.

1. **A tweened number that is ever wrong at rest**: stops short (1,203 for 1,204), shows a fraction, or shows `NaN` mid-flight. (Task 4)
2. **A second range change while a tween is running**: the new tween starts from the value on screen, not the old target, and ends on the latest value; an unchanged value, a blank and a first load never tween. (Task 4)
3. **Clicking through tabs quickly (A, B, C)**: one view on screen at a time, no stacked exit animations, focus and sort not lost on a chart-campaign change. (Tasks 3, 5)
4. **Printing mid-animation** (Ctrl+P on a view that is fading in): paper shows the final state; the print summary has no motion at all. (Task 5)
5. **Reduced motion switched on while the app is open**, and a missing or garbled duration token: everything goes instant without a reload, and an unreadable token means "no motion", never a stuck half-faded element. (Tasks 1, 2, 3)

---

## File Structure

```
src/web/models/motionSettings.ts   (create) parseDuration, parseEase, resolveMotion, readMotionCss
src/web/models/motionVariants.ts   (create) revealFor, chartAnimation, transitionKey
src/web/models/tween.ts            (create) FigureKind, formatFigure, tweenPlan, figure memory
src/web/useMotion.ts               (create) MotionContext (default: off), MotionRoot, useMotion
src/web/components/AnimatedNumber.tsx  (create) one tile figure
src/web/components/Reveal.tsx      (create) enter/leave wrapper for panels and takeaways
src/web/components/ViewTransition.tsx  (create) view-keyed wrapper
src/web/models/overviewModel.ts    (modify) TileModel.figure
src/web/components/OverviewView.tsx, Takeaway.tsx, Heatmap.tsx, WeeklyChart.tsx, src/web/App.tsx (modify)
src/web/main.tsx                   (modify) MotionRoot, mono font css
src/web/styles/tokens.css, base.css, print.css (modify)
README.md                          (modify)
tests/web/motionSettings.test.ts, motionVariants.test.ts, tween.test.ts   (create)
tests/web/render-motion.test.tsx   (create)
tests/web/look-guards.test.ts      (create)
tests/web/motion-real-exports.test.tsx (create)
tests/web/print-css.test.ts, tokens.test.ts (modify)
```

---

## Before Task 1: ask

- [ ] Ask you, in one message, to install **`framer-motion`** (PLAN.md's "Framer Motion"; the same library is also published as `motion`, imported from `motion/react`; I will use whichever name you prefer) and, for Gap 6, **`@fontsource/ibm-plex-mono`**. Wait for the answer. Tasks 1 and 3 need neither.

---

### Task 1: Motion settings from the tokens (pure)

**Files:**
- Create: `src/web/models/motionSettings.ts`, `tests/web/motionSettings.test.ts`
- Modify: `tests/web/tokens.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Ease = [number, number, number, number];             // a cubic-bezier
  export interface MotionSettings { enabled: boolean; fast: number; base: number; slow: number; ease: Ease } // seconds
  export const MOTION_OFF: MotionSettings                          // enabled false, all durations 0, ease [0, 0, 1, 1]
  export function parseDuration(text: string): number | null       // '200ms' -> 0.2, '0.3s' -> 0.3, ' 150ms ' -> 0.15; anything else null
  export function parseEase(text: string): Ease | null             // 'cubic-bezier(0.2, 0, 0, 1)' -> [0.2, 0, 0, 1]; anything else null
  export function resolveMotion(input: { reduced: boolean; fast: string; base: string; slow: string; ease: string }): MotionSettings
  export function readMotionCss(style: { getPropertyValue(name: string): string }): { fast: string; base: string; slow: string; ease: string }
  ```
  `resolveMotion` returns `MOTION_OFF` when `reduced` is true, when any duration is null or 0, or when the ease is null; otherwise `enabled: true` with the parsed values. `readMotionCss` reads `--motion-fast`, `--motion-base`, `--motion-slow`, `--ease-standard`.

- [ ] **Step 1: Write the failing tests** in `motionSettings.test.ts`:
  1. `parseDuration`, table: `'200ms'` 0.2, `'0ms'` 0, `'0.3s'` 0.3, `' 150ms '` 0.15, and `''`, `'fast'`, `'-5ms'`, `'NaNms'`, `'200'` all null.
  2. `parseEase`, table: `'cubic-bezier(0.2, 0, 0, 1)'` gives `[0.2, 0, 0, 1]`; `'cubic-bezier(0.2,0,0,1)'` too; `'ease'`, `'cubic-bezier(1,2,3)'`, `'cubic-bezier(a,b,c,d)'` null.
  3. `resolveMotion` with the real token strings (`150ms`, `200ms`, `300ms`, `cubic-bezier(0.2, 0, 0, 1)`) is `enabled: true` with `0.15`, `0.2`, `0.3` (Review Focus 5).
  4. `resolveMotion` is `MOTION_OFF` (toEqual) for: `reduced: true`; a `0ms` duration (what the reduced-motion token block produces); an empty duration; a garbled ease.
  5. `readMotionCss` reads the four names from a fake `style` and returns the strings trimmed.
  6. In `tokens.test.ts`: every `--motion-*` duration is between 150ms and 300ms inclusive (read from the file, outside the reduced-motion block), and `--ease-standard` parses with `parseEase`. This pins PLAN.md's "about 150 to 300 ms, eased".
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/web/motionSettings.test.ts tests/web/tokens.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the four functions and `MOTION_OFF` in `motionSettings.ts` (plain regexes; no dependency).
- [ ] **Step 4: Run** the same command and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** the three files by name, "feat: motion timing is read from the tokens and is off for reduced motion or an unreadable token".

---

### Task 2: Install Framer Motion; the motion provider

**Files:**
- Create: `src/web/useMotion.ts`
- Modify: `src/web/main.tsx`, `package.json`, `package-lock.json`
- Test: `tests/web/render-motion.test.tsx` (first test only; Tasks 3 to 6 add to it)

**Interfaces:**
- Consumes: `MotionSettings`, `MOTION_OFF`, `resolveMotion`, `readMotionCss`.
- Produces:
  - `MotionContext`: a React context of `MotionSettings`, **default `MOTION_OFF`**, so every existing render test and every component outside the provider is unanimated.
  - `MotionRoot({ children }: { children: ReactNode })`: reads the CSS properties from `document.documentElement` and `useReducedMotion()`, provides the resolved settings, and wraps the tree in `MotionConfig reducedMotion="user"`. It re-resolves when the reduced-motion preference changes (Review Focus 5).
  - `useMotion(): MotionSettings` (reads the context).

- [ ] **Step 1:** Install only what you approved, by name: `npm install framer-motion` (or `motion`). Show me the `package.json` diff.
- [ ] **Step 2: Write the failing test** in `render-motion.test.tsx`: a component calling `useMotion()` rendered with no provider reports `enabled: false`; rendered inside `<MotionContext value={{ enabled: true, fast: 0.15, base: 0.2, slow: 0.3, ease: [0.2, 0, 0, 1] }}>` reports `enabled: true`.
- [ ] **Step 3: Run to verify it fails.** Run: `npx vitest run tests/web/render-motion.test.tsx`. Expected: FAIL.
- [ ] **Step 4: Implement** `useMotion.ts`; wrap `<ErrorBoundary><App /></ErrorBoundary>` in `MotionRoot` in `main.tsx` (inside, so a render error still reaches the boundary).
- [ ] **Step 5: Run** `npx vitest run tests/web` and `npm run typecheck`. Expected: PASS, no existing test changed.
- [ ] **Step 6: Commit** `useMotion.ts`, `main.tsx`, `package.json`, `package-lock.json`, the test file, "feat: a motion provider that follows reduced motion live, and the Framer Motion dependency".

---

### Task 3: What moves and how (pure variants)

**Files:**
- Create: `src/web/models/motionVariants.ts`, `tests/web/motionVariants.test.ts`

**Interfaces:**
- Consumes: `MotionSettings`, `UrlState`.
- Produces:
  ```ts
  export type RevealKind = 'view' | 'panel' | 'takeaway';
  export interface Reveal {
    initial: { opacity: number; y: number };
    animate: { opacity: 1; y: 0 };
    exit: { opacity: number; y: number };
    transition: { duration: number; ease: Ease };
  }
  export function revealFor(settings: MotionSettings, kind: RevealKind): Reveal
  export function chartAnimation(settings: MotionSettings): { isAnimationActive: boolean; animationDuration: number; animationEasing: 'ease-out' }  // duration in ms
  export function transitionKey(state: UrlState): string
  ```
  Enabled: `view` and `panel` fade in from opacity 0 and 6px below over `settings.base`; `takeaway` over `settings.fast`; exit is opacity 0 and 0px of offset over `settings.fast`. Disabled: `initial`, `animate` and `exit` are all `{ opacity: 1, y: 0 }` and the duration is 0.
  `transitionKey` is `'answer'` when `state.answer !== null`, else `state.view`.

- [ ] **Step 1: Write the failing tests:**
  1. `revealFor` enabled, for each kind: `initial.opacity` is 0, `animate` is `{ opacity: 1, y: 0 }`, and the duration is `settings.base` (view, panel) or `settings.fast` (takeaway); no duration is above 0.3.
  2. `revealFor` with `MOTION_OFF`, for each kind: `initial`, `animate` and `exit` are equal, and `transition.duration` is 0 (Review Focus 5: nothing can stick at opacity 0).
  3. `chartAnimation`: enabled gives `isAnimationActive: true` and `animationDuration` of `settings.base * 1000`; `MOTION_OFF` gives `isAnimationActive: false`.
  4. `transitionKey` (Review Focus 3): the same key for states that differ only in `campaign`, `location`, `range`, `start`/`end`, compare, `dev` and `print`; a different key for each of the four views; `'answer'` for a state with an answer, whatever its `view`.
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/web/motionVariants.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the three functions. The 6px offset is a named constant in this file in `px` units as a plain number, not a duration.
- [ ] **Step 4: Run** the same command and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** both files by name, "feat: pure rules for what animates, with nothing left half-faded when motion is off".

---

### Task 4: Tiles count to the new value

**Files:**
- Create: `src/web/models/tween.ts`, `src/web/components/AnimatedNumber.tsx`, `tests/web/tween.test.ts`
- Modify: `src/web/models/overviewModel.ts`, `src/web/components/OverviewView.tsx`, `tests/web/overviewModel.test.ts`, `tests/web/render-motion.test.tsx`

**Interfaces:**
- Consumes: `formatCount`, `formatRate`, `formatUsd` (core `views/format`), `TileModel`, `useMotion`.
- Produces:
  ```ts
  // tween.ts
  export type FigureKind = 'count' | 'rate' | 'usd';
  export function formatFigure(kind: FigureKind, value: number): string       // count -> formatCount, rate -> formatRate, usd -> formatUsd
  export function tweenPlan(input: { enabled: boolean; to: number | null; shown: number | null; remembered: number | null }): { from: number } | null
  export function rememberFigure(id: string, value: number): void
  export function recallFigure(id: string): number | null
  export function forgetFigures(): void                                         // tests reset with this
  // overviewModel.ts: TileModel gains
  figure: { value: number; kind: FigureKind } | null                           // null when the API value is null
  // AnimatedNumber.tsx
  export function AnimatedNumber(props: { id: string; text: string; figure: { value: number; kind: FigureKind } | null }): JSX.Element
  ```
  `tweenPlan` returns `{ from: shown ?? remembered }` only when `enabled`, `to` is finite, the chosen start is finite, and it differs from `to`; otherwise `null`. `shown` is the number on screen while a tween is running (so a retarget starts there), else null.
  `AnimatedNumber` renders `text` (the tile's own formatted string) in a `<span className="figure">` and, when `useMotion().enabled` and `tweenPlan` is non-null, animates with Framer's `animate(from, to, { duration: base, ease })`, writing `formatFigure(kind, latest)` into the span; on finish it writes `text` exactly. On unmount or a new target it cancels the running animation. It calls `rememberFigure(id, to)` whenever it receives a figure.

- [ ] **Step 1: Write the failing tests.**
  `tween.test.ts`:
  1. `formatFigure` equals the tile text (Review Focus 1): for each of the five tiles of the real Overview JSON from `overviewFor` (`tests/web/fixtures.ts`), `formatFigure(tile.figure.kind, tile.figure.value) === tile.value`.
  2. `no wrong frames` (Review Focus 1): for `from = 0`, `to` = each tile's value and 21 steps of `from + (to - from) * i / 20`, `formatFigure` never returns a string matching `/NaN|Infinity|undefined/`, and for `count` and `usd` never contains a `.` (no fractions mid-flight).
  3. `tweenPlan` table (Review Focus 2): disabled gives null; `to: null` null; `remembered: null, shown: null` (first load) null; `remembered === to` (unchanged) null; `remembered: 10, to: 12` gives `{ from: 10 }`; `shown: 11.4, remembered: 10, to: 12` gives `{ from: 11.4 }` (retarget starts where the screen is); `shown: 12, to: 12` null; a non-finite `to` or `from` null.
  4. `figure memory`: `recallFigure('a')` is null; after `rememberFigure('a', 5)` it is 5; `rememberFigure('a', 7)` replaces it; `forgetFigures()` clears; ids do not mix.
  `overviewModel.test.ts`: each `TileModel.figure` is `{ value: tile.current, kind }` with kinds count, count, rate, count, usd in tile order; a null API value gives `figure: null` and the value `BLANK`.
  `render-motion.test.tsx`:
  5. `rests on the server's text` (done-when "no number changes", Review Focus 1): `OverviewView` rendered with motion **on** and with `MOTION_OFF` gives the same visible text (tags stripped, `style` ignored), and every tile's exact `tile.value` is present. (Rendering is the at-rest state; the animation runs only in the browser.)
  6. `reduced motion renders no tween bookkeeping`: with `MOTION_OFF` the markup of `AnimatedNumber` is exactly `<span class="figure">TEXT</span>`.
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/web/tween.test.ts tests/web/overviewModel.test.ts tests/web/render-motion.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `tween.ts`, the `figure` field (the existing `TILES` table gains a `kind` and `format` becomes `formatFigure(kind, ...)`, so there is one formatter), `AnimatedNumber.tsx` (a layout effect sets the start text before first paint so the final value never flashes; a ref holds the running animation and the live value), and use it for `tile-value` in `OverviewView.tsx`. Memory is a module-level `Map`.
- [ ] **Step 4: Run** `npx vitest run tests/web` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** by name, "feat: Overview tiles count to the new value, ending exactly on the server's number".

---

### Task 5: Views, takeaway, panels and heatmap move in and out

**Files:**
- Create: `src/web/components/Reveal.tsx`, `src/web/components/ViewTransition.tsx`
- Modify: `src/web/App.tsx`, `src/web/components/Takeaway.tsx`, `src/web/components/Heatmap.tsx`, `src/web/styles/print.css`, `tests/web/print-css.test.ts`, `tests/web/render-motion.test.tsx`

**Interfaces:**
- Consumes: `revealFor`, `transitionKey`, `useMotion`, `AnimatePresence`, `motion`.
- Produces:
  - `Reveal({ kind, id, children }: { kind: RevealKind; id: string; children: ReactNode })`: an `AnimatePresence`-friendly `motion.div` with `data-motion` and the `revealFor` variants. Use it as `<AnimatePresence initial={false}>{open && <Reveal …/>}</AnimatePresence>` at the call site.
  - `ViewTransition({ id, children }: { id: string; children: ReactNode })`: `AnimatePresence mode="wait" initial={false}` around one `Reveal kind="view"` keyed `id`.
  - `App.tsx`: `ReadyShell` wraps everything from `<Takeaway>` to the end of `RequestFrame` (and the answer page) in `<ViewTransition id={transitionKey(state)}>`; the data notes panel is a `Reveal kind="panel"`. Header, Nav, AskBox and RangeControl stay outside it.
  - `Takeaway` swaps loading and ready through a `Reveal kind="takeaway"` keyed by `show.kind`; the hidden state renders nothing, as now.
  - `Heatmap`: the table block is a `Reveal kind="panel"` keyed by `mode`, so the two modes cross-fade.
  - `print.css`: `@media print { [data-motion] { opacity: 1 !important; transform: none !important; } }`.

- [ ] **Step 1: Write the failing tests:**
  `render-motion.test.tsx`:
  1. `off means plain markup` (Review Focus 5): with `MOTION_OFF`, `ViewTransition`, `Reveal` and `Takeaway` render their children with no `opacity:0` and no `transform` anywhere in the markup.
  2. `on, the first render is not hidden`: with motion on, `ViewTransition` and `Takeaway` still contain their text (a view must be readable in the first frame, `initial={false}`).
  3. `the takeaway keeps its text and marker` for AI, template, loading and hidden: the same strings the existing `render-takeaway.test.tsx` expects, with motion on and off.
  4. `the heatmap keeps both modes' labels` and still shows each cell's count and `title`.
  5. `no motion in the print path` (Review Focus 4): the source of `PrintSummary.tsx`, `models/printModel.ts` and `models/motionVariants.ts` imports nothing from `framer-motion`/`motion/react`, and `PrintSummary` rendered with motion **on** has no `style=` and no `data-motion`.
  `print-css.test.ts`: `print.css` has a `@media print` rule that sets `[data-motion]` to `opacity: 1 !important` and `transform: none !important` (Review Focus 4).
  `motion-keys` (Review Focus 3), in `motionVariants.test.ts` or here: with the `transitionKey` cases from Task 3, assert `App.tsx` passes `transitionKey(state)` to `ViewTransition` and passes no `campaign` or `location` into the key (a source-text check, like `tokens.test.ts`).
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/web/render-motion.test.tsx tests/web/print-css.test.ts`. Expected: FAIL on the new tests only.
- [ ] **Step 3: Implement** the two components and the call-site changes. Keep the tree position of the chart section stable (DECISIONS Phase 7 review fix): the wrapper is keyed by the view only.
- [ ] **Step 4: Run** `npx vitest run tests/web` and `npm run typecheck`. Expected: PASS with every existing render test unchanged. If one needs editing, stop and tell me which and why.
- [ ] **Step 5: Commit** by name, "feat: views, takeaway, panels and heatmap modes move in and out, and print always shows the final state".

---

### Task 6: The weekly chart moves between datasets

**Files:**
- Modify: `src/web/components/WeeklyChart.tsx`, `tests/web/render-motion.test.tsx`, `tests/web/render-campaigns.test.tsx` (only if it asserts the bar props)

**Interfaces:**
- Consumes: `chartAnimation`, `useMotion`.
- Produces: no new exports. `Bar` takes `{...chartAnimation(useMotion())}` instead of `isAnimationActive={false}`.

- [ ] **Step 1: Write the failing test** in `render-motion.test.tsx`: `the chart is complete with motion on and off`: `WeeklyChart` rendered both ways has the same visible text, the same hidden table rows (every week and its calls), the legend line when a partial week exists, and `No calls in these weeks.` for an all-zero model. Add a source check that `WeeklyChart.tsx` contains no `isAnimationActive={false}` and no numeric `animationDuration=`. (Bar motion is not unit-tested; the checklist covers it.)
- [ ] **Step 2: Run to verify it fails.** Run: `npx vitest run tests/web/render-motion.test.tsx`. Expected: FAIL on the source check.
- [ ] **Step 3: Implement** the change.
- [ ] **Step 4: Run** `npx vitest run tests/web` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** by name, "feat: the weekly chart animates between campaigns and is still when motion is off".

---

### Task 7: Type pairing, the accent audit and the look guards

**Files:**
- Create: `tests/web/look-guards.test.ts`
- Modify: `src/web/styles/tokens.css`, `src/web/styles/base.css`, `src/web/main.tsx`, `package.json` and `package-lock.json` (only if you approved the mono font), `tests/web/tokens.test.ts`

**Interfaces:**
- Produces: tokens `--font-mono` (Plex Mono first) used for tile figures, tile labels and badges; nothing else exported.

- [ ] **Step 1: Audit, and show me before changing.** Run `grep -n "color-accent\|color-chrome-accent" src/web/styles/base.css` and list every selector that uses `--color-accent`, `--color-accent-soft` or `--color-chrome-accent`, split into actions (links, buttons, current tab, focus, download) and not actions. Show me the list. This list becomes `ACTION_SELECTORS` in the test below.
- [ ] **Step 2: Write the failing tests** in `look-guards.test.ts` (reads css, ts, tsx and `index.html` under `src/web` as text, like `tokens.test.ts`):
  1. `no gradients`: no `gradient(` in any css or tsx except `repeating-linear-gradient` (the partial-week hatch).
  2. `no glass`: no `backdrop-filter` and no `filter: blur`.
  3. `no emoji`: no match for `/\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u`, with a self-check that `'✅'` and `'⚡️'` match and `'–'`, `'…'`, `'×'`, `'↑'` do not.
  4. `no purple`: for every `--color-*` hex in `tokens.css` with HSL saturation at least 0.25 and lightness between 0.15 and 0.85, the hue is outside 265 to 330 degrees, with a self-check on `#8a4fff` (fails) and `#5e74e3` (passes).
  5. `type pairing` (Gap 6): the first family of `--font-body` is not `Inter`, `system-ui`, `-apple-system` or `Segoe UI`; if the mono font was approved, the first families of `--font-body` and `--font-mono` differ, and `main.tsx` imports a css file for each.
  6. `one accent for actions`: every rule in `base.css` whose declarations use `--color-accent*` or `--color-chrome-accent` has a selector in `ACTION_SELECTORS`.
  7. `no card on the tile strip`: the `.tile` rule has no `border-radius` and the `.tile-grid` rule has one (joined cells, not separate cards).
  8. `motion is tokenised`: every `transition` or `animation` declaration in css names `var(--motion-`; no ts or tsx file under `src/web` has `duration:\s*\d` or `ease:\s*\[` outside `models/motionSettings.ts` and `models/motionVariants.ts`; only `useMotion.ts`, `AnimatedNumber.tsx`, `Reveal.tsx`, `ViewTransition.tsx` and `main.tsx` import `framer-motion` (or `motion/react`).
- [ ] **Step 3: Run to verify they fail.** Run: `npx vitest run tests/web/look-guards.test.ts`. Expected: FAIL on 5 (and 6 until the audit is applied); report which of the others already pass.
- [ ] **Step 4: Implement:** install the mono font if approved (ask answered above); import its 400 and 500 css in `main.tsx`; set `--font-mono` and apply it to the tile figures, tile labels and badges in `base.css` with `font-variant-numeric: tabular-nums` kept; move any non-action use of the accent to a neutral token (show me what moved). Do not change a colour value without re-running `tokens.test.ts`; contrast tests must stay green.
- [ ] **Step 5: Run** `npx vitest run tests/web` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** by name, "feat: Plex Sans with Plex Mono for figures, the accent only on actions, and tests that pin the look rules".

---

### Task 8: Both real exports, README and the full check

**Files:**
- Create: `tests/web/motion-real-exports.test.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: `cleanExport`, `readExportFromDir` and the `*For` view helpers as `tests/web/print-real-exports.test.ts` does (shipped: `tests/fixtures/original-export`; extended: `data/extended`), `OverviewView`, `CampaignsView`, `LocationsView`, `MissedCallsView`, `MotionContext`, `MOTION_OFF`.

- [ ] **Step 1: Write the tests.** For each export and each of the four views, render with motion on and with `MOTION_OFF`: the visible text (tags stripped, `style` ignored) is identical, and contains no `NaN`, `Infinity` or `undefined` (done-when: "no view's numbers or actions change"). The Overview render contains every tile's exact value.
- [ ] **Step 2: Run** `npx vitest run tests/web/motion-real-exports.test.tsx`. Expected: PASS (the code exists from Tasks 1 to 7).
- [ ] **Step 3: README.** A "Visual design and motion" section after "Print summary": the look (palette, the font pairing or the single family), what moves (view change, takeaway, data notes, heatmap modes, Overview tiles, the weekly chart), that every duration is 150 to 300 ms and set in `tokens.css`, that `prefers-reduced-motion` turns all of it off at once and live, that no motion reaches print, that tables and sentences never animate, and the known limits (bars use Recharts' own animation and the nearest keyword easing; a range change grows the chart in instead of morphing it, because old numbers are never shown under a new range).
- [ ] **Step 4:** Run `npm test`, `npm run typecheck`, `npm run build`. Expected: all green. Show me the counts.
- [ ] **Step 5:** Run the checklist below in the browser (`npm start`, then `DATA_DIR=data/extended npm start`) and show me the result.
- [ ] **Step 6: Commit** the test and `README.md` (and any `docs/DECISIONS.md` rows added during the build), "docs: README covers the visual design and motion".

## Click-through checklist (S5)

Use Chrome or Edge. This is the sign-off: the look is yours to approve.

**Look (by eye, not testable):**
- Generous spacing and data first: the Overview reads as numbers with space around them, not boxes in a grid.
- It does not read as a generic AI dashboard: no purple, gradients, frosted cards, emoji icons or same-sized rounded cards.
- The type pairing reads as deliberate. If you declined the mono font, say whether you accept one family; I report the criterion as not met.
- Green appears only on things you can click (links, buttons, current tab, focus). Bars and heat cells are their own colours.

**Motion, normal settings:**
- Switch tabs: a short fade and small rise, about a fifth of a second; header, nav and range control do not move.
- Click tabs quickly (Campaigns, Locations, Missed calls, Overview): one view at a time, no doubled content.
- Overview, change the range: loading message, then each tile counts to its new value and rests on the exact number (compare with the table values on another view).
- Overview, `range=all`, then back: tiles that did not change do not move.
- Campaigns, change the chart's campaign: the bars animate to the new set, the select keeps focus, the table keeps its sort. Change the range: bars grow in after loading.
- Takeaway: loading text and then the sentence swap with a short fade. Missed calls, toggle By office and By weekday: the heatmap cross-fades.
- With `?dev`, open and close Data notes: the panel fades in and out.

**Reduced motion:** DevTools, Rendering, "Emulate CSS prefers-reduced-motion: reduce". Repeat the list above: nothing animates (no fade, rise, count or bar growth). Switch the emulation on and off **without reloading**: the app follows at once.

**Print:** open a view, change the range and press Ctrl+P at once (during the fade): the preview shows full-strength content. Open `?print`: no motion, still one page on A4 and Letter (the S3 checklist, on both datasets).

**Unchanged:** every number and action sentence matches what the same range showed before S5 (spot-check three views on both exports).

## Self-review

- **Spec coverage:** PLAN.md S5 look criteria: type pairing (Task 7, Gap 6), one accent (Task 7), data-first spacing (checklist), no purple/gradient/glass/emoji/uniform cards (Task 7). Motion criteria: view transitions (Tasks 3, 5), tweening (Task 4), charts between datasets (Task 6, Gap 3), panels and takeaways (Task 5), 150 to 300 ms eased (Task 1 test 6), reduced motion (Tasks 1, 2, 3, checklist). Approach (Framer for all motion): Tasks 2 to 5, with the Recharts exception in Gap 4. Done-when: sign-off (checklist), reduced motion shows none (Tasks 1, 3, 5, checklist), numbers and actions unchanged (Tasks 4, 8), README (Task 8).
- **Types:** `MotionSettings` and `Ease` (Task 1) are what `revealFor`, `chartAnimation` (Task 3), `useMotion` (Task 2) and `AnimatedNumber` (Task 4) use; `FigureKind` is defined once in `tween.ts` and used by `TileModel.figure`; `transitionKey(state)` feeds `ViewTransition.id`.
- **Tests I may have to touch:** none of the existing assertions should change, because the context default is "off" (Task 2). `tests/web/overviewModel.test.ts` gains the `figure` field assertions, and `tokens.test.ts` gains the motion-range check.
- **Open for your review:** Gaps 1 to 8, especially 2 (tiles only), 3 (range change grows the chart in rather than morphing), 4 (Recharts' own animation), 6 (a second font package) and 7 (what counts as an action). PLAN.md S5 has no edge-case line; I tested its criteria instead (see the start of "Gaps").
