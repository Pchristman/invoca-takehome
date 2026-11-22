# Inbound Call Performance

A small local web product that helps a marketing manager track inbound call performance and act on it. Every number comes from code; AI is an optional add-on and the app works fully without it.

## Setup

1. Install Node.js 22.18 or later, or 24 or later.
2. Install the dependencies:

   ```
   npm install
   ```

3. Build and start the app:

   ```
   npm start
   ```

   This builds the web app, loads the three CSVs in the repo root into a local database on first start, and serves the app. Then open `http://127.0.0.1:3000`.
4. Optional: to turn on the AI features, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. The app works fully without it.

With Docker instead, `docker compose up --build` is the only command needed, and the app is at `http://localhost:3000`.

## Commands

| Command | Status |
| --- | --- |
| `npm install` | available |
| `npm test` | available (vitest) |
| `npm run typecheck` | available |
| `npm run generate:extended` | available; rewrites `data/extended/` from the shipped export and a fixed seed |
| `npm run seed [folder]` | available; loads the three CSVs from the folder (default `DATA_DIR`, else the current folder) into the database; see Database below |
| `npm run build` | available; builds the web app into `dist/` |
| `npm start` | available; builds the web app, then serves it and the JSON API at `http://127.0.0.1:3000`; reads `.env` (`HOST`, default 127.0.0.1; `PORT`, default 3000; `DATA_DIR`; `DB_PATH`, default `data/calls.db`) |
| `docker compose up --build` | available; builds one image and serves the app at `http://localhost:3000`; see Docker below |
| `npm run test:docker` | available; real Docker checks (needs Docker running; builds the image, starts containers, makes no real API call) |
| `npm run ai:try -- <view|all>` | available; makes REAL API calls (needs a key); see AI takeaways below |
| `npm run ai:try -- --question "..."` | available; one REAL call per question (needs a key); see Ask a question below |
| `npm run dev` | available; the server (restarting on change) and Vite with hot reload together, `/api` proxied to the server; the page is at the address Vite prints on start |

Needs Node.js 22.18 or later, or 24 or later (the Docker image uses 24): the app uses `node:sqlite`, `process.loadEnvFile`, and runs `.ts` scripts with Node's own type stripping.

Copy `.env.example` to `.env` to configure. `npm start`, `npm run dev`, `npm run seed` and `npm run ai:try` read it at start; a variable set in the shell wins. Tests never read it. Never commit `.env`.

## Docker

One command: `docker compose up --build`, then open `http://localhost:3000`. A `.env` is optional: with none, AI is off and every view uses template text. If a start fails, plain `docker compose up` may still exit 0, so read `docker compose logs`.

