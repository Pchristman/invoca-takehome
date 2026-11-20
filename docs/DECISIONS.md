# Decisions

One line per real decision. Newest at the bottom.

| Date | Decision | Why | Rejected |
| --- | --- | --- | --- |
| 2026-11-18 | Keep four views (Overview, Campaigns, Locations, Missed calls) and extend the data so Locations has a real pattern to find | Reviewers allow extending the data; the original shows flat office answer rates | Merging Locations into Missed calls |
| 2026-11-18 | Date range: presets (7 days, 28 days, all) plus custom; "as of" = latest call; days counted in office local time | Fast start for the marketer, flexible when needed; calls near midnight UTC land on the correct local day | Presets only; custom only; UTC days |
| 2026-11-18 | Comparison engine takes any two ranges; "previous period" is the default | Makes stretch S2 nearly free; partial comparison periods are hidden with a reason | Hard-wiring previous-period only |
| 2026-11-18 | Missed-call value uses per-campaign booking rate x average booking value from the whole export, falling back to channel, then overall | More accurate than one overall rate, still explainable; whole-export rates are stable | One overall rate |
| 2026-11-18 | Callback list = callers with an unanswered call in range and no answered call after it, through end of export | Leaves out people who already got through | All unanswered in range; never answered ever |
| 2026-11-18 | One AI takeaway per view, not per chart | Fewer claims to check, reads as advice; charts get code-written captions | Per-chart takeaways; Overview only |
| 2026-11-18 | AI writes placeholders that code fills; the checker rejects digits, number words, unknown keys and off-sheet names | The model cannot produce a number at all; sturdier than parsing numbers out of free text | Free text checked by number extraction |
| 2026-11-18 | Claude Haiku 5.5, low effort, cached, $5 default in-app spend guard, JSONL call log | Cheapest current model for short structured writing; repeats cost nothing | Sonnet / Opus for takeaways |
| 2026-11-18 | Vite + React front end, Hono API server, pure TypeScript data core, vitest; one `npm start` | Familiar to reviewers, interactive, keeps the API key server-side | Server-rendered HTML; Next.js |
| 2026-11-18 | AI is on exactly when ANTHROPIC_API_KEY is set (no separate AI_ENABLED switch) | One less setting; removing the key demos the fallback | AI_ENABLED flag |
| 2026-11-18 | Stretch goals S1-S5 are planned phases after the slice, and S5 adds a distinctive visual design with motion | I intend to ship them, so they need real designs; the slice stays first so it's never at risk | Leaving stretch goals as an undesigned wish list |
| 2026-11-18 | Data notes panel is dev mode only (`?dev` in the URL); estimate labels, incomplete-period notes, outcome lag and a skipped-rows count stay inline | The cleaning detail is for checking the app, not for the marketer, but caveats on numbers must be visible where the number is | Panel visible to everyone; hiding all caveats behind dev mode |
| 2026-11-18 | S5 motion uses Framer Motion | One consistent system for view transitions, number tweens and layout animation, with built-in reduced-motion support | CSS transitions plus the View Transitions API |
| 2026-11-19 | Extended data plants four patterns: a low answer rate at Canyon Office on weekday mornings, a low booking rate at Riverside Office, a surge in one campaign's calls and a fade in another's | Locations needs one answer-rate and one booking-rate outlier; Campaigns and stretch S1 need a real jump and drop | One office pattern only |
| 2026-11-19 | `npm start` keeps the shipped export as default; the extended export is opt-in with `DATA_DIR=data/extended` | The shipped data is the honest first look and shows "No office stands out"; invented rows should be a choice | Extended as default |
| 2026-11-19 | Start the S5 look early, before Phase 8: the UI follows Invoca's own design language (evergreen chrome, brand green for actions, sand neutrals), with IBM Plex Sans standing in for Invoca's commercial typeface | I wanted a design like a comparable product, and Invoca is the product this one mirrors; the first attempts were generic | A warm editorial serif look; a blue analytics look |
