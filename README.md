# Inbound Call Performance

A small local web product that helps a marketing manager track inbound call performance and act on it. Every number comes from code; AI is an optional add-on and the app works fully without it.

## Commands

| Command | Status |
| --- | --- |
| `npm install` | available |
| `npm test` | available (vitest) |
| `npm run typecheck` | available |
| `npm run generate:extended` | available; rewrites `data/extended/` from the shipped export and a fixed seed |
| `npm run build` | available; builds the web app into `dist/` |
| `npm start` | available; builds the web app, then serves it and the JSON API at `http://127.0.0.1:3000`; reads `.env` (only this command does) (`HOST`, default 127.0.0.1; `PORT`, default 3000; `DATA_DIR`) |
| `docker compose up --build` | available; builds one image and serves the app at `http://localhost:3000`; see Docker below |
| `npm run test:docker` | available; real Docker checks (needs Docker running; builds the image, starts containers, makes no real API call) |
| `npm run ai:try -- <view|all>` | available; makes REAL API calls (needs a key); see AI takeaways below |
| `npm run dev` | available; the server (restarting on change) and Vite with hot reload together, `/api` proxied to the server; the page is at the address Vite prints on start |

Copy `.env.example` to `.env` to configure. Never commit `.env`.

## Docker

One command: `docker compose up --build`, then open `http://localhost:3000`. A `.env` is optional: with none, AI is off and every view uses template text. If a start fails, plain `docker compose up` may still exit 0, so read `docker compose logs`.

- **Another host port:** `PORT=3001 docker compose up --build` (PowerShell: `$env:PORT=3001; docker compose up --build`), or set `PORT` in `.env`. `PORT` is only the host side; inside the container the server is always on 3000.
- **Another export:** `DATA_DIR=data/extended docker compose up --build`. `DATA_DIR` chooses the folder mounted read-only at `/data`; use forward slashes on Windows. A mistyped folder is created empty by Docker, and the app then prints `Cannot start: ...` (see `docker compose logs`).
- **The default mount shows the container the whole repo folder, read-only.** The app reads only the three CSV files.
- **Not on the network:** the server listens on all interfaces inside the container, and Compose publishes it only on your machine's `127.0.0.1`, so the callback list is not exposed. Never change the port line in `docker-compose.yml` to `0.0.0.0`.
- **New data:** run `docker compose restart`. The data is read once at start, like `npm start`.
- **Separate from `npm start`:** Docker keeps its AI call log and cache on the volumes `ai-logs` and `ai-cache`, while `npm start` uses `./logs` and `./.cache`. Each has its own spend cap (using both doubles the effective cap), and a takeaway paid for in one is paid for again in the other.
- **Start-up line:** inside the container it says `http://localhost:3000` even when `PORT=3001` publishes it on 3001; the host port is the `PORT` you set.
- **Exported key:** your shell's exported `ANTHROPIC_API_KEY` beats `.env`. To run with AI off, unset it first (PowerShell: `Remove-Item Env:ANTHROPIC_API_KEY`), or real API calls will be made.
- **AI cache and call log** live on the volumes `ai-cache` and `ai-logs`. `docker compose down` keeps them. **`docker compose down -v` deletes the call log, so the spend guard counts from $0 again.** To read the log: `docker compose run --rm app cat logs/ai-calls.jsonl`.
- **The key** comes from `.env` at run time and is never in the image. A shell `ANTHROPIC_API_KEY` wins over `.env`, as with `npm start`.
- **`HOST` warning:** some shells (zsh) set `HOST` to the machine name. If it is exported (the shell beats `.env`), `npm start` listens on that address, which may be reachable from other devices on your network. When the bound address is not loopback, `npm start` prints a `Listening on a non-loopback address (...)` line; if you see it and did not mean it, unset `HOST` or set `HOST=127.0.0.1`. Inside Docker the image sets its own `HOST`, so this does not matter there.

## Data

The app reads three CSVs: `calls.csv`, `campaigns.csv` and `locations.csv`. They come from the folder named by `DATA_DIR` (set in the shell or in `.env`; the shell wins), or the current directory when it is unset or blank. A relative `DATA_DIR` is relative to the current directory. Columns are matched by header name, so extra or reordered columns are fine; a missing required column stops startup with a message naming the file and column.