- **Another host port:** `PORT=3001 docker compose up --build` (PowerShell: `$env:PORT=3001; docker compose up --build`), or set `PORT` in `.env`. `PORT` is only the host side; inside the container the server is always on 3000.
- **Another export:** `DATA_DIR=data/extended docker compose up --build` on a **first run**. After a first run the database already exists on the `calls-db` volume, so the app keeps serving the old data and prints a warning in `docker compose logs`; see "Database in Docker" below. `DATA_DIR` chooses the folder mounted read-only at `/data`; use forward slashes on Windows. The folder is a long-syntax bind mount, so a mistyped folder is not created: Compose refuses to start the container and names the missing path.
- **The default mount shows the container the whole repo folder, read-only, at `/data`, including your `.env` (and its key).** The app reads only the three CSV files. Set `DATA_DIR` to a folder that holds only the CSVs to keep the rest out.
- **Not on the network:** the server listens on all interfaces inside the container, and Compose publishes it only on your machine's `127.0.0.1`, so the callback list is not exposed. Never change the port line in `docker-compose.yml` to `0.0.0.0`.
- **New data:** a restart alone is not enough, because the app reads the database, not the CSVs. Upload a CSV in the app (see "Upload a CSV"; it is kept on the `calls-db` volume), or see "Database in Docker" below.
- **Separate from `npm start`:** Docker keeps its AI call log and cache on the volumes `ai-logs` and `ai-cache`, while `npm start` uses `./logs` and `./.cache`. Each has its own spend cap (using both doubles the effective cap), and a takeaway paid for in one is paid for again in the other.
- **Start-up line:** inside the container it says `http://localhost:3000` even when `PORT=3001` publishes it on 3001; the host port is the `PORT` you set.
- **Exported key:** your shell's exported `ANTHROPIC_API_KEY` beats `.env`. To run with AI off, unset it first (PowerShell: `Remove-Item Env:ANTHROPIC_API_KEY`), or real API calls will be made.
- **AI cache and call log** live on the volumes `ai-cache` and `ai-logs`. `docker compose down` keeps them. **`docker compose down -v` deletes the call log, so the spend guard counts from $0 again.** To read the log: `docker compose run --rm app cat logs/ai-calls.jsonl`.
- **The key** comes from `.env` at run time and is never in the image.
- **`HOST` warning:** some shells (zsh) set `HOST` to the machine name. If it is exported (the shell beats `.env`), `npm start` listens on that address, which may be reachable from other devices on your network. When the bound address is not loopback, `npm start` prints a `Listening on a non-loopback address (...)` line; if you see it and did not mean it, unset `HOST` or set `HOST=127.0.0.1`. Inside Docker the image sets its own `HOST`, so this does not matter there.

### Database in Docker

- The database file is on the named volume `calls-db` (mounted at `/app/db`; the image sets `DB_PATH=/app/db/calls.db`, and `.env` cannot change it). The first run seeds it from the mounted data folder.
- **A different export after a first run:** `DATA_DIR=data/extended docker compose up --build` still serves the first export and prints a warning in `docker compose logs`. The image does not include the `npm run seed` script, so to use another export, start fresh as below and bring it up with that `DATA_DIR`.
- **Start fresh:** `docker compose down -v`. This also clears the AI cache and the AI call log, so copy `ai-logs` first (`docker compose run --rm app cat logs/ai-calls.jsonl`) if you need the spend history.
- **After an update that changes the database schema** (this version needs schema version 2), a database from an older version stops the app with `Cannot start: The database /app/db/calls.db has schema version 1; this app needs 2. ...` in `docker compose logs`. The image has no `npm run seed`, so only the "(or restart)" part of that message applies. Remove the database volume alone, which keeps the AI cache and call log: `docker compose down`, then `docker volume rm inbound-calls_calls-db`, then `docker compose up --build`, which seeds a new database from the mounted data folder. Do not use `down -v` for this: it also wipes the spend log.

## Data

The app reads three CSVs: `calls.csv`, `campaigns.csv` and `locations.csv`. They are loaded into a database (next section) and the app reads the database. They come from the folder named by `DATA_DIR` (set in the shell or in `.env`; the shell wins), or the current directory when it is unset or blank. A relative `DATA_DIR` is relative to the current directory. Columns are matched by header name, so extra or reordered columns are fine; a missing required column stops startup with a message naming the file and column.

The loader returns every `calls.csv` row as either a typed call or a bad row, with bad rows counted by reason (bad timestamp, a row cut off with fewer cells than the header, unknown location, unknown campaign, and so on). Timestamps must be UTC, ending in `Z`, `+00:00` or `-00:00`, with up to 9 fractional digits. A `started_at` whose year is outside 2000–2100 is a bad timestamp, taken as a placeholder date (0001-01-01, 1970-01-01, 9999-12-31). Bad rows never crash the app. A campaign whose budget is blank or unreadable is kept, with its cost estimates blank and never ranked best or worst; an office time zone written as an alias (`EST`, read as `America/Panama`) is kept, with a note in the data notes naming the zone it was read as. When several rows share a `call_id`, the one with the latest `updated_at` is the call (see Database below).

