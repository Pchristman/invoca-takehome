import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { resolveComparison } from '../../src/core/comparison';
import { tally } from '../../src/core/metrics';
import { buildMissedValueRates, estimateMissedCallValue } from '../../src/core/missedValue';
import { dataSpan, resolveRange } from '../../src/core/ranges';
import type { RangeSpec } from '../../src/core/ranges';
import { callsPerWeek } from '../../src/core/weeks';
import { readExportFromDir } from '../../src/node/readDataDir';
import { goodRow, loadFixture } from './helpers';

// An export that shares no names, zones or dates with the shipped one.
const CAMPAIGNS = 'campaign_id,name,channel,daily_budget_usd\nzz_c1,Quokka Promo,referral,40\nzz_c2,Wombat Weekend,paid_search,0\n';
const LOCATIONS =
  'location_id,name,timezone\nzz_kol,Kolkata Hub,Asia/Kolkata\nzz_akl,Auckland Annex,Pacific/Auckland\nzz_lon,London Desk,Europe/London\n';

const row = (over: Record<string, string>) =>
  goodRow({ campaign_id: 'zz_c1', marketing_channel: 'referral', location_id: 'zz_kol', ...over });

describe('cleaning a different export', () => {
  const store = cleanExport(
    loadFixture(
      [
        // a duplicate: the first row has no outcome yet, the later one books it
        row({ call_id: 'k1', started_at: '2031-05-10T20:00:00Z', outcome: '', revenue_usd: '', updated_at: '2031-05-10T21:00:00Z' }),
        row({ call_id: 'k1', started_at: '2031-05-10T20:00:00Z', outcome: 'booked', revenue_usd: '300', updated_at: '2031-05-12T21:00:00Z' }),
        // unattributed, in London summer time (UTC+1): 23:30 UTC is 00:30 the next day
        row({ call_id: 'l1', campaign_id: '', marketing_channel: 'direct', location_id: 'zz_lon', started_at: '2031-05-10T23:30:00Z', answered: 'false', outcome: 'missed', revenue_usd: '' }),
        // pending
        row({ call_id: 'a1', campaign_id: 'zz_c2', marketing_channel: 'paid_search', location_id: 'zz_akl', started_at: '2031-05-10T20:00:00Z', outcome: '', revenue_usd: '' }),
      ],
      CAMPAIGNS,
      LOCATIONS,
    ),
  );

  test('every call is kept and counted', () => {
    expect(store.calls.map((c) => c.callId)).toEqual(['k1', 'l1', 'a1']);
    expect(store.dataNotes.badCalls).toBe(0);
    expect(store.dataNotes.duplicateRowsCollapsed).toBe(1);
  });

  test('revenue, attribution and pending work on other names', () => {
    expect(store.calls.reduce((sum, c) => sum + c.revenueUsd, 0)).toBe(300);
    expect(store.dataNotes.unattributedCalls).toBe(1);
    expect(store.dataNotes.pendingCalls).toBe(1);
    expect(store.dataNotes.outcomeLagDays).toBe(3);
  });

  test('local dates follow each office zone, including a half-hour offset', () => {
    const byId = Object.fromEntries(store.calls.map((c) => [c.callId, c]));
    expect(byId.k1).toMatchObject({ localDate: '2031-05-11', localHour: 1 }); // 20:00 UTC + 5:30
    expect(byId.l1).toMatchObject({ localDate: '2031-05-11', localHour: 0 });
    expect(byId.a1).toMatchObject({ localDate: '2031-05-11', localHour: 8 }); // 20:00 UTC + 12:00
  });
});

describe('ranges and metrics on a different export', () => {
  // Calls in zones and on dates unlike the shipped export's: Mon 5th, Wed 7th, Mon 12th, Sun 18th.
  const days = ['2031-05-05', '2031-05-07', '2031-05-12', '2031-05-18'];
  const store = cleanExport(
    loadFixture(
      days.flatMap((day, i) => [
        row({ call_id: `p${i}`, caller_number_hash: `hp${i}`, started_at: `${day}T12:00:00Z`, outcome: 'booked', revenue_usd: '100' }),
        row({ call_id: `q${i}`, caller_number_hash: `hq${i}`, started_at: `${day}T13:00:00Z`, location_id: 'zz_lon', answered: 'false', outcome: 'missed', revenue_usd: '' }),
      ]),
      CAMPAIGNS,
      LOCATIONS,
    ),
  );
  const span = dataSpan(store.calls)!;

  const resolve = (spec: RangeSpec) => {
    const result = resolveRange(span, spec);
    if (!result.ok) throw new Error(result.error.message);
    return result.range;
  };

  test('the span and presets come from the data, not from constants', () => {
    expect(span).toEqual({ start: '2031-05-05', end: '2031-05-18' });
    expect(resolve({ kind: 'preset', preset: 'all' })).toEqual({ ...span, days: 14, clamped: false });
    expect(resolve({ kind: 'preset', preset: 'last7' })).toEqual({ start: '2031-05-12', end: '2031-05-18', days: 7, clamped: false });
  });

  test('the comparison is the seven days before', () => {
    const result = resolveComparison(span, resolve({ kind: 'preset', preset: 'last7' }));
    expect(result.ok && result.comparison).toMatchObject({
      previous: { start: '2031-05-05', end: '2031-05-11', days: 7 },
      available: true,
    });
  });

  test('totals, weeks and missed-call value work on other names', () => {
    expect(tally(store.calls)).toEqual({ calls: 8, uniqueCallers: 8, answered: 4, bookings: 4, revenueUsd: 400 });

    const weeks = callsPerWeek(store.calls, span, span);
    expect(weeks.map((w) => [w.weekStart, w.calls, w.partial])).toEqual([
      ['2031-05-05', 4, false],
      ['2031-05-12', 4, false],
    ]);

    const value = estimateMissedCallValue(buildMissedValueRates(store.calls), { campaignId: 'zz_c1', channel: 'referral' });
    expect(value.valueUsd).toBe(100);
    expect(value.source).toBe('overall'); // only 4 answered calls, below the minimum for the campaign's own rate
  });
});

describe('nothing in src/ is tied to the shipped dataset', () => {
  const srcDir = join(__dirname, '..', '..', 'src');
  const sourceFiles = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ file: f, text: readFileSync(join(srcDir, f), 'utf8') }));

  // Every name, id and zone in the shipped export, plus the tracking-number prefix.
  const shipped = readExportFromDir(join(__dirname, '..', 'fixtures', 'original-export'));
  const needles = [
    ...shipped.campaigns.flatMap((c) => [c.id, c.name]),
    ...shipped.locations.flatMap((l) => [l.id, l.name, l.timezone]),
    '+1-555',
  ];

  test('the shipped export gave us names to look for', () => {
    expect(needles.length).toBeGreaterThan(30);
    expect(sourceFiles.length).toBeGreaterThan(5);
  });

  test.each([...new Set(needles)])('no source file contains "%s"', (needle) => {
    expect(sourceFiles.filter((f) => f.text.includes(needle)).map((f) => f.file)).toEqual([]);
  });

  test('no source file contains a literal year-month such as 2026-10', () => {
    expect(sourceFiles.filter((f) => /\b20\d\d-\d\d/.test(f.text)).map((f) => f.file)).toEqual([]);
  });
});
