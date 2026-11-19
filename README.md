# Inbound Call Performance

A small local web product that helps a marketing manager track inbound call performance and act on it. Every number comes from code; AI is an optional add-on and the app works fully without it.

## Commands

| Command | Status |
| --- | --- |
| `npm install` | available |
| `npm test` | available (vitest) |
| `npm run typecheck` | available |
| `npm run generate:extended` | available; rewrites `data/extended/` from the shipped export and a fixed seed |
| `npm start` | not built yet (Phase 6/7) |
| `npm run dev` | not built yet (Phase 6/7) |

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