## Database

The app keeps its calls in one SQLite file, `DB_PATH` (default `data/calls.db`, gitignored; it holds call data, not keys).

- **`npm run seed [folder]`** loads the three CSVs from the folder (default `DATA_DIR`, else the current folder) into the database.
- **`npm start` seeds when the file is missing** and reads the file afterwards.
- **Re-seeding the same export stores nothing new.** A newer export adds new versions of calls, and the latest `updated_at` wins.
- **Tables:** `raw_calls`, `bad_rows`, `campaigns`, `locations`, `reference_issues` and `seeds`. The app reads the raw tables and cleans them with the same code as before.
- **Views, API and numbers are unchanged** by the database.

### Limits of the database

- A running server keeps its snapshot until restart after `npm run seed`. An upload (next section) updates it at once; `npm run seed` does not.
- One process at a time should write.
- Moving to another data folder needs `npm run seed <folder>` or moving the file aside; at start the app prints a warning when the folder is not what the database was seeded from.
- A file from an older schema, or one that is corrupt, stops startup with a message; the app never deletes it. A database made before this version (schema version 1) is refused with `Cannot start: The database data/calls.db has schema version 1; this app needs 2. ...`: delete or move `data/calls.db` (or the file `DB_PATH` names) aside and run `npm start`, which seeds a new one from `DATA_DIR` (in Docker, see "Database in Docker"). A file that is locked by another process, unreadable or read-only gets its own message, and none of those messages tells you to move the file aside unless it really is damaged.
- **Seeds are merged in the order they were seeded, not re-sorted by the newest file.** Each seed's rows count as stored after everything seeded before, including rows it repeats, so the latest seed wins an exact `updated_at` tie and a call broken by a faulty export is fixed by seeding the good one again. So seeding an export whose rows are reordered, or that inserts rows in the middle, can order calls differently from loading that export alone (which also changes the AI snapshot id, so cached takeaways are asked for again). Seeding one export at a time, oldest first, behaves like loading them in sequence.
- **Campaigns and locations are kept once seen.** A later export that leaves one out does not turn its stored calls bad; a later export that gives an office an invalid time zone makes that office's calls bad (reason `invalid_timezone`), as it would for a single export.
- **Data notes count every row ever seeded, not just the latest export's.** After a faulty export and then the good one again, the calls match a fresh load of the good export, but rows read, bad rows, duplicates and ties still count the faulty rows, which stay stored as older versions; the same goes for calls stored as bad (an unknown campaign) and stored again once the campaign is added.
- **Reference issues** (campaign or location rows that were skipped, or kept with a note) describe the latest seed's files only.

### Extended export (synthetic)

`data/extended/` holds a larger export that **contains synthetic rows**. Its `calls.csv` is the shipped file, unchanged, followed by 1,500 invented rows (call ids start `x_`); `campaigns.csv` and `locations.csv` are copies. It plants four patterns the shipped data lacks, so the Locations and Campaigns views have something to find:

- a low answer rate at Canyon Office on weekday mornings (local time);
- a low booking rate at Riverside Office, with a normal answer rate;
- a surge in one campaign's calls over the last 28 days;
- a fade in another campaign's calls over the 28 days before that.

It also carries the same mess as the original: duplicate rows, unattributed calls and pending calls. It has no bad rows.

Things to know when reading it:

- Locations flags only the two planted offices, both "worse": over all data, Riverside on booking rate and Canyon on answer rate; over the last 28 days, only Canyon. Each office is compared with all the others pooled, and the planted offices pull that pool down, so ordinary offices drift toward "better", but none reaches the flag threshold (`OUTLIER_Z`, 3). The shipped export flags none.
- 1,400 invented calls add about 565 distinct callers (2,040 to 2,605); copies reuse real callers at the same share the shipped data shows, so repeat callers are still present.
- Its cmp_06 has 33 bookings against 27 in the shipped export: the fade plants calls with no bookings, but the other synthetic calls copy from every campaign.

