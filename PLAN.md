# PLAN.md: Inbound Call Performance

This is the design spec. It is written as instructions to the engineer building the product. Read `docs/BRIEF.md` first for the problem, the constraints and the data profile, and `CLAUDE.md` for how to work and the rules that never bend.

Each phase in the build order gets its own implementation plan before any code is written. This document says _what_ and _why_; it does not say which files to create.

---

## 1. The user and their job

**Who:** the marketing manager at a business that takes inbound calls across several offices and marketing campaigns. They are not an analyst. They own the campaign budget and they answer to someone above them for results.

**Their job, roughly weekly:** open the app, look at a recent period, and answer three questions:

1. Which campaigns are earning their budget, and which are not?
2. Where are calls, and therefore bookings, being lost?
3. What should I change this week?

**What the product must do for them:** every view ends in a suggested **action** backed by a number computed in code. A chart that only reports is not finished. If the data shows nothing actionable for a view, the view says so plainly and points to where the action is, rather than inventing a story.

---

## 2. Scope and non-goals

### In scope: the slice (must be finished and tested before anything else)

- A date range control (presets and custom) with a comparison to the previous period of equal length.
- Four views, each ending in an action: **Overview**, **Campaigns**, **Locations**, **Missed calls**.
- Inline caveats on each view wherever a number is estimated or may be incomplete.
- A count of skipped rows in the header when the export has bad rows. There is no data notes panel.
- A downloadable CSV of callers to call back.
- Optional AI: one short takeaway per view, checked before display, with template fallback.
- The submission docs: README, TECHNICAL.md, architecture diagram, decision summary draft.

### In scope: stretch phases, planned and intended, after the slice

In order: S1 alerts, S2 compare any two date ranges, S3 print-friendly one-page summary, S4 ask a question in plain English, S5 polished visual design with motion, S6 a database seeded from the CSVs, S7 uploading a CSV into that database. They are designed here so the slice's architecture doesn't block them. The slice is never cut to make room for them.

### Non-goals

- Login, authorization, multiple tenants or customers in one instance.
- Cloud deployment, or scaling beyond one export in memory. Docker is offered for convenience (Phase 10) but never required: `npm start` always works.
- Uploading data through the UI in the slice. The data folder is set by config, and a new export means a restart. Upload comes later as stretch S7, after the database in S6.
- Editing campaigns, budgets or offices.
- Live data, streaming updates, or polling for new exports.
- Any number produced by a model.

---

## 3. Global behavior

### 3.1 Date range

- **"As of" date:** the latest local date of any call in the export. Never the real clock. Shown in the header ("Data as of Oct 29, 2026").
- **Local date:** every call's date is its **office's** local date (office IANA time zone). A range filters on local date, inclusive at both ends.
- **Presets:** Last 7 days, Last 28 days, All data. Each ends on the as-of date.
- **Custom:** a start and end date, both inclusive, clamped to the data's date span. Start after end is rejected with a message, never a crash.
- **State lives in the URL** (range, comparison range, view, selected campaign), so a link, refresh or print reproduces the screen.

### 3.2 Comparison

- Default comparison range: the same number of days immediately before the selected range. A second range of another length (stretch S2) is compared per day and labelled as such.
- If any day of the comparison range falls before the first date in the data, **no change is shown**; the tile shows "No full previous period" with a one-line reason. "All data" therefore never shows a change.
- If the selected range or the comparison range includes the first date in the data, a note says that day may be incomplete. The last date gets no such note: the data gives no sign that the last day is incomplete.
- Counts and money show % change. Rates (answer rate, booking rate) show change in percentage points.
- If the previous value is 0 and the current isn't, the change reads "new", never infinity or NaN. If both are 0, no change is shown.
- The comparison engine takes **any two ranges** from the start. "Previous period" is only the default second range. Stretch S2 then only adds UI.

### 3.3 Caveats the marketer always sees

These sit inline on the view they affect, not behind a panel, because the rules in `CLAUDE.md` require them to be visible wherever the number appears:

- **Estimates:** estimated spend, cost per booking, revenue per budget dollar and missed-call value are labeled "est.", with the formula one click away.
- **Incomplete periods:** the notes from section 3.2 (no full previous period; the first data day may be incomplete; the last data day gets no note, see 3.2).
- **Outcome lag:** not measured and not shown. No note on the page says recent bookings and revenue may still rise: calls still waiting for an outcome are spread over the whole export, not concentrated in recent days.
- **Skipped rows:** if any rows were bad, one line in the header ("12 rows skipped"). There is no data notes panel, so the header count is all the app shows about them.
- **Takeaway source:** the small "AI" or "template" marker on each takeaway.

---

## 4. The views and the action each leads to

Every view returns a **fact sheet**: a flat set of named values and entity names behind its headline action. The template sentence, the AI prompt and the AI checker all read from that same fact sheet. The UI only formats; it does no arithmetic.

### 4.1 Overview

**Shows:** tiles for calls, unique callers, answer rate, bookings and revenue, each with change against the comparison range. Below that, **Top actions**: the headline action from each of the other three views, in fixed order (Campaigns, Locations, Missed calls), each linking to its view. From stretch S1, when campaign call alerts exist (section 9, S1), one extra entry for them follows the Campaigns entry, so the list has three or four entries; if the alert is already Campaigns' headline it is listed once.

