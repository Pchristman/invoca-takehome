import { describe, expect, test } from 'vitest';
import { buildMissedCalls } from '../../../src/core/views/missedCallsView';
import type { CleanCall } from '../../../src/core/types';
import { basisCalls, callAt, campaign, expectAllFinite, makeStore, office, range } from './fixtures';

const window = range('2026-09-08', '2026-09-14');

function setup(calls: CleanCall[], options?: { locationId?: string }) {
  const all = [
    ...basisCalls('cmp_a', 'social', { answered: 30, booked: 6 }), // Alpha: $20 per missed call
    ...basisCalls('cmp_b', 'display', { answered: 30, booked: 3 }), // Beta: $10
    ...basisCalls('cmp_c', 'paid_search', { answered: 10, booked: 0 }), // Gamma: thin; its own channel so the display rate stays $15
    ...basisCalls('cmp_d', 'display', { answered: 30, booked: 6 }), // Delta: with Beta, display is $15
    ...calls,
  ];
  const store = makeStore(all, {
    campaigns: [
      campaign('cmp_a', 'Alpha', 'social', 100),
      campaign('cmp_b', 'Beta', 'display', 100),
      campaign('cmp_c', 'Gamma', 'display', 0),
      campaign('cmp_d', 'Delta', 'display', 100),
    ],
    locations: [office('loc_a', 'Office A', 'America/Phoenix'), office('loc_b', 'Office B', 'America/Denver')],
  });
  return buildMissedCalls(store, window, undefined, options);
}

// Tuesday 09:00 local by default.
const miss = (iso: string, callerHash: string, over: Partial<CleanCall> = {}) =>
  callAt(iso, {
    callerHash, locationId: 'loc_a', answered: false, outcome: 'missed', booked: false, revenueUsd: 0,
    localWeekday: 1, localHour: 9, ...over,
  });

const got = (iso: string, callerHash: string, over: Partial<CleanCall> = {}) =>
  callAt(iso, { callerHash, locationId: 'loc_a', answered: true, outcome: null, booked: false, pending: true, revenueUsd: 0, ...over });