The default stays the shipped export. To use the extended one on a **first run** (no database yet), set `DATA_DIR=data/extended`; on a **later run** the existing database wins, so run `npm run seed data/extended` and restart (or move `data/calls.db` aside). To regenerate it (same seed, same bytes), run `npm run generate:extended`; the script and its settings are in `scripts/generate-extended.ts`.

## Upload a CSV

The **Upload data** button in the header opens a panel where you add one CSV to the database without a restart.

- **What it takes:** one file at a time, either calls, campaigns or locations. The app tells which from the header columns, in any order. Extra columns are fine, and so are a byte-order mark and Windows line endings. The limit is 10 MB.
- **Preview first.** After you choose a file the panel shows five counts for its rows: new, new versions, duplicates, conflicts and bad. It lists a few examples of each and writes nothing. The data changes only when you press the **Add** button.
- **Order to use:** campaigns, then locations, then calls. A call that names a campaign or office the database lacks is reported as bad and not stored, with a hint to upload that file first. Upload the same calls file again afterwards.
- **Calls** match on `call_id` and `updated_at`. A pair already stored with the same values is a duplicate. **The same pair with different values is a conflict and is not written**, so an upload cannot change a stored call. A known `call_id` with a new `updated_at` is a new version, and the latest `updated_at` wins. A bad row that is a newer version of a stored call is reported and not stored, so the older valid version keeps counting; the preview says how many rows that was.
- **Campaigns and locations** match on id. The same values are a duplicate. **Different values are a conflict and are not written**, so an upload cannot change a budget or a time zone. A campaign or location row with a problem (for example an invalid time zone or an unreadable budget such as `$150.00`) is bad and not written. A blank budget is a valid row: the campaign is added and its cost estimates are blank.
- **Repeats inside the file** are caught: a repeated campaign, location or call (same id and time) keeps its first row and later differing rows are conflicts; several versions of one new call (different `updated_at`) are all new rows.
- **One transaction.** All new rows are written together, or none are; if the write fails nothing is stored and the server keeps its old data. Pressing **Add** again, or uploading the same file twice, adds nothing the second time.
- **Views and takeaways update without a restart.** After **Add**, "See the new data" reloads the page on the default range, so the date span, the pickers, every view and every takeaway are fetched again. The takeaway service is rebuilt for the new data, so a takeaway written for the old data is not reused. The spend is read from the call log and carries over.
- **Bad rows are reported, not stored.** The header's "skipped rows" count only covers rows stored by a seed, so an upload does not change it.
- **Safety:** uploads are safe only because the server listens on localhost and there is no login. Like every `/api` route, the upload routes refuse a request whose Host is not localhost (or the host the server is bound to); they also refuse a request that a browser marks as cross-site, and one whose Origin does not match its Host. Do not expose the port; the Docker compose file publishes it only on 127.0.0.1.
- **`DB_PATH=:memory:`** keeps the data in memory, so an upload lasts until the server stops.
- Each confirmed upload adds one row to the `seeds` table, labelled `upload: <file name>`. The database schema is unchanged.

## API

`npm start` reads the database at start (seeding it first if the file is missing) and again after each confirmed upload and serves JSON on **127.0.0.1** unless `HOST` says otherwise (the callback list carries caller hashes; see the `HOST` warning under Docker). On a first start (no database yet), a missing folder, file or column prints one `Cannot start: ...` line and exits 1; once the database holds data the data folder is optional. A bad `PORT` or a busy port always does. Every route is GET only except the two upload routes. Every `/api` route refuses (403) a request whose Host header is not `localhost`, `127.0.0.1`, `[::1]` or the address the server is bound to, so a web page that points its own domain at 127.0.0.1 (DNS rebinding) cannot read the data or spend on AI; the AI routes also refuse a request a browser marks as cross-site.