**Action:** the top actions list itself. Each item carries its number.

**Definitions:**

- Unique callers: distinct `caller_number_hash` in the range.
- Answer rate: answered calls / calls.
- Bookings: calls whose current outcome is `booked`.
- Revenue: sum of `revenue_usd` on booked calls only.

### 4.2 Campaigns

**Shows:**

- A table ranked by calls (sortable by any column): campaign, channel, calls, bookings, booking rate, revenue, estimated spend, estimated cost per booking, revenue per budget dollar.
- "Unattributed" appears as its own row with calls, bookings and revenue; its spend columns are blank.
- **Best** and **worst** campaign marked by revenue per budget dollar. Both need a budget above $0. **Best** is the highest among campaigns with at least `MIN_BOOKINGS_TO_RANK` bookings in the range, so its figure means something. **Worst** is the lowest among campaigns with at least `MIN_CALLS_TO_RANK_WORST` calls in the range, other than the best; a campaign with 0 bookings can be worst, because a campaign that took budget and calls and booked almost nothing is exactly what the marketer needs to see. Nothing is marked when no two different campaigns qualify, or when the worst is not below the best, and the view says which.
- A calls-per-week chart for one selected campaign (default: the top campaign by calls). Weeks run Monday to Sunday by local date. A week only partly inside the range or the data is visibly marked partial.

**Actions:**

1. **Shift budget:** "Shift budget from {worst} (est. ${x} revenue per budget dollar) toward {best} (est. ${y} revenue per budget dollar)." Do not project extra bookings from the shift; the data can't support that claim.
2. **Fix attribution** (only when unattributed calls exist in range): "{n} calls ({b} bookings, ${r}) came in on {m} tracking numbers not tied to any campaign. Assign them." The tracking numbers are listed with their call counts.

**Definitions:**

- Booking rate: bookings / calls.
- Estimated spend: `daily_budget_usd` x number of days in the range. Always labeled "est.".
- Estimated cost per booking: estimated spend / bookings. **Blank** when the budget is $0 or not given, or there are no bookings. Never infinity.
- Revenue per budget dollar: revenue / estimated spend. Blank when spend is $0 or the budget is not given.
- A campaign whose budget is not given (blank or unreadable in `campaigns.csv`) also has a blank estimated spend and is never ranked best or worst.

### 4.3 Locations

**Shows:**

- A table by office: calls, answer rate, bookings, booking rate, revenue, and the **best campaign at that office** (highest booking rate among campaigns with at least `MIN_CALLS_BEST_CAMPAIGN` calls at that office in the range; blank if none qualifies).
- An **outlier flag** on an office whose answer rate or booking rate differs from all other offices pooled by more than chance explains. Use a two-proportion z-test of the office against the rest; flag when |z| >= `OUTLIER_Z` and the office has at least `MIN_CALLS_OUTLIER` calls. The flag shows direction (better or worse) and both rates.

**Action:**

- If an office is flagged worse on answer rate: "{office} answers {a}% of calls versus {b}% at other offices. Its most-missed hour is {weekday} {hour} local." Leave the hour clause out when two or more slots tie for the most missed calls. Links to Missed calls filtered to that office.
- If flagged worse on booking rate: "{office} books {a}% of calls versus {b}% elsewhere. Its best campaign there is {campaign}."
- If no office is flagged: when no office had enough calls to be tested, "There are too few calls in this range to compare offices."; otherwise "No office stands out on answer or booking rate.", followed by "Missed calls are a company-wide issue." only when at least one call in the range went unanswered. Links to Missed calls. This is a valid, useful result, not a failure.
- If an office is flagged only better (none worse): "No office is doing worse than the rest on answer or booking rate.", followed by the same company-wide sentence under the same condition. Links to Missed calls.
- In both cases above where offices were compared and none is flagged worse, the fact sheet carries the number of offices compared, the combined answer and booking rates and the unanswered calls in range (`offices.*`), and no individual office, so a takeaway can be written without ranking offices. The "too few calls" case has no facts. The Overview leaves these facts out of its own sheet.

### 4.4 Missed calls

**Shows:**

- A heatmap of unanswered calls by office x local hour, with a toggle to weekday x local hour.
- **Estimated lost value** for unanswered calls in the range, labeled as an estimate with its formula visible. It is an upper bound: it counts every unanswered call, including repeat attempts and callers who later got through.
- A **callback list**, downloadable as CSV.

**Definitions:**

- Unanswered: `answered` is false (outcome `missed` or `voicemail`, or empty).
- **Estimated value of one missed call** = its campaign's booking rate among answered calls with an outcome x that campaign's average booking value. Rates come from the **whole export**, not the selected range, so they are stable. If a campaign has fewer than `MIN_ANSWERED_FOR_RATE` answered calls with outcomes, use its channel's rates; if the channel is also too thin, use the overall rates. Unattributed calls use their `marketing_channel`'s rates.
- **Callback list:** callers (by `caller_number_hash`) who had at least one unanswered call in the range **and** no answered call after their latest unanswered call in the range, looking through to the end of the export. Each row: caller hash, unanswered attempts in range, last attempt (office local time), office, campaign, tracking number dialed, estimated value. The estimate is for their latest missed call only, because one callback recovers at most one booking. Sorted by estimated value, highest first.

