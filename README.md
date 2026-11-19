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
| `npm start` | available; builds the web app, then serves it and the JSON API at `http://127.0.0.1:3000`; reads `.env` (only this command does) (`PORT`, default 3000; `DATA_DIR`) |
| `npm run dev` | available; the server (restarting on change) and Vite with hot reload together, `/api` proxied to the server; the page is at the address Vite prints on start |

Copy `.env.example` to `.env` to configure. Never commit `.env`.

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

Open `http://127.0.0.1:3000/` after `npm start`. The nav has four views: Overview, Campaigns, Locations and Missed calls. Locations and Missed calls show "Not built yet" for now (Phase 8).

The URL holds the screen, so a link, a refresh or the back button reproduces it:

| Parameter | Meaning |
| --- | --- |
| `view` | `campaigns`, `locations` or `missed-calls`; absent means Overview |
| `range` | `last7`, `last28` or `all` |
| `start`, `end` | a custom range, `YYYY-MM-DD` |
| `campaign` | the campaign shown in the Campaigns weekly chart |
| `dev` | add `?dev` to the URL to open the Data notes panel |

To open the extended export: `DATA_DIR=data/extended npm start`.