The loader returns every `calls.csv` row as either a typed call or a bad row, with bad rows counted by reason (bad timestamp, unknown location, unknown campaign, and so on). Bad rows never crash the app. Removing duplicate calls and everything after that comes in later phases.

### Extended export (synthetic)

`data/extended/` holds a larger export that **contains synthetic rows**. Its `calls.csv` is the shipped file, unchanged, followed by 1,500 invented rows (call ids start `x_`); `campaigns.csv` and `locations.csv` are copies. It plants four patterns the shipped data lacks, so the Locations and Campaigns views have something to find:

- a low answer rate at Canyon Office on weekday mornings (local time);
- a low booking rate at Riverside Office, with a normal answer rate;
- a surge in one campaign's calls over the last 28 days;
- a fade in another campaign's calls over the 28 days before that.

It also carries the same mess as the original: duplicate rows, unattributed calls and pending calls. It has no bad rows.

Things to know when reading it:

- Locations flags four offices on this data, not two: the two planted ones (worse) and two ordinary offices (loc_04 on booking rate, loc_08 on answer rate, both "better"). Each office is compared with all the others pooled, and the planted offices pull that pool down, so those two appear as a side effect.
- 1,400 invented calls add about 565 distinct callers (2,040 to 2,605); copies reuse real callers at the same share the shipped data shows, so repeat callers are still present.
- Its cmp_06 has 33 bookings against 27 in the shipped export: the fade plants calls with no bookings, but the other synthetic calls copy from every campaign.

The default stays the shipped export. To use the extended one, set `DATA_DIR=data/extended`. To regenerate it (same seed, same bytes), run `npm run generate:extended`; the script and its settings are in `scripts/generate-extended.ts`.

## API

`npm start` loads the export once and serves JSON on **127.0.0.1 only** (the callback list carries caller hashes). A missing folder, file or column, a bad `PORT` or a busy port prints one `Cannot start: ...` line and exits 1. Every route is GET only.

| Route | Query parameters | 200 body |
| --- | --- | --- |
| `/api/meta` | none | data span, campaign and office lists, presets, skipped rows, load notes |
| `/api/overview` | range, compare | overview view |
| `/api/campaigns` | range, compare, `campaign` | campaigns view |
| `/api/locations` | range, compare | locations view |
| `/api/missed-calls` | range, compare, `location` | missed-calls view |
| `/api/missed-calls/callbacks.csv` | range, compare, `location` | CSV file |
| `/api/takeaway/:view` | as that view | template takeaway text |
| `/api/data-notes` | none | data notes (always available) |

- **Range:** `range=last7|last28|all`, or `start=YYYY-MM-DD&end=YYYY-MM-DD`. Neither given means `last28`.
- **Compare (optional):** `compareStart` and `compareEnd` together.
- Parameters a route does not use are ignored.
- **Errors** are JSON: `{ "error": { "code", "message", "field"? } }`. Status 400 for a bad parameter or unknown campaign or office, 409 `no_data` for an empty export, 404 `not_found`, 500 `internal` (no details).
- **CSV:** UTF-8 with a byte-order mark and CRLF line ends, so a spreadsheet opens non-ASCII names correctly. A cell starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'` so a spreadsheet cannot run it as a formula; tracking numbers therefore appear as `'+1-...`.

## Web app

Open `http://127.0.0.1:3000/` after `npm start`. The nav has four views: Overview, Campaigns, Locations and Missed calls.

- **Locations** lists every office with its calls, answer rate, bookings, booking rate, revenue and best campaign there. Each office is compared with all other offices pooled, on answer rate and booking rate; a difference that chance does not explain is flagged, "better" or "worse", with both rates. An office with too few calls reads "Too few calls to compare". If an office is flagged worse, the action links to Missed calls filtered to that office; if none is, the page says no office stands out.
- **Missed calls** shows a heatmap of missed calls by hour, by office or by weekday (office local time), the estimated lost value (marked "est.", with its formula one click away), a call-back list of callers who never got through (25 rows a page, highest value first) and a CSV download of the whole list. It can be filtered to one office.

The CSV starts tracking numbers with an apostrophe, so a spreadsheet keeps them as text.

The URL holds the screen, so a link, a refresh or the back button reproduces it:

| Parameter | Meaning |
| --- | --- |
| `view` | `campaigns`, `locations` or `missed-calls`; absent means Overview |
| `range` | `last7`, `last28` or `all` |
| `start`, `end` | a custom range, `YYYY-MM-DD` |
| `campaign` | the campaign shown in the Campaigns weekly chart |
| `location` | the office Missed calls is filtered to |
| `dev` | add `?dev` to the URL to open the Data notes panel |

To open the extended export: `DATA_DIR=data/extended npm start`. There, Locations flags four offices, two of them "better" than the rest, because each office is tested against all others pooled and the two planted weak offices pull that pool down.

## Alerts

A campaign is flagged when its calls jumped or dropped against the previous period by more than chance explains.

- **Where:** the Campaigns table has a "Calls vs previous" column (change and "was N") and a "Calls jumped" or "Calls dropped" badge on flagged rows. Overview's top actions gain one extra entry, right after the Campaigns entry, naming the biggest mover and how many campaigns changed. However many campaigns are flagged, there is one entry.
- **The test:** `score = (calls now - calls before) / sqrt(calls now + calls before)`; a campaign is flagged when the score reaches 3 in either direction. A campaign is tested only when its calls across both periods add up to at least 20, so a drop to zero or a jump from zero is caught and a handful of calls is never flagged.
- **Settings:** `ALERT_Z` (3) and `MIN_CALLS_ALERT` (20) in `src/core/thresholds.ts`. 3 rather than the 2.5 used for offices because about a dozen campaigns are tested at once: at 2.5 some campaign is flagged by luck about 1 time in 7, at 3 about 1 in 30. On the shipped export no campaign is flagged; on the extended export the planted jump and drop are.
- **Needs a full, equal-length previous period.** Over "All data", or with a custom comparison of another length, nothing is tested and the page says why.
- **Unattributed is never flagged.** It is a bucket, not a campaign; "Fix attribution" covers it. Its row still shows its change.
- **Known limits:** repeat callers make counts clumpier than the test assumes, so it is somewhat optimistic; a range that is not a whole number of weeks compares unequal weekday mixes; a partly complete first or last day is noted, not corrected.

## AI takeaways

Each view shows one short takeaway line under the date control, marked `AI` or `template`. The template sentence is built in code from the view's computed facts. With `ANTHROPIC_API_KEY` set, Claude Haiku 5.5 writes the sentence instead, using `{placeholders}` for every number and name; code checks the text (no digits, no invented names) and fills in the values. If the check fails, the call fails, the budget is reached or there is no key, the template sentence is shown, and nothing else about the app changes. The views never wait on it.

- **Off by default:** leave `ANTHROPIC_API_KEY` empty in `.env`. Add `?dev` to the URL to see why a takeaway is a template.
- **Spend guard:** `AI_SPEND_LIMIT_USD` (default 5). Past it the app stops calling the model and shows template text.
- **Cache:** results are kept in `.cache/ai-takeaways.json`, so a repeat costs nothing.
- **Call log:** one line per call, cache hits included at zero cost, in `logs/ai-calls.jsonl` (time, model, view, tokens, cost). Both folders are gitignored.
- **Try it by hand:** `npm run ai:try -- all` makes real calls (about $0.0005 a view); run it twice to see the cache hit.

### Known limits of AI takeaways

- **One process at a time.** Each running copy of the app (and `npm run ai:try`) reads the call log once at start and counts only its own calls after that, so two running at once each get the full spend limit. The log and cache paths are relative to the folder you start from (like `DATA_DIR`): start from the project folder, or spend will read as $0.
- **Docker and `npm start` do not share state.** Docker keeps its call log and cache on the volumes `ai-logs` and `ai-cache`; `npm start` uses `./logs` and `./.cache`. Each has its own spend cap (using both doubles the effective cap), and a takeaway paid for in one is paid for again in the other.
- **The checker cannot see meaning.** It stops invented numbers and names, but not valid placeholders in the wrong place ("{worst.name} is the strongest"), and the model sees names cut to 80 characters, so it could write that cut-off form.
- **Failed calls log $0.** A timeout or API error returns no token count, so it is logged at $0 and the real bill may be a little higher; the $5 default limit sits far below the $250 cap.
- **Names are data, not trusted.** Campaign and office names reach the prompt, shortened and inside a JSON block; the checker is the hard limit, not the prompt.