**Action:** "Call back {n} callers whose latest call went unanswered (est. ${x} in bookings). Busiest missed slot: {office} {weekday} {hour}." Leave the slot clause out when two or more slots tie for the most missed calls.

**Stated limit:** the export carries only a hashed caller number. The list identifies callers by hash, tracking number and time, which the marketer matches in their call platform. Say this on the view.

### 4.5 Configurable thresholds

All live in one config module with these defaults and are never derived from this dataset's names or dates:

| Name                      | Default | Used for                                                                               |
| ------------------------- | ------- | -------------------------------------------------------------------------------------- |
| `MIN_BOOKINGS_TO_RANK`    | 5       | Best campaign eligibility                                                              |
| `MIN_CALLS_TO_RANK_WORST` | 10      | Worst campaign eligibility: calls in the range, so a campaign that booked nothing can be worst |
| `MIN_CALLS_BEST_CAMPAIGN` | 20      | Best campaign at an office                                                             |
| `MIN_CALLS_OUTLIER`       | 50      | Office outlier eligibility                                                             |
| `OUTLIER_Z`               | 3       | Office outlier flag. About 16 tests per screen (~8 offices x 2 rates) give roughly an 18% chance of a false flag at 2.5, so 3. |
| `MIN_ANSWERED_FOR_RATE`   | 30      | Missed-call value fallback to channel, then overall                                    |
| `ALERT_Z`                 | 3       | Campaign call alert (S1). About 12 campaigns are tested at once, so 3, as for offices. |
| `MIN_CALLS_ALERT`         | 20      | Campaign call alert (S1): calls in both periods added together needed to be tested     |

---

## 5. Data rules

All rules live in the pure data core. **Each rule gets its own test** against a small hand-written fixture built to exercise it.

1. **Loading.** Read `calls.csv`, `campaigns.csv`, `locations.csv` from `DATA_DIR` (default: repo root). Match columns by header name, not position. A missing required column stops startup with a message naming the file and column. Extra columns are ignored. Empty file: start with zero calls and say so.
2. **Deduplication first.** Group rows by `call_id`; keep the row with the latest `updated_at`. Dedup happens **before** validation chooses rows, so a bad latest row never resurrects an older good one; that call is reported bad. If two rows tie on `updated_at`, keep the later one in the file and count the tie in data notes. A row whose `updated_at` can't be parsed loses to any parseable row of the same call. When no row of a call has a parseable `updated_at`, keep the later one in the file and do not count a tie.
3. **Validation.** A call is bad, counted by reason and excluded from metrics, if: the row has fewer cells than the header (`truncated_row`: it was cut off, not left blank); `started_at` can't be parsed, or its year is outside 2000–2100 (`bad_timestamp`: a placeholder date such as 0001-01-01, 1970-01-01 or 9999-12-31 would otherwise stretch the date span; the window is a plausibility check, not this dataset's dates); `location_id` is not in locations; `campaign_id` is non-empty but not in campaigns; `answered` is not a boolean; `outcome` or `marketing_channel` is outside its enum; or duration is negative. An unknown location time zone (not a valid IANA zone) makes that location's calls bad. Bad rows never crash the app.
   - Timestamps are ISO 8601 UTC: end in `Z`, `+00:00` or `-00:00`, with up to 9 fractional digits (keep milliseconds). Reject any other offset and any impossible date or time.
   - Also reject, each with its own reason: `inconsistent_outcome` (answered is true with an outcome of `missed` or `voicemail`, or false with any other non-empty outcome; an unanswered call may have an empty outcome); `bad_revenue` (non-empty but not a non-negative amount); `bad_duration` also covers an empty or non-integer duration.
   - A `campaigns.csv` row with an unknown channel is not a campaign, but keep its id aside: calls to it are `invalid_campaign`, with a detail naming what is wrong with the row, not `unknown_campaign` ("is not in campaigns" would be false). Report the row itself as a reference issue, as an invalid office time zone is. Only a bad channel makes a campaign row unusable.
   - A `campaigns.csv` row whose budget is blank or can't be read (not a plain non-negative number, e.g. `$150.00`, `1,500.00`, `abc` or a negative) stays a campaign with an unknown budget. A blank budget leaves a reference note (`no_budget`); an unreadable one is reported as a reference issue (`bad_budget`). Do not try to read currency formats. Its calls, bookings and revenue count as normal; its estimated spend, estimated cost per booking and revenue per budget dollar are blank, and it is never ranked best or worst.
   - Offices with an invalid time zone get no row in the Locations table or the missed-calls heatmap; their calls are already reported as bad.
   - A location time zone name that is valid but read as a different zone beyond letter case (an alias such as `EST`, read as `America/Panama`) stays valid; leave a reference note (`timezone_reinterpreted`) naming the zone it was read as, so a wrong guess shows.
   - Report, as reference issues, campaigns with an empty name, a name another campaign already uses (ignoring case), or the name "Unattributed": each makes the AI fact sheet ambiguous. These rows stay valid campaigns, so an upload does not reject them.
