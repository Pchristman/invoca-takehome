import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { resolveRange } from '../../src/core/ranges';
import type { DateRange } from '../../src/core/ranges';
import type { CallStore } from '../../src/core/types';
import { readExportFromDir } from '../../src/node/readDataDir';
import { buildCampaigns, buildLocations, buildMissedCalls, buildOverview } from '../../src/core/views';
import { expectAllFinite } from '../core/views/fixtures';

// Observed on the two real exports, recorded not derived. If a change moves one of these, look at why.
// Selected range Oct 2 to Oct 29 (28 days) against Sep 8 to Sep 14 (7 days); changes are per day.
const SPAN = { start: '2026-08-31', end: '2026-10-29' };
const LONG: DateRange = { start: '2026-10-02', end: '2026-10-29' };
const SHORT: DateRange = { start: '2026-09-08', end: '2026-09-14' };

const OBSERVED = {
  shipped: {
    calls: { now: 2379, before: 587, change: 1.32 },
    bookings: { now: 578, before: 154, change: -6.169 },
    revenue: { now: 210236, before: 52053, change: 0.972 },
    callers: 1317,
    swappedCallsChange: -1.303,
  },
  extended: {
    calls: { now: 3030, before: 751, change: 0.866 },
    bookings: { now: 729, before: 184, change: -0.951 },
    revenue: { now: 268874, before: 62817, change: 7.007 },
    callers: 1640,
  },
};

function resolved(store: CallStore, range: DateRange) {
  const r = resolveRange(SPAN, { kind: 'custom', start: range.start, end: range.end });
  if (!r.ok) throw new Error(r.error.message);
  return r.range;
}

const hasChangeAction = (actions: { kind: string }[]) => actions.some((a) => a.kind === 'review_call_changes');

function expectPercent(change: { kind: string; value?: number }, expected: number) {
  expect(change.kind).toBe('percent');
  expect(change.value).toBeCloseTo(expected, 2);
}

describe.each([
  ['shipped', join(__dirname, '..', 'fixtures', 'original-export'), OBSERVED.shipped],
  ['extended', join(__dirname, '..', '..', 'data', 'extended'), OBSERVED.extended],
] as const)('a 28-day range against a 7-day range on the %s export', (_name, dir, seen) => {
  const store = cleanExport(readExportFromDir(dir));
  const range = resolved(store, LONG);
  const overview = buildOverview(store, range, SHORT);
  const campaigns = buildCampaigns(store, range, SHORT);

  it('compares calls, bookings and revenue per day', () => {
    expect([overview.tiles.calls.current, overview.tiles.calls.previous]).toEqual([seen.calls.now, seen.calls.before]);
    expectPercent(overview.tiles.calls.change, seen.calls.change);
    expect([overview.tiles.bookings.current, overview.tiles.bookings.previous]).toEqual([seen.bookings.now, seen.bookings.before]);
    expectPercent(overview.tiles.bookings.change, seen.bookings.change);
    expect([overview.tiles.revenueUsd.current, overview.tiles.revenueUsd.previous]).toEqual([seen.revenue.now, seen.revenue.before]);
    expectPercent(overview.tiles.revenueUsd.change, seen.revenue.change);
  });

  it('does not compare unique callers across lengths', () => {
    expect(overview.tiles.uniqueCallers.current).toBe(seen.callers);
    expect(overview.tiles.uniqueCallers.previous).toBeNull();
    expect(overview.tiles.uniqueCallers.change).toEqual({ kind: 'none' });
  });

  it('says so in the notes, withholds alerts and keeps three top actions', () => {
    expect(overview.notes.comparison).toMatchObject({ available: true, perDay: true, currentDays: 28, previousDays: 7 });
    expect(campaigns.notes.comparison).toMatchObject({ perDay: true, currentDays: 28, previousDays: 7 });
    expect(campaigns.alerts.checked).toBe(false);
    expect(hasChangeAction(campaigns.actions)).toBe(false);
    expect(overview.topActions).toHaveLength(3);
    expectAllFinite(overview, 'overview');
    expectAllFinite(campaigns, 'campaigns');
  });

  it('a comparison wholly inside the selected range overlaps, is per day and has no alerts', () => {
    const inside: DateRange = { start: '2026-10-02', end: '2026-10-08' };
    const view = buildCampaigns(store, range, inside);
    expect(view.notes.comparison).toMatchObject({ available: true, overlaps: true, perDay: true });
    expect(view.alerts.checked).toBe(false);
    expect(hasChangeAction(view.actions)).toBe(false);
    expectAllFinite(view, 'inside');
  });

  it('Locations and Missed calls ignore the second range', () => {
    const { notes: a, ...locWith } = buildLocations(store, range, SHORT);
    const { notes: b, ...locWithout } = buildLocations(store, range);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(locWith).toEqual(locWithout);
    const { notes: c, ...missedWith } = buildMissedCalls(store, range, SHORT);
    const { notes: d, ...missedWithout } = buildMissedCalls(store, range);
    expect(c).toBeDefined();
    expect(d).toBeDefined();
    expect(missedWith).toEqual(missedWithout);
  });
});

describe('the ranges swapped on the shipped export', () => {
  const store = cleanExport(readExportFromDir(join(__dirname, '..', 'fixtures', 'original-export')));
  const view = buildOverview(store, resolved(store, SHORT), LONG);

  it('reads the other way and the short range is not clamped', () => {
    expectPercent(view.tiles.calls.change, OBSERVED.shipped.swappedCallsChange);
    expect(view.range).toMatchObject({ start: SHORT.start, end: SHORT.end, days: 7, clamped: false });
    expect(view.notes.comparison).toMatchObject({ available: true, perDay: true, currentDays: 7, previousDays: 28 });
    expectAllFinite(view);
  });

  it('the swapped ranges are per day, so Campaigns tests nothing and flags nothing', () => {
    const campaigns = buildCampaigns(store, resolved(store, SHORT), LONG);
    expect(campaigns.alerts).toMatchObject({ checked: false, flagged: 0 });
    expect(campaigns.rows.every((row) => row.alert === null)).toBe(true);
    expect(hasChangeAction(campaigns.actions)).toBe(false);
  });
});
