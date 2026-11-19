import { describe, expect, test } from 'vitest';
import { buildMissedValueRates } from '../../../src/core/missedValue';
import { buildCallbackList } from '../../../src/core/views/callbacks';
import type { CleanCall } from '../../../src/core/types';
import { basisCalls, callAt, campaign, makeStore, office, range } from './fixtures';

const window = range('2026-09-08', '2026-09-14');

function setup(calls: CleanCall[], options?: { locationId?: string }) {
  const all = [
    ...basisCalls('cmp_a', 'social', { answered: 30, booked: 6 }), // Alpha: $20 per missed call
    ...basisCalls('cmp_b', 'display', { answered: 30, booked: 3 }), // Beta: $10
    ...calls,
  ];
  const store = makeStore(all, {
    campaigns: [campaign('cmp_a', 'Alpha', 'social', 100), campaign('cmp_b', 'Beta', 'display', 100)],
    locations: [office('loc_a', 'Office A', 'America/Phoenix'), office('loc_b', 'Office B', 'America/Denver')],
  });
  return buildCallbackList(store, window, buildMissedValueRates(store.calls), options);
}

const miss = (iso: string, callerHash: string, over: Partial<CleanCall> = {}) =>
  callAt(iso, { callerHash, locationId: 'loc_a', answered: false, outcome: 'missed', booked: false, revenueUsd: 0, ...over });

// Pending (no outcome) so these calls do not change the rate basis.
const got = (iso: string, callerHash: string, over: Partial<CleanCall> = {}) =>
  callAt(iso, { callerHash, locationId: 'loc_a', answered: true, outcome: null, booked: false, pending: true, revenueUsd: 0, ...over });

describe('buildCallbackList', () => {
  test('a caller who missed and then got through is left out', () => {
    expect(setup([miss('2026-09-10T16:00:00Z', 'h1'), got('2026-09-11T16:00:00Z', 'h1')]).rows).toEqual([]);
  });

  test('a caller who got through and then missed is listed', () => {
    const list = setup([got('2026-09-10T16:00:00Z', 'h1'), miss('2026-09-11T16:00:00Z', 'h1')]);
    expect(list.rows).toHaveLength(1);
  });

  test('a caller who got through after the range ended is left out', () => {
    expect(setup([miss('2026-09-10T16:00:00Z', 'h1'), got('2026-09-20T16:00:00Z', 'h1')]).rows).toEqual([]);
  });

  test('an answered call at another office counts as getting through', () => {
    const list = setup([miss('2026-09-10T16:00:00Z', 'h1'), got('2026-09-11T16:00:00Z', 'h1', { locationId: 'loc_b' })]);
    expect(list.rows).toEqual([]);
  });

  test('an answered call with no outcome counts as getting through', () => {
    const later = got('2026-09-11T16:00:00Z', 'h1');
    expect(later.outcome).toBeNull();
    expect(later.pending).toBe(true);
    expect(setup([miss('2026-09-10T16:00:00Z', 'h1'), later]).rows).toEqual([]);
  });

  test('an answered call at the same instant or earlier does not count', () => {
    const list = setup([got('2026-09-10T16:00:00Z', 'h1'), miss('2026-09-10T16:00:00Z', 'h1')]);
    expect(list.rows).toHaveLength(1);
  });

  test('several attempts: counted in range, valued by the latest only', () => {
    const latest = miss('2026-09-12T16:00:00Z', 'h1', { campaignId: 'cmp_b', channel: 'display' });
    const list = setup([
      miss('2026-09-09T16:00:00Z', 'h1'),
      miss('2026-09-10T16:00:00Z', 'h1'),
      latest,
      miss('2026-09-20T16:00:00Z', 'h1'),
    ]);
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({
      callerHash: 'h1',
      unansweredAttempts: 3,
      estimatedValueUsd: 10,
      campaignId: 'cmp_b',
      lastAttemptAt: latest.startedAt,
    });
  });

  test('misses outside the range do not list a caller', () => {
    expect(setup([miss('2026-09-01T16:00:00Z', 'h1')]).rows).toEqual([]);
  });

  test('rows are sorted by value, then caller hash; the total is their sum', () => {
    const list = setup([
      miss('2026-09-10T16:00:00Z', 'hb'),
      miss('2026-09-10T16:00:00Z', 'hc', { campaignId: 'cmp_b', channel: 'display' }),
      miss('2026-09-10T16:00:00Z', 'ha'),
    ]);
    expect(list.rows.map((r) => [r.callerHash, r.estimatedValueUsd])).toEqual([
      ['ha', 20],
      ['hb', 20],
      ['hc', 10],
    ]);
    expect(list.totalValueUsd).toBe(50);
  });

  test('an unattributed caller is valued by channel and labelled', () => {
    const list = setup([miss('2026-09-10T16:00:00Z', 'h1', { campaignId: null, unattributed: true, channel: 'social' })]);
    expect(list.rows[0]).toMatchObject({ campaignName: 'Unattributed', campaignId: null, estimatedValueUsd: 20 });
  });

  test('the row carries office, tracking number and local time', () => {
    const list = setup([miss('2026-09-10T16:00:00Z', 'h1', { trackingNumber: '+1-555-0199' })]);
    expect(list.rows[0]).toMatchObject({
      officeName: 'Office A',
      locationId: 'loc_a',
      trackingNumber: '+1-555-0199',
      lastAttemptLocal: '2026-09-10 09:00',
    });
  });

  test('no caller hash: not listed, counted', () => {
    const blanks = [miss('2026-09-10T16:00:00Z', ''), miss('2026-09-11T16:00:00Z', '')];
    const only = setup(blanks);
    expect(only.rows).toEqual([]);
    expect(only.unidentifiedUnanswered).toBe(2);

    const mixed = setup([...blanks, miss('2026-09-10T16:00:00Z', 'h1')]);
    expect(mixed.rows.map((r) => r.callerHash)).toEqual(['h1']);
    expect(mixed.unidentifiedUnanswered).toBe(2);
  });

  test('an office filter limits the misses, not the got-through check', () => {
    const calls = [
      miss('2026-09-10T16:00:00Z', 'h1'),
      miss('2026-09-10T16:00:00Z', 'h2', { locationId: 'loc_b' }),
      miss('2026-09-10T16:00:00Z', 'h3'),
      got('2026-09-11T16:00:00Z', 'h3', { locationId: 'loc_b' }),
    ];
    expect(setup(calls, { locationId: 'loc_a' }).rows.map((r) => r.callerHash)).toEqual(['h1']);
  });

  test('an unknown office id lists nobody', () => {
    const list = setup([miss('2026-09-10T16:00:00Z', 'h1')], { locationId: 'loc_zzz' });
    expect(list).toEqual({ rows: [], totalValueUsd: 0, unidentifiedUnanswered: 0 });
  });

  test('no missed calls gives an empty list', () => {
    expect(setup([])).toEqual({ rows: [], totalValueUsd: 0, unidentifiedUnanswered: 0 });
  });
});