4. **Unattributed.** Empty `campaign_id` becomes the "Unattributed" bucket. These calls are never dropped. An unknown non-empty `campaign_id` is **not** unattributed; it's a bad row (a data error, not a missing campaign).
5. **Time.** Store UTC. Derive local date, local hour and local weekday from the call's office time zone via the built-in `Intl` API. Every date filter, time-of-day and day-of-week view uses local values.
6. **Revenue.** Counts only when the current outcome is `booked`. Revenue on any other outcome is ignored and counted in data notes. A booked call with empty revenue counts as a booking with $0 revenue and is counted in data notes.
7. **Pending outcomes.** An answered call with an empty outcome is "pending": it counts in calls and answer rate, not in bookings, and is excluded from booking-rate denominators used for missed-call value.
8. **Spend.** Not in the data. Estimated spend = daily budget x days in range; always labeled as an estimate. Cost per booking is blank when budget is $0 or not given, or bookings are 0.
9. **Comparisons.** Equal length by default; a second range of another length is compared per day and labelled as such. A comparison period not fully covered by the data shows no change and says why. Partial first or last data days are noted (section 3.2).
10. **Weeks.** Monday to Sunday by local date; partial weeks marked.
11. **Nothing hard-coded.** No campaign names, office names, IDs, channels-to-campaign maps or dates in code. Enums (`outcome`, `marketing_channel`) are the documented column contract and may live in code.

---

## 6. Architecture

```
CSV files ─▶ load + validate ─▶ clean (dedupe, attribute, localize) ─▶ CallStore (in memory)
                                                                          │
 Browser (React) ◀── JSON ── Node API server ──▶ view builders(range A, range B) ──▶ fact sheets
                                   │                                                    │
                                   └──▶ AI takeaway service ◀── fact sheet ────────────┘
                                          (placeholders, checker, cache, spend guard, log)
```

**Stack:** TypeScript end to end. Node 24. Vite + React front end, Hono server, vitest. One package, one `npm start`.

### Units, each with one job

1. **Data core** (pure TypeScript, no I/O, no framework). Holds the parse/validate, clean, metrics and views functions:
   - _Parse/validate:_ raw CSV records into typed calls plus a bad-row report.
   - _Clean:_ dedupe, attribute, localize; produces the CallStore and the data notes.
   - _Metrics:_ small pure functions (rates, changes, estimated spend, cost per booking, z-test, missed-call value, week bucketing).
   - _Views:_ `(store, rangeA, rangeB?) → view data + fact sheet + template action`.

   This is where nearly all tests live.

2. **Server** (Hono). Loads the data once at startup, then serves:
   - One JSON endpoint per view, taking range A and optional range B.
   - The callback list as CSV.
   - Takeaways, on their own endpoint so views never wait on AI.
   - The built front end, in production mode.

   Bad query parameters return 400 with a message.

3. **AI service** (server-side only). Turns a fact sheet into a checked takeaway or returns the template (section 7). The API key never reaches the browser.
4. **Web app** (Vite + React). It has the view shell, the date range control, and the inline caveats, and draws charts with one small library (Recharts). It formats numbers and draws; it never computes metrics. Colors, type, spacing and motion timings are design tokens from the first UI phase so S5 is a restyle, not a rewrite.

### Config (`.env`, documented in `.env.example`)

| Variable             | Meaning                                      |
| -------------------- | -------------------------------------------- |
| `ANTHROPIC_API_KEY`  | Optional. AI is on exactly when this is set. |
| `AI_SPEND_LIMIT_USD` | Spend guard for the running app. Default 5.  |
| `DATA_DIR`           | Folder holding the three CSVs.               |
| `DB_PATH`            | The SQLite database (S6). Default `data/calls.db`; `:memory:` seeds from the CSVs on every start. The Docker image sets its own. |
| `PORT`               | Default 3000.                                |
| `HOST`               | Default 127.0.0.1. The Docker image sets 0.0.0.0; Compose publishes only on the host's 127.0.0.1. |

### Commands

- `npm start`: build the web app and serve everything on one port.
- `npm run dev`: server and Vite with hot reload.
- `npm test`: vitest.
- `docker compose up --build`: build the image and run the app on one port, reading `.env` and the data folder (Phase 10).

### Freshness

The data is a snapshot read at startup; the header shows the as-of date. From S6 the snapshot comes from the database, not the CSVs: a new export means `npm run seed <folder>` and a restart (or moving the database file aside so the next start seeds it), and from S7 an upload in the app updates the snapshot without a restart. Live reload is out of scope.

### Dependencies

Expected list. **Ask before adding each one, at the start of the phase that needs it:** typescript, tsx, vitest, csv-parse, hono, @hono/node-server, react, react-dom, vite, @vitejs/plugin-react, @types/react, @types/react-dom, recharts, @anthropic-ai/sdk, Framer Motion for S5, and for S6 a SQLite driver only if Node's built-in `node:sqlite` falls short (better-sqlite3). Dev only: happy-dom and @testing-library/react, for the click-through UI tests (section 8), which replaced tests that only matched file text. Anything beyond this list needs a reason in `docs/DECISIONS.md`.