| Route | Query parameters | 200 body |
| --- | --- | --- |
| `/api/meta` | none | data span, campaign and office lists, presets, skipped rows, load notes |
| `/api/overview` | range, compare | overview view |
| `/api/campaigns` | range, compare, `campaign` | campaigns view |
| `/api/locations` | range, compare | locations view |
| `/api/missed-calls` | range, compare, `location` | missed-calls view |
| `/api/missed-calls/callbacks.csv` | range, compare, `location` | CSV file |
| `/api/takeaway/:view` | as that view | the takeaway: checked AI text, or the template text (AI off, over budget, or the AI text failed its check) |
| `/api/answer` | range, `view`, `f_*` filter | answer panel: totals and a table for the filter (code only) |
| `/api/question` | `q` (at most 300 characters) | a validated filter as a query string (the only AI step; needs a key) |
| `POST /api/upload/preview` | one CSV in the multipart field `file` | what the file would add: counts, examples, hints (writes nothing) |
| `POST /api/upload/commit` | one CSV in the multipart field `file` | what was written, and the fresh `/api/meta` body |

- **Range:** `range=last7|last28|all`, or `start=YYYY-MM-DD&end=YYYY-MM-DD`. Neither given means `last28`.
- **Compare (optional):** `compareStart` and `compareEnd` together.
- Parameters a route does not use are ignored.
- **Errors** are JSON: `{ "error": { "code", "message", "field"? } }`. Status 400 for a bad parameter, an unknown campaign or office, or an upload that is not a readable CSV; 403 `forbidden` for a Host or cross-site request the server refuses; 404 `not_found`; 409 `no_data` for an empty export, or `upload_unavailable` when the server has no database to upload into; 413 `too_large` for an upload over 10 MB; 500 `internal` (no details) or `upload_failed` (nothing was stored).
- **CSV:** UTF-8 with a byte-order mark and CRLF line ends, so a spreadsheet opens non-ASCII names correctly. A cell starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'` so a spreadsheet cannot run it as a formula, except a value that is only a phone number (`+`, then digits, spaces, hyphens and parentheses), so tracking numbers appear as they are.

## Web app

Open `http://127.0.0.1:3000/` after `npm start`. The nav has four views: Overview, Campaigns, Locations and Missed calls.

**How do I use it?** The [user guide](docs/USER_GUIDE.md) walks through each page with annotated screenshots.

- **Locations** lists every office with its calls, answer rate, bookings, booking rate, revenue and the campaign with the highest booking rate there (column "Highest booking rate (20+ calls)"). Each office is compared with all other offices pooled, on answer rate and booking rate; a difference whose gap is unlikely to be chance is flagged, "better" or "worse", with both rates. An office with too few calls reads "Too few calls to compare". If an office is flagged worse, the action links to Missed calls filtered to that office; if none is, the page says no office stands out.
- **Missed calls** shows a heatmap of missed calls by hour, by office or by weekday (office local time), the estimated lost value (marked "est.", with its formula one click away), a call-back list of callers whose latest call went unanswered (25 rows a page, highest value first) and a CSV download of the whole list. It can be filtered to one office.

The URL holds the screen, so a link, a refresh or the back button reproduces it:

| Parameter | Meaning |
| --- | --- |
| `view` | `campaigns`, `locations` or `missed-calls`; absent means Overview |
| `range` | `last7`, `last28` or `all` |
| `start`, `end` | a custom range, `YYYY-MM-DD` |
| `campaign` | the campaign shown in the Campaigns weekly chart |
| `location` | the office Missed calls is filtered to |
| `print` | add `?print` for the one-page print summary |
| `answer` | bare parameter: show the answer panel for the filter in the `f_` parameters |
| `f_office`, `f_campaign` | repeatable; office or campaign ids the answer is limited to |
| `f_unattributed` | `1` adds calls with no campaign to the campaign filter |
| `f_weekday` | repeatable, 0 (Monday) to 6 (Sunday), in the office's local time |
| `f_hour` | repeatable, 0 to 23, in the office's local time |