describe('buildMissedCalls', () => {
  test('the heatmap is zero-filled', () => {
    const view = setup([miss('2026-09-10T16:00:00Z', 'h1'), miss('2026-09-10T17:00:00Z', 'h2', { locationId: 'loc_b', localHour: 11 })]);
    expect(view.heatmap.byOffice).toHaveLength(2);
    for (const row of view.heatmap.byOffice) expect(row.hours).toHaveLength(24);
    expect(view.heatmap.byWeekday).toHaveLength(7);
    for (const row of view.heatmap.byWeekday) expect(row.hours).toHaveLength(24);
    expect(view.heatmap.byWeekday.map((r) => r.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(view.heatmap.byOffice[0]!.hours[10]).toBe(0);
    const officeSum = view.heatmap.byOffice.reduce((s, r) => s + r.total, 0);
    const daySum = view.heatmap.byWeekday.reduce((s, r) => s + r.total, 0);
    expect(officeSum).toBe(view.unansweredCalls);
    expect(daySum).toBe(view.unansweredCalls);
  });

  test('an office with an invalid time zone has no heatmap row', () => {
    const store = makeStore([miss('2026-09-10T16:00:00Z', 'h1')], {
      campaigns: [campaign('cmp_a', 'Alpha', 'social', 100)],
      locations: [office('loc_a', 'Office A', 'America/Phoenix'), { ...office('loc_x', 'Nowhere', 'Mars/Olympus'), timezoneValid: false }],
    });
    expect(buildMissedCalls(store, window).heatmap.byOffice.map((row) => row.locationId)).toEqual(['loc_a']);
  });

  test('an office with no misses still has a row of zeros', () => {
    const view = setup([miss('2026-09-10T16:00:00Z', 'h1')]);
    const b = view.heatmap.byOffice.find((r) => r.locationId === 'loc_b')!;
    expect(b.total).toBe(0);
    expect(b.hours.every((h) => h === 0)).toBe(true);
  });

  test('the heatmap uses local weekday and hour', () => {
    const view = setup([miss('2026-09-10T02:00:00Z', 'h1', { localWeekday: 4, localHour: 15 })]);
    expect(view.heatmap.byWeekday[4]!.hours[15]).toBe(1);
    expect(view.heatmap.byOffice.find((r) => r.locationId === 'loc_a')!.hours[15]).toBe(1);
    expect(view.heatmap.byWeekday[4]!.total).toBe(1);
  });

  test('answered calls are not in the heatmap or the counts', () => {
    const view = setup([got('2026-09-10T16:00:00Z', 'h1'), miss('2026-09-10T16:00:00Z', 'h2')]);
    expect(view.unansweredCalls).toBe(1);
    expect(view.heatmap.byWeekday.reduce((s, r) => s + r.total, 0)).toBe(1);
  });

  test('lost value covers every unanswered call in range', () => {
    const view = setup([
      miss('2026-09-09T16:00:00Z', 'h1'),
      miss('2026-09-10T16:00:00Z', 'h2'),
      miss('2026-09-11T16:00:00Z', 'h3'),
      miss('2026-09-11T17:00:00Z', 'h4', { campaignId: 'cmp_b', channel: 'display' }),
      miss('2026-09-20T16:00:00Z', 'h5'), // outside the range
    ]);
    expect(view.lostValue.estimatedUsd).toBe(70);
  });

  test('a caller who got through later is still in lost value but not in the callbacks', () => {
    const view = setup([miss('2026-09-10T16:00:00Z', 'h1'), got('2026-09-11T16:00:00Z', 'h1')]);
    expect(view.lostValue.estimatedUsd).toBe(20);
    expect(view.callbacks.rows).toEqual([]);
  });

  test('a campaign too thin for its own rate uses its channel', () => {
    const gamma = (h: string) => miss('2026-09-10T16:00:00Z', h, { campaignId: 'cmp_c', channel: 'display' });
    const view = setup([gamma('h1'), gamma('h2')]);
    expect(view.lostValue.estimatedUsd).toBe(30);
    expect(view.lostValue.bySource).toEqual({ campaign: 0, channel: 2, overall: 0 });
    const more = setup([gamma('h1'), gamma('h2'), miss('2026-09-10T16:00:00Z', 'h3')]);
    expect(more.lostValue.bySource.campaign).toBe(1);
  });

  test('the formula names the threshold', () => {
    const { formula } = setup([]).lostValue;
    expect(formula).toContain('30');
    expect(formula).toContain('channel');
    expect(formula).toContain('whole export');
    expect(formula).toContain('Unattributed calls use their channel');
    expect(formula).toContain('Pending calls');
    expect(formula).toContain('This is a model, not a measured loss');
    expect(formula).toContain('likely overstates the loss');
    expect(formula).toContain('every unanswered call');
  });

  test('the call-back action', () => {
    const view = setup([miss('2026-09-10T16:00:00Z', 'h1'), miss('2026-09-10T17:00:00Z', 'h2')]);
    expect(view.actions).toHaveLength(1);
    expect(view.actions[0]).toMatchObject({
      kind: 'call_back',
      actionable: true,
      text: 'Call back 2 callers whose latest call went unanswered.',
      link: { view: 'missed-calls' },
    });
    expect(view.actions[0]!.link.locationId).toBeUndefined();
    expect(view.templateSentence).toBe(view.actions[0]!.text);
    expect(view.factSheet.view).toBe('missed-calls');
    expect(view.factSheet.entities).toEqual([]);
    // The call-back list has no dollar total, so the AI cannot quote one.
    expect(Object.keys(view.factSheet.facts)).toEqual(['callbacks.callers']);

    const one = setup([miss('2026-09-10T16:00:00Z', 'h1')]);
    expect(one.actions[0]!.text).toBe('Call back 1 caller whose latest call went unanswered.');
  });

  test('everyone has since got through', () => {
    const view = setup([miss('2026-09-10T16:00:00Z', 'h1'), got('2026-09-11T16:00:00Z', 'h1')]);
    expect(view.actions[0]!.kind).toBe('no_callbacks');
    expect(view.actions[0]!.actionable).toBe(false);
    expect(view.lostValue.estimatedUsd).toBeGreaterThan(0);
    expect(view.actions[0]!.text).toBe('There is no one to call back from this range.');
  });

  test('no missed calls in range', () => {
    const none = setup([got('2026-09-10T16:00:00Z', 'h1')]);
    const empty = buildMissedCalls(makeStore([]), window);
    for (const view of [none, empty]) {
      expect(view.unansweredCalls).toBe(0);
      expect(view.heatmap.byOffice.every((r) => r.total === 0 && r.hours.every((h) => h === 0))).toBe(true);
      expect(view.heatmap.byWeekday.every((r) => r.total === 0 && r.hours.every((h) => h === 0))).toBe(true);
      expect(view.lostValue.estimatedUsd).toBe(0);
      expect(view.callbacks.rows).toEqual([]);
      expect(view.actions).toHaveLength(1);
      expect(view.actions[0]!.kind).toBe('no_missed_calls');
      expect(view.actions[0]!.text).toBe('No calls went unanswered in this range.');
      expectAllFinite(view);
    }
  });

  test('an office filter', () => {
    const view = setup(
      [
        miss('2026-09-10T16:00:00Z', 'h1'),
        miss('2026-09-10T17:00:00Z', 'h2', { locationId: 'loc_b' }),
        miss('2026-09-10T18:00:00Z', 'h3', { locationId: 'loc_b' }),
      ],
      { locationId: 'loc_a' },
    );
    expect(view.officeFilter).toEqual({ locationId: 'loc_a', name: 'Office A' });
    expect(view.heatmap.byOffice).toHaveLength(1);
    expect(view.unansweredCalls).toBe(1);
    expect(view.heatmap.byWeekday.reduce((s, r) => s + r.total, 0)).toBe(1);
    expect(view.callbacks.rows).toHaveLength(1);
    expect(view.actions[0]!.link).toEqual({ view: 'missed-calls', locationId: 'loc_a' });
  });

  test('an unknown office id gives an empty view, not all offices', () => {
    const view = setup([miss('2026-09-10T16:00:00Z', 'h1')], { locationId: 'nope' });
    expect(view.officeFilter).toEqual({ locationId: 'nope', name: null });
    expect(view.unansweredCalls).toBe(0);
    expect(view.heatmap.byOffice).toEqual([]);
    expect(view.actions[0]!.kind).toBe('no_missed_calls');
    expectAllFinite(view);
  });

  test('unanswered calls with no caller hash', () => {
    const view = setup([miss('2026-09-10T16:00:00Z', ''), miss('2026-09-10T17:00:00Z', '')]);
    expect(view.unansweredCalls).toBe(2);
    expect(view.heatmap.byWeekday[1]!.hours[9]).toBe(2);
    expect(view.lostValue.estimatedUsd).toBe(40);
    expect(view.unidentifiedUnanswered).toBe(2);
    expect(view.callbacks.unidentifiedUnanswered).toBe(2);
    expect(view.callbacks.rows).toEqual([]);
    expect(view.actions[0]!.kind).toBe('no_callbacks');
    expect(view.actions[0]!.text).toBe(
      'No call-back list: 2 calls went unanswered without a caller number, so those callers cannot be identified.',
    );
    expect(view.actions[0]!.text).not.toContain('no one to call back');
    const one = setup([miss('2026-09-10T16:00:00Z', '')]);
    expect(one.actions[0]!.text).toContain('1 call went unanswered without a caller number');
  });

  test('the limit note says callers are identified by hash and can be matched by tracking number and time', () => {
    const { limitNote } = setup([]);
    expect(limitNote).toContain('hash');
    expect(limitNote).toContain('tracking number');
    expect(limitNote).toContain('time');
  });
});