---

## 7. How AI is used, checked and budgeted

### Use

One call per view turns that view's fact sheet into a 2–3 sentence takeaway: what it means and what to do. AI is an add-on; every view is complete without it.

- **Model:** `claude-haiku-5-5`, the cheapest current model; the task is short, structured writing. Low effort. Structured JSON output.
- **Input:** the fact sheet only (named values plus entity names), never raw calls.

### The model never writes numbers

The model writes text with **placeholders** that name fact-sheet keys, e.g. `{worst.name} earns {worst.revenue_per_dollar} per budget dollar, versus {best.revenue_per_dollar} for {best.name}.` Code substitutes the formatted values. The model therefore cannot produce or alter a metric.

### Checker

Runs on every output before display. If any check fails, log why and ask the model once more with the same prompt plus the checker's reason; if the retry also fails, show the template text and log why. The retry is a call of its own: it passes the spend guard first and gets its own log line. The checker rejects text that:

- uses a placeholder not in the fact sheet;
- contains any digit outside placeholders;
- contains number words or quantity words (a fixed list: "one" through "twenty", "hundred", "thousand", "million", "percent", "half", "twice", "double", "triple", "dozen", and similar);
- names any campaign, office or channel from the loaded data that is not in this fact sheet's entities;
- is empty or longer than the length limit.

Known limit, stated in TECHNICAL.md: the checker can't catch an invented name that appears nowhere in the data. The prompt forbids it, and entities must be written as placeholders.

### Cache

- **Key:** hash of (data snapshot id, fact sheet, prompt version, model).
- **Storage:** in memory, also persisted to a gitignored `.cache/` JSON file, so repeats and restarts cost nothing.
- **Prompt changes:** bump the prompt version.

### Spend guard

- Each call is costed from `usage` input and output tokens via a price table in config.
- Before calling, if logged spend plus a worst-case estimate for this call exceeds `AI_SPEND_LIMIT_USD`, skip the call and return the template with reason "AI budget reached".
- Spend is summed from the call log, so it survives restarts.

### Call log

One JSON line per call in gitignored `logs/ai-calls.jsonl`. Each line holds:

- time, model, purpose (view name)
- input and output tokens, cost
- whether it was served from the cache
- whether the check passed, and the failure reason if not

Cache hits are logged with zero cost. (`docs/AI_COST_LOG.md` is maintained by me, not the app.)

### Failure handling

Fall back to the template and log the reason on:

- no key
- timeout (about 8 s)
- API error
- refusal
- malformed JSON
- checker failure, after one retry with the checker's reason (the only failure that is retried)

The UI shows which it is with a small "template" vs "AI" marker.

### Expected cost

About 1.5K input and 300 output tokens per call, which comes to well under $0.001. The running app should cost cents; nearly all of the $250 goes to the build.

### Stretch S4 uses the same pattern

The model fills a fixed filter schema (view, offices, campaigns, weekdays, hours, date range) via structured output. Code validates every value against the loaded data, then runs the filter. The model never sees calls or produces numbers. An invalid or empty filter shows "Couldn't turn that into a filter" with examples.

---

## 8. Testing

- **Data rules:** one test per rule in section 5, each against a tiny hand-written fixture (5–20 rows) built to exercise that rule. Fixtures live with the tests and are readable by a reviewer.
- **Metrics:** table-driven tests covering:
  - zero budget, zero bookings
  - previous value 0, both values 0
  - a partial comparison period
  - a call near midnight UTC landing on a different local date
  - America/Phoenix (no DST) next to a DST zone
  - week boundaries
  - the z-test at and around the threshold
  - missed-value fallback from campaign to channel to overall
- **Snapshot totals:** on the shipped export (calls, bookings, revenue, unattributed, bad rows) and separately on the extended export. These catch regressions, not rules.
- **Views:** each view builder on a fixture where the expected action is known, plus the "nothing stands out" case for Locations and the "fewer than two eligible campaigns" case for Campaigns.
- **Server:** in-process requests to every endpoint. Covers valid ranges, bad or missing params (400), an inverted range, a range outside the data, and the CSV download's headers and rows.
- **AI:** checker tests with crafted good and bad outputs, one per rejection reason. Client, cache and guard are tested with a fake model: a cache hit makes no call; the guard blocks at the limit; every failure mode falls back. **No automated test calls the real API.** A manual script makes one real call when I choose to run it.
- **Hard-coding guard:** a test runs the core on a fixture export with entirely different campaign names, office names, time zones and dates, and checks every view builds.
- **Web:** decisions (text, order, blanks, caveat conditions, URL state, request state) live in pure modules with their own tests. Components are kept thin and are tested by rendering them to a string in Node with `react-dom/server`, checking what must be present or absent: blank cells, escaped names, loading and error states. Click-through tests (`tests/web/*.dom.test.tsx`) render the whole app in happy-dom with Testing Library and a stubbed `fetch`, then click and type as a user would: navigation, the range control, the ask box and upload. No test matches CSS, Docker or source file text. Visual layout, wrapping and charts are not unit tested. Each UI phase also ends with a written click-through checklist, run in the browser and shown to me.

---

## 9. Build order