To open the extended export: on a first run (no `data/calls.db`) `DATA_DIR=data/extended npm start`; on a later run `npm run seed data/extended`, then restart. There, Locations flags only the two planted weak offices ("worse"); the shipped export flags none.

## Ask a question

A box under the nav takes a question in plain English ("Which office misses the most calls on Fridays?"). The model turns it into a fixed filter made of office and campaign names, weekdays, hours and a date range. It never sees calls and never writes a number or a sentence you read. Code checks every value against the loaded data (the same check the URL uses), applies the filter to the calls, and shows the answer page: one line saying how the question was read, one sentence, and a table. Every figure on it comes from code.

- **Needs a key.** Without `ANTHROPIC_API_KEY` the box is hidden and says why; the answer page and the `f_` links still work, because they never call the model.
- **In the URL.** The checked filter goes in the URL (`?answer&view=missed-calls&f_weekday=4&range=last28`), so a refresh or a shared link re-runs only code and costs nothing. The question text is not stored.
- **Views:** `view` picks the grouping: `campaigns` by campaign, `locations` and `missed-calls` by office (`missed-calls` sorts by unanswered calls), `overview` totals only. The page links to the real view with the range kept.
- **Glossary** (fixed in the prompt): weekend = Saturday and Sunday; weekdays = Monday to Friday; morning = 6 to 11; afternoon = 12 to 16; evening = 17 to 20; overnight = 21 to 23 and 0 to 5; business hours = 9 to 16; "9 to 5" and "between 9 and noon" run to the hour before the end. Any other vague phrase ("busy times", "late", "recently") gets "That isn't a question about these calls." Hours are the office's local hours; "Friday" means Friday at the call's office.
- **Limits:** a question is at most 300 characters; each filter list holds at most 50 values. A name that matches no office or campaign, or matches two, rejects the whole question and the message names it.
- **Same cache, guard and log as takeaways.** A repeat question costs nothing; the spend limit is shared; each call is one line in `logs/ai-calls.jsonl` with `purpose: question` (the question and the reply are never logged).
- **Try it by hand:** `npm run ai:try -- --question "Which office misses the most calls on Fridays?"` makes one real call (about $0.0002) and prints the validated query and the cost; the question is not echoed. Like the server, `ai:try` reads the database at `DB_PATH`; with no database yet it reads the CSVs in `DATA_DIR` into memory and creates no file.

### Known limits of the question box

- **The model's reading can be wrong.** The page always prints how the question was read, so a wrong reading is visible; accuracy on real questions is judged by hand with `ai:try`, not by a test.
- **One slice, no comparison.** An answer is about one filter over one range; it shows no change against a previous period.
- **A name hidden in a question can only become a filter.** Anything the model returns outside the fixed shape is refused, and every value is checked before use.
- **Cost:** one cost line per question, about 1.2K input tokens (the name lists).

## Compare any two ranges

By default the comparison is the same number of days just before the selected range. To choose it yourself, use the "Comparison range" dates in the range control and press Compare; "Use previous period" clears it. Changing the selected range also clears it.

- **In the URL.** The second range is `compareStart` and `compareEnd`, next to `start` and `end`, so a link, refresh, back and forward all keep it.
- **Anywhere in the data.** It may be before, after, inside or overlapping the selected range, or the same range. It must lie inside the data; otherwise no change is shown and the page says why. An overlap is allowed, with a note, and call-change alerts are not tested.
- **Another length is compared per day.** Calls, bookings and revenue compare per-day figures and the page says "per day" with both lengths. Answer rate is a rate, so length does not matter. Unique callers are not compared across lengths, because repeat callers count once and the figure does not grow with days. Call-change alerts are not tested either; they need equal lengths.
- **The page names both ranges** ("Comparing ... with ..."), so "was 587" is never ambiguous.
- **Locations and Missed calls** ignore the second range.
- **Known limits:** a very short second range gives a noisy per-day figure; a range that is not whole weeks mixes weekdays unevenly.

