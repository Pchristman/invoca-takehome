# Inbound Call Performance

A small local web product that helps a marketing manager track inbound call performance and act on it. Every number comes from code; AI is an optional add-on and the app works fully without it.

## Commands

| Command | Status |
| --- | --- |
| `npm install` | available |
| `npm test` | available (vitest) |
| `npm run typecheck` | available |
| `npm start` | not built yet (Phase 6/7) |
| `npm run dev` | not built yet (Phase 6/7) |

Copy `.env.example` to `.env` to configure. Never commit `.env`.

## Data

The app reads three CSVs: `calls.csv`, `campaigns.csv` and `locations.csv`. They come from `DATA_DIR` (set in `.env`), or the repo root when it is empty. Columns are matched by header name, so extra or reordered columns are fine; a missing required column stops startup with a message naming the file and column.

The loader returns every `calls.csv` row as either a typed call or a bad row, with bad rows counted by reason (bad timestamp, unknown location, unknown campaign, and so on). Bad rows never crash the app. Removing duplicate calls and everything after that comes in later phases.