Work one phase at a time. Each phase gets its own implementation plan first, ends with `npm test` green and the results shown to me, then stops.

### Phase 0: Scaffold

- **Delivers:** git repo, TypeScript + vitest set up, `.env.example`, `.gitignore` (`.env`, `.cache/`, `logs/`, build output), `npm test` running an empty suite, README stub with the commands.
- **Done when:** `npm install && npm test` passes on a clean clone; no secrets tracked.
- **Edge cases:** none beyond confirming `.env` is ignored.

### Phase 1: Load and validate

- **Delivers:** reading the three CSVs from `DATA_DIR` into typed records plus a bad-row report by reason.
- **Done when:** loading the shipped export reports 5,411 rows; each validation rule has a passing fixture test.
- **Edge cases to handle and test:**
  - missing required column (clear error)
  - extra and reordered columns
  - empty file
  - quoted fields with commas
  - CRLF line endings
  - unparseable timestamps
  - unknown location
  - unknown non-empty campaign
  - bad boolean or enum
  - negative duration
  - invalid IANA zone in locations

### Phase 2: Clean

- **Delivers:** dedupe, attribution, localization, pending outcomes, revenue rule and the data notes summary.
- **Done when:** the shipped export cleans to 5,000 calls, 1,204 bookings, $432,894 revenue and 144 unattributed, and every rule in section 5 has its own passing test.
- **Edge cases to handle and test:**
  - three rows for one call arriving out of order
  - `updated_at` tie
  - bad latest row with good older row (call reported bad)
  - empty campaign_id
  - revenue on a non-booked row
  - booked with empty revenue
  - answered with no outcome
  - a call at 02:00 UTC that is the previous local day
  - Phoenix vs Denver in the same week

### Phase 3: Ranges and metrics

- **Delivers:** presets, custom ranges, comparison ranges and coverage checks, plus every metric function in section 4, as pure functions.
- **Done when:** the table-driven metric tests pass.
- **Edge cases to handle and test:**
  - range outside data
  - start after end
  - one-day range
  - "all data" has no comparison
  - comparison partly before data start
  - first data day flagged as possibly incomplete; last data day not flagged
  - previous 0 → "new"
  - both 0
  - zero budget (blank cost per booking)
  - zero bookings
  - z-test with tiny samples (not eligible)
  - partial weeks

### Phase 4: Extended dataset

- **Delivers:** an extended export in its own data folder, produced by a seeded, committed script so it is reproducible. It adds patterns the original data lacks, so the Locations view (and others) have something real to find. The original export stays untouched.
- **Starts with a decision, agreed with me:**
  - which pattern(s) to add (for example, one office with a markedly lower answer rate at certain hours)
  - which dataset `npm start` uses by default

  Record both in `docs/DECISIONS.md`. The README says the extended export contains synthetic rows.

- **Done when:** the script regenerates an identical file from its seed; the extended export loads with zero unexpected bad rows; its snapshot totals are recorded in a test.
- **Edge cases:**
  - new rows use the same columns and rules: some duplicates, some unattributed, some pending
  - the extended data must not break any existing rule test

### Phase 5: View builders

- **Delivers:** all four views as pure functions of (store, range A, range B?). Each returns view data, a fact sheet and a template action sentence.
- **Done when:** each view's fixture test produces the expected action, and the different-names fixture builds every view.
- **Edge cases to handle and test:**
  - fewer than two campaigns eligible for best/worst
  - no unattributed calls in range (no attribution action)
  - no office flagged ("nothing stands out" action)
  - office flagged better rather than worse
  - no missed calls in range
  - caller who missed then got through (excluded from callback list)
  - caller who got through, then missed (included)
  - campaign too thin for its own rate (channel fallback)
  - empty range

### Phase 6: Server

- **Delivers:** Hono server loading data at startup, view, takeaway (template only for now) and callback CSV endpoints, plus serving the built front end.
- **Done when:** in-process endpoint tests pass, and `npm start` serves JSON for every view on the shipped data.
- **Edge cases to handle and test:**
  - missing or malformed date params (400 with message)
  - inverted range
  - range outside data
  - unknown campaign in the weekly-chart param
  - CSV escaping of fields
  - startup with a missing data folder (clear error, non-zero exit)

### Phase 7: UI part 1 (shell, range, Overview, Campaigns)

- **Delivers:**
  - the app shell with navigation
  - date range control with presets and custom, state in the URL
  - the inline caveats (section 3.3)
  - the Overview and Campaigns views with actions
  - design tokens (color, type, spacing, motion durations) in one place
- **Done when:** the click-through checklist passes in the browser:
  - presets
  - custom range
  - refresh keeps state
  - change hidden on "All data" with a reason
  - best/worst marked
  - weekly chart switches campaign
  - partial weeks marked
  - estimates labeled, incomplete-day notes visible
- **Edge cases:**
  - loading and error states for each request
  - empty range
  - blank cost-per-booking cells
  - very long campaign names

### Phase 8: UI part 2 (Locations, Missed calls)