## Alerts

A campaign is flagged when its calls jumped or dropped against the previous period by more than the usual variation.

- **Where:** the Campaigns table has a "Calls vs previous" column (change and "was N") and a "Calls jumped" or "Calls dropped" badge on flagged rows. Overview's suggested actions by page gain one extra entry, right after the Campaigns entry, naming the biggest mover and how many campaigns changed. However many campaigns are flagged, there is one entry.
- **The test:** `score = (calls now - calls before) / sqrt(calls now + calls before)`; a campaign is flagged when the score reaches 3 in either direction. A campaign is tested only when its calls across both periods add up to at least 20, so a drop to zero or a jump from zero is caught and a handful of calls is never flagged.
- **Settings:** `ALERT_Z` (3) and `MIN_CALLS_ALERT` (20) in `src/core/thresholds.ts`. 3, as for offices, because about a dozen campaigns are tested at once: at 2.5 some campaign is flagged by luck about 1 time in 7, at 3 about 1 in 30. On the shipped export no campaign is flagged; on the extended export the planted jump and drop are.
- **Needs a full previous period of equal length.** Over "All data", or with a comparison of another length (compared per day, see Compare any two ranges), nothing is tested and the page says why. A comparison that overlaps the selected range is not tested either (the two periods must be independent); the change column still shows.
- **Unattributed is never flagged.** It is a bucket, not a campaign; "Fix attribution" covers it. Its row still shows its change.
- **Known limits:** repeat callers make counts clumpier than the test assumes, so it is somewhat optimistic; a range that is not a whole number of weeks compares unequal weekday mixes; a partly complete first day is noted, not corrected.

### Print summary

A one-page, plain document of the whole app, for paper or PDF.

- **On the page:** the five Overview tiles, then Overview's takeaway and one block for each of Campaigns, Locations and Missed calls. Each block holds that view's action (the alert entry sits under Campaigns) and its takeaway, marked `AI` or `template`. The date range and comparison caveats are printed, and a three-line "est." footnote gives the spend formula, the revenue-per-budget-dollar formula and the missed-call value.
- **How to reach it:** the "Print summary" link in the header, which opens in a new tab so the app stays open in the first, or add `?print` to any URL with the range you want. On the print page, a Print button calls the browser's print and an "Open the app" link goes back to the app.
- **What it keeps:** the range and the comparison. It ignores the campaign and office choice, so it is always company-wide.
- **Print waits for the takeaways.** The Print button stays disabled until the Overview and all four takeaways have loaded or failed, so paper never says "Loading takeaway...". A takeaway that failed leaves its block without one.
- **What it requests:** `/api/overview` and the four `/api/takeaway/:view` calls, with the same query the screen would send, and nothing else (not the Campaigns, Locations or Missed calls views). It shares the AI cache with browsing. With a key, a first open can make up to four calls (each logged as usual); a repeat is four cache hits at $0.
- **One page:** it fits one A4 or Letter page by using small print type, never by dropping caveats, numbers or estimate labels.
- **Known limit:** page fit is checked by eye in print preview, on the shipped and extended exports and on a worst-case range with every caveat. A name far longer than any in the data is wrapped, not cut, and could push the page onto a second page.

### Visual design and motion

