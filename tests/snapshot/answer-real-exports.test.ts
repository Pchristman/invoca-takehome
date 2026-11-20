import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAnswer } from '../../src/core/answer';
import type { AnswerFilter } from '../../src/core/answer';
import { cleanExport } from '../../src/core/clean';
import { dataSpan, resolveRange } from '../../src/core/ranges';
import type { CallStore } from '../../src/core/types';
import { buildOverview } from '../../src/core/views';
import { readExportFromDir } from '../../src/node/readDataDir';
import { createApp } from '../../src/server/app';
import { expectAllFinite } from '../core/views/fixtures';

const ORIGINAL_DIR = join(__dirname, '..', 'fixtures', 'original-export');
const EXTENDED_DIR = join(__dirname, '..', '..', 'data', 'extended');

// Observed on the two committed exports, recorded not derived. If a change moves one of these, look at why.
const OBSERVED = {
  original: { fridayUnanswered: 194, topOffice: 'Bayside Office', topUnanswered: 37 },
  // Pattern A (DECISIONS 2026-11-19) adds 160 unanswered Canyon calls on weekdays 09:00-11:59 local; the original's own 21 and 5 clones bring it to 186.
  extended: { weekdayMorningTop: 'Canyon Office', weekdayMorningUnanswered: 186 },
};

function load(dir: string) {
  const store: CallStore = cleanExport(readExportFromDir(dir));
  const result = resolveRange(dataSpan(store.calls)!, { kind: 'preset', preset: 'all' });
  if (!result.ok) throw new Error(result.error.message);
  return { store, all: result.range };
}

const open: AnswerFilter = {
  view: 'missed-calls',
  officeIds: [],
  campaignIds: [],
  includeUnattributed: false,
  weekdays: [],
  hours: [],
};

/** Unanswered calls per office name, counted with a plain loop over the cleaned calls. */
function unansweredByOffice(store: CallStore, weekdays: number[], hours: number[]): Map<string, number> {
  const names = new Map(store.locations.map((l) => [l.id, l.name]));
  const counts = new Map<string, number>();
  for (const call of store.calls) {
    if (call.answered) continue;
    if (weekdays.length > 0 && !weekdays.includes(call.localWeekday)) continue;
    if (hours.length > 0 && !hours.includes(call.localHour)) continue;
    const name = names.get(call.locationId)!;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

const top = (counts: Map<string, number>): [string, number] =>
  [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;

describe('answer on the original export', () => {
  const { store, all } = load(ORIGINAL_DIR);
  const view = buildAnswer(store, all, { ...open, weekdays: [4] });
  const counts = unansweredByOffice(store, [4], []);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  it('Friday unanswered per office sum to the independent count, and the top office agrees', () => {
    expect(view.rows.reduce((sum, r) => sum + r.unanswered, 0)).toBe(total);
    expect(view.totals.unanswered).toBe(total);
    expect(total).toBe(OBSERVED.original.fridayUnanswered);
    const [name, n] = top(counts);
    expect(view.rows[0]!.name).toBe(name);
    expect(view.rows[0]!.unanswered).toBe(n);
    expect([name, n]).toEqual([OBSERVED.original.topOffice, OBSERVED.original.topUnanswered]);
    expectAllFinite(view);
  });
});

describe('answer on the extended export', () => {
  const { store, all } = load(EXTENDED_DIR);
  const weekdays = [0, 1, 2, 3, 4];
  const hours = [9, 10, 11];
  const view = buildAnswer(store, all, { ...open, weekdays, hours });
  const counts = unansweredByOffice(store, weekdays, hours);

  it('weekday mornings: Canyon Office tops the list with the planted 160 unanswered', () => {
    const [name, n] = top(counts);
    expect([name, n]).toEqual([OBSERVED.extended.weekdayMorningTop, OBSERVED.extended.weekdayMorningUnanswered]);
    expect(view.rows[0]!.name).toBe(name);
    expect(view.rows[0]!.unanswered).toBe(n);
    expect(view.rows[0]!.unanswered).toBeGreaterThanOrEqual(160) // the planted 160 are all there;
    expectAllFinite(view);
  });

  it('Canyon (Phoenix, no daylight saving) has local weekday and hour fields inside the pattern', () => {
    const canyon = store.locations.find((l) => l.name === 'Canyon Office')!;
    expect(canyon.timezone).toBe('America/Phoenix');
    const missed = store.calls.filter(
      (c) => c.locationId === canyon.id && !c.answered && weekdays.includes(c.localWeekday) && hours.includes(c.localHour),
    );
    expect(missed.length).toBe(OBSERVED.extended.weekdayMorningUnanswered);
    for (const c of missed) {
      expect(c.localWeekday).toBeLessThanOrEqual(4);
      expect(c.localHour).toBeGreaterThanOrEqual(9);
      expect(c.localHour).toBeLessThanOrEqual(11);
    }
  });
});

describe('the planted pattern is the extended export addition', () => {
  it('the original has 21 such Canyon calls; the extended 186 is those, the 160 planted and 5 from week-shifted clones', () => {
    const original = unansweredByOffice(load(ORIGINAL_DIR).store, [0, 1, 2, 3, 4], [9, 10, 11]);
    expect(original.get('Canyon Office')).toBe(21);
    expect(OBSERVED.extended.weekdayMorningUnanswered - 21).toBeGreaterThanOrEqual(160);
  });
});

describe.each([
  ['original', ORIGINAL_DIR],
  ['extended', EXTENDED_DIR],
])('a filter naming everything matches the Overview tiles: %s', (_name, dir) => {
  it('calls, bookings and revenue agree', () => {
    const { store, all } = load(dir);
    const everything = buildAnswer(store, all, {
      ...open,
      view: 'overview',
      officeIds: store.locations.map((l) => l.id),
      campaignIds: store.campaigns.map((c) => c.id),
      includeUnattributed: true,
    });
    const tiles = buildOverview(store, all).tiles;
    expect(everything.totals.calls).toBe(tiles.calls.current);
    expect(everything.totals.bookings).toBe(tiles.bookings.current);
    expect(everything.totals.revenueUsd).toBe(tiles.revenueUsd.current);
    expect(everything.totals.calls).toBe(store.calls.length);
  });
});

describe.each([
  ['original', ORIGINAL_DIR],
  ['extended', EXTENDED_DIR],
])('GET /api/answer on the %s export', (_name, dir) => {
  const { store } = load(dir);
  const app = createApp(store);
  const office = store.locations[0]!.id;
  const campaign = store.campaigns[0]!.id;
  const queries = [
    'range=all',
    `range=all&f_office=${office}`,
    `range=all&view=campaigns&f_campaign=${campaign}`,
    'range=all&view=locations&f_weekday=5&f_weekday=6',
    'range=all&view=campaigns&f_unattributed=1',
  ];

  it.each(queries)('answers 200 for %s', async (query) => {
    const response = await app.request(`/api/answer?${query}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { totals: { calls: number }; sentence: string };
    expect(body.totals.calls).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain('NaN');
  });
});