- **Delivers:** the Locations view with outlier flag and best-campaign column, and the Missed calls view with heatmap toggle, estimated lost value with formula, callback list and CSV download.
- **Done when:** the click-through checklist passes on both the shipped and the extended data:
  - the flag appears where the extended data plants it, and "nothing stands out" appears on the original
  - the Locations action links to Missed calls filtered to that office
  - the CSV downloads and opens correctly
- **Edge cases:**
  - an office with no calls in range
  - a heatmap cell with zero calls
  - an empty callback list

### Phase 9: AI takeaways

- **Delivers:**
  - the AI service: prompt per view, placeholders, checker, cache, spend guard and call log
  - the takeaway shown on each view with an AI/template marker
  - a manual script for one real call
- **Done when:**
  - all AI tests pass with the fake model
  - with no key, every view shows template text and the app is otherwise unchanged
  - with a key, one manual run per view shows a checked takeaway, a repeat is a cache hit with zero cost, and the log has one line per call
  - I record the spend in `docs/AI_COST_LOG.md`
  - the README covers what this phase added
- **Edge cases to handle and test:**
  - unknown placeholder
  - stray digit
  - number word
  - off-sheet entity name
  - too long
  - malformed JSON
  - timeout
  - refusal
  - guard at the limit
  - cache survives restart

### Phase 10: Docker

- **Delivers:**
  - a multi-stage `Dockerfile` on Node 24: build the web app, then a slim runtime image that runs the server
  - `docker-compose.yml` with one service, so `docker compose up --build` is the one command
  - `.dockerignore` covering at least `node_modules`, `.env`, `.git`, `dist`, and the AI cache and call log
  - the data folder mounted read-only at `DATA_DIR`, and the AI cache and call log on a named volume so the cache survives restarts
  - the API key passed in at run time from `.env`, never built into the image
  - `npm start` keeps working without Docker
- **Done when:**
  - on a clean clone, `docker compose up --build` serves all four views at `http://localhost:3000`, both with no `.env` (AI off) and with a key (AI on)
  - `npm test` passes, and `npm start` still works outside Docker
  - the built image contains no `.env` file and no key
  - the README covers what this phase added
- **Edge cases to handle and test:**
  - the server listens on 127.0.0.1, which a container can't publish: inside the container it listens on 0.0.0.0 (a `HOST` setting), and Compose publishes the port only on the host's 127.0.0.1, so the callback list is still not exposed to the network
  - no `.env` file: Compose still starts, and AI is off
  - missing or wrong data mount: the same one-line `Cannot start: ...` and non-zero exit, visible in `docker compose logs`
  - the host's port 3000 already in use: a documented `PORT` override
  - the extended export selectable with `DATA_DIR=data/extended`
  - results that don't depend on the container's time zone: the numbers match `npm start` on the host
  - Windows checkouts: nothing in the image depends on shell scripts that break on CRLF line endings

### Stretch phases (in order, after Phase 10)

#### S1: Alerts

- **Delivers:** a flag on campaigns whose calls jumped or dropped against the comparison range by more than chance explains. Use a Poisson-style test on counts, `z = (current − previous) / √(current + previous)`, flagged at `|z| >= ALERT_Z` when current + previous reaches `MIN_CALLS_ALERT` (section 4.5). Unattributed is never flagged. Alerts appear on Overview's top actions (one extra entry, section 4.1) and in the Campaigns table. Detail in `docs/archive/plans/s1-alerts.md`.
- **Done when:** fixture tests cover jump, drop, no change, and too-small counts; the README covers what this phase added.
- **Edge cases:**
  - comparison not available (no alerts, say why)
  - campaign with zero calls in one period

#### S2: Compare any two date ranges

- **Delivers:** UI to pick a second range freely. The engine already supports it.
- **Done when:** the URL holds both ranges and every view's changes use the chosen range; the README covers what this phase added.
- **Edge cases:**
  - overlapping ranges (allowed, with a note)
  - unequal lengths (counts are compared per day, and the view says so)
  - second range outside the data

#### S3: Print-friendly one-page summary

- **Delivers:** a print view for the current range with the Overview tiles, each view's action and its takeaway, plus the estimate labels and caveats from section 3.3. It fits on one page.
- **Done when:** browser print preview fits one A4/Letter page on both datasets; the README covers what this phase added.
- **Edge cases:**
  - AI off (template text)
  - long names wrapping

#### S4: Ask a question in plain English

- **Delivers:** a question box; the model maps the question to the fixed filter schema; code validates and applies it, then shows the matching view filtered. Same logging, cache and guard as section 7.
- **Done when:**
  - fake-model tests pass for a valid filter, invalid values and an unanswerable question
  - three manual example questions produce correct filters
  - the README covers what this phase added
- **Edge cases:**
  - names that don't exist in the data
  - ambiguous weekday or hour phrasing
  - AI off (box hidden, with a note)

#### S5: Polished visual design with motion

- **Delivers:** a sleek, modern, distinctive look that does **not** read as generic AI-generated UI, with smooth motion.
- **Look criteria:**
  - a deliberate type pairing (not default system or Inter-only)
  - a restrained palette with one accent used for actions
  - data-first layouts with generous spacing
  - no purple gradients, glassmorphism cards, emoji icons, or uniform rounded-card grids