- **The look:** evergreen header, sand neutrals, white panels with soft borders and weight-500 headings. The type pairing is IBM Plex Sans for text with IBM Plex Mono for figures and small labels. The accent green marks only what you can act on (links, buttons, the current tab, focus); bars, heat cells and the up and down status colours are a separate blue and red set, kept at least 40 degrees of hue away from the green. Colours, type, spacing and timing are all set in `src/web/styles/tokens.css`; keep raw colours and durations out of other files (no test checks this any more).
- **What moves:** a view change (a short fade and small rise below the range control; the header, tabs and range control stay still), the takeaway line (loading text and sentence swap), the Missed calls heatmap when you switch between By office and By weekday, the five Overview tiles (each counts to its new value and ends on the server's exact text), and the Campaigns weekly chart when you change its campaign.
- **Timing:** every duration is 150 to 300 ms, with one easing curve, set in `tokens.css` (`--motion-*`, `--ease-standard`) and read from there at run time. Animation uses the `motion` package (imported from `motion/react`); the `Reveal` wrapper renders a plain div when motion is off, so nothing can stay half-faded.
- **Reduced motion:** `prefers-reduced-motion: reduce` turns all of it off at once, and the app follows the setting live, without a reload.
- **Print:** the print summary imports no motion code, and print CSS forces faded content to full strength. A running tile count finishes on the server's number when you print. Two limits: printing during the short exit fade of a tab change shows the outgoing view, and printing while the weekly chart bars are growing can show them part-grown.
- **Never animated:** tables and sentences. The numbers and action sentences are the server's text, the same with motion on or off (a test checks this on both real exports).
- **Known limits:** the bars use Recharts' own animation, with the nearest keyword easing (`ease-out`) rather than the token's curve. Changing the date range grows the chart in instead of morphing it, because old numbers are never shown under a new range.

## AI takeaways

Each view shows one short takeaway line under the date control, marked `AI` or `template`. The template sentence is built in code from the view's computed facts. With `ANTHROPIC_API_KEY` set, Claude Haiku 5.5 writes the sentence instead, using `{placeholders}` for every number and name; code checks the text (no digits, no invented names) and fills in the values. If the check fails (after one retry, see below), the call fails, the budget is reached or there is no key, the template sentence is shown, and nothing else about the app changes. The views never wait on it.

- **Off by default:** leave `ANTHROPIC_API_KEY` empty in `.env`.
- **Spend guard:** `AI_SPEND_LIMIT_USD` (default 5). Past it the app stops calling the model and shows template text.
- **Cache:** results are kept in `.cache/ai-takeaways.json`, so a repeat costs nothing.
- **Call log:** one line per call, cache hits included at zero cost, in `logs/ai-calls.jsonl` (time, model, view, tokens, cost). Both folders are gitignored.
- **Try it by hand:** `npm run ai:try -- all` makes real calls (about $0.0005 a view); run it twice to see the cache hit.

### Known limits of AI takeaways

- **One process at a time.** Each running copy of the app (and `npm run ai:try`) reads the call log once at start-up and then counts only its own spend, so two copies running at once each get the full limit. The log and cache paths are relative to the folder you start from (like `DATA_DIR`): start from the project folder, or spend will read as $0.
- **Docker and `npm start` do not share state.** Docker keeps its call log and cache on the volumes `ai-logs` and `ai-cache`; `npm start` uses `./logs` and `./.cache`. Each has its own spend cap (using both doubles the effective cap), and a takeaway paid for in one is paid for again in the other.
- **The checker cannot see all meaning.** It checks that every number and name is a placeholder from the fact sheet; it does not check that the sentence around them is right, so a model could write "fell" for a rise, or put the best campaign's name where the worst belongs. The model also sees names cut to 80 characters, so it could write that cut-off form.
- **A timeout logs its worst case; an API error logs $0.** An aborted call may still be billed and returns no token count, so a timeout is logged at the most it could cost (0 tokens, the worst-case cost); a failed request logs $0.
- **Names are data, not trusted.** Campaign and office names reach the prompt, shortened and inside a JSON block; the checker is the hard limit, not the prompt.
- **A rejected takeaway is retried once.** When the checker rejects the text, the model is asked once more with the checker's reason; if that also fails, the template is shown for the rest of the session. This costs one extra call, logged on its own line, only when the first is rejected; it is skipped if it could pass the spend limit. Timeouts, API errors, refusals and malformed replies are not retried.