- **Motion criteria:**
  - view transitions between tabs
  - numbers tweening on range change
  - the weekly chart animating in place when only the selected campaign changes; a range change transitions the whole view, so the chart redraws for the new range
  - panels and takeaways entering and leaving smoothly
  - all of it short (about 150–300 ms), eased, and fully disabled under `prefers-reduced-motion`
- **Approach:** Framer Motion for all motion, so transitions, number tweens and layout changes share one consistent system (ask before adding the package at the start of S5). Its built-in reduced-motion support is used to switch motion off.
- **Done when:** I sign off on the look in the browser; reduced-motion mode shows no animation; no view's numbers or actions change; the README covers what this phase added.

#### S6: Database, seeded from the CSVs

- **Delivers:**
  - SQLite as the store of record: one file at `DB_PATH` (default `data/calls.db`, gitignored)
  - `npm run seed` loads an export through the existing load, validate and clean steps into tables for every raw call row (all versions kept), campaigns, locations and bad rows
  - seeding that is safe to repeat: the same export twice changes nothing; a newer export adds new row versions and the latest one wins
  - the server builds its CallStore from the database instead of reading the CSVs; metrics, view builders and the API don't change
  - `npm start` seeds from `DATA_DIR` when no database exists, so it stays one command
  - the driver: Node's built-in `node:sqlite` if it does the job on Node 24, otherwise better-sqlite3 (ask before adding it)
- **Done when:**
  - snapshot totals read from the database match the CSV path exactly, on the shipped and the extended export
  - every existing test passes unchanged
  - on a fresh clone, `npm start` seeds and serves; a restart reads the existing database without reseeding
  - in Docker, the database file lives on the named volume and is seeded on first run
  - the README covers what this phase added
- **Edge cases:**
  - seeding the same export twice (no duplicates)
  - a newer version of an existing call (latest wins)
  - bad rows (stored with their reason, never counted as calls)
  - a missing or corrupt database file (a clear message, never silently empty data)
  - a database from an older schema version (refuse with a message to reseed)
  - seeding while the server runs (the server keeps its snapshot until restart, and the README says so)
  - tests use an in-memory database, never the real file

#### S7: Upload a CSV into the database (needs S6)

- **Delivers:**
  - an upload control in the app that takes one CSV file at a time
  - automatic detection of what the file is (calls, campaigns or locations) from its header columns, regardless of column order; a file that matches none, or more than one, is rejected with the columns it expected
  - each row run through the existing validation, with bad rows reported by reason
  - duplicate checks against the database before anything is written:
    - calls: the same `call_id` and `updated_at` already stored is a duplicate and skipped; a new `updated_at` for an existing `call_id` is a new version, stored, and the latest wins as usual
    - campaigns and locations: the same id with identical values is a duplicate and skipped; the same id with different values is a conflict, reported and not written
    - duplicates inside the uploaded file itself are caught too
  - a preview before writing: the detected type, and counts of new rows, new versions, duplicates, conflicts and bad rows, with examples of each; nothing is written until the user confirms
  - on confirm, all new rows are written in one transaction, and the server rebuilds its CallStore so every view reflects the upload without a restart
  - Hono's built-in body parsing handles the file, so no new package
- **Done when:**
  - uploading the shipped `calls.csv` into a database seeded from it imports nothing and reports every row as a duplicate
  - an upload of new calls shows up in every view's numbers right after confirming
  - fixture tests cover detection, every duplicate and conflict rule, and the preview counts
  - the README covers what this phase added
- **Edge cases:**
  - columns in a different order, extra columns, a byte-order mark, Windows line endings
  - an empty file, a header-only file, a file that isn't CSV, or one over a set size limit
  - calls that reference a campaign or office not in the database (bad rows, with a hint to upload campaigns or locations first)
  - the same file uploaded twice (the second upload imports nothing)
  - a failure partway through the write (the transaction rolls back and nothing is stored)
  - AI takeaways for ranges the upload changed are not reused from the cache, because the cache key includes the data
  - uploads stay safe only because the server listens on localhost and there is no login; the README says so

### Phase 11: Submission docs

Runs after the stretch phases, so the docs cover what they added.

- **Delivers:**
  - README with setup and the one command (`docker compose up --build`), plus the `npm` path without Docker
  - TECHNICAL.md (1–2 pages, covering the brief's list)
  - architecture diagram
  - decision summary draft for me to finish
  - `docs/DECISIONS.md` up to date
- **Done when:** a clean clone following only the README runs the app with Docker and with `npm`, with and without a key, and `npm test` passes.

---

## 10. What "done" means

The product is done for submission when **Phase 11 is complete**:

- A fresh clone runs with `docker compose up --build`, or with `npm install` and `npm start`, both documented in the README.
- All four views work on the shipped export and the extended export, and each ends in an action backed by a code-computed number.
- The app works fully with the API key missing.
- Every data rule in section 5 has a passing test, and `npm test` is green.
- With a key, takeaways are checked, cached, logged with cost, and stop at the spend limit.
- No secrets in git history. `.env.example` documents config.
- README, TECHNICAL.md, architecture diagram and the decision summary draft exist, and `docs/DECISIONS.md` is current.

Stretch phases S1–S7 are done individually by their own "done when" lines, and none may break the above.
