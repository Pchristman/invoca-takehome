import { describe, expect, it } from 'vitest';
import { formatFact } from '../../../src/core/views/facts';
import { buildCampaigns } from '../../../src/core/views/campaignsView';
import { buildLocations } from '../../../src/core/views/locationsView';
import { buildMissedCalls } from '../../../src/core/views/missedCallsView';
import { buildOverview } from '../../../src/core/views/overviewView';
import { makeViewContext } from '../../../src/core/views/viewContext';
import type { CleanCall } from '../../../src/core/types';
import { makeCall } from '../helpers';
import { campaign, expectAllFinite, makeStore, many, office, range } from './fixtures';

/** n calls on one date: `booked` booked at $100, then answered-not-booked, then missed. Callers repeat after `distinct`. */
function period(
  localDate: string,
  tag: string,
  shape: { calls: number; answered: number; booked: number; distinct: number },
): CleanCall[] {
  return Array.from({ length: shape.calls }, (_, i) => {
    const callerHash = `${tag}_${i % shape.distinct}`;
    if (i < shape.booked) {
      return makeCall({ localDate, callerHash, answered: true, outcome: 'booked', booked: true, revenueUsd: 100 });
    }
    if (i < shape.answered) {
      return makeCall({ localDate, callerHash, answered: true, outcome: 'not_qualified', booked: false, revenueUsd: 0 });
    }
    return makeCall({ localDate, callerHash, answered: false, outcome: 'missed', booked: false, revenueUsd: 0 });
  });
}

const options = { campaigns: [campaign('cmp_a', 'Alpha', 'social', 10)], locations: [office('loc_1', 'Office One')] };
const previousCalls = () => period('2026-09-01', 'p', { calls: 10, answered: 8, booked: 4, distinct: 8 });
const currentCalls = () => period('2026-09-14', 'c', { calls: 12, answered: 9, booked: 5, distinct: 12 });
const store = () => makeStore([...previousCalls(), ...currentCalls()], options);
const week = range('2026-09-08', '2026-09-14');

describe('buildOverview tiles', () => {
  it('tiles show current, previous and change', () => {
    const { tiles } = buildOverview(store(), week);
    expect(tiles.calls).toEqual({ current: 12, previous: 10, change: { kind: 'percent', value: expect.closeTo(20, 6) } });
    expect(tiles.uniqueCallers.current).toBe(12);
    expect(tiles.uniqueCallers.previous).toBe(8);
    expect(tiles.uniqueCallers.change).toEqual({ kind: 'percent', value: expect.closeTo(50, 6) });
    expect(tiles.answerRate.current).toBeCloseTo(0.75, 6);
    expect(tiles.answerRate.previous).toBeCloseTo(0.8, 6);
    expect(tiles.answerRate.change).toEqual({ kind: 'points', value: expect.closeTo(-5, 6) });
    expect(tiles.bookings.current).toBe(5);
    expect(tiles.bookings.previous).toBe(4);
    expect(tiles.bookings.change).toEqual({ kind: 'percent', value: expect.closeTo(25, 6) });
    expect(tiles.revenueUsd.current).toBe(500);
    expect(tiles.revenueUsd.previous).toBe(400);
    expect(tiles.revenueUsd.change).toEqual({ kind: 'percent', value: expect.closeTo(25, 6) });
  });

  it('no comparison on all data', () => {
    const view = buildOverview(store(), range('2026-09-01', '2026-09-14'));
    for (const tile of Object.values(view.tiles)) {
      expect(tile.previous).toBeNull();
      expect(tile.change).toEqual({ kind: 'none' });
    }
    expect(view.notes.comparison.reason).toMatch(/^No full previous period/);
    expect(view.tiles.calls.current).toBe(22);
  });

  it('a previous value of zero reads new, both zero reads none', () => {
    // Span is 09-01..09-14; the range 09-09..09-14 has a six-day previous window with no calls.
    const s = makeStore([...period('2026-09-01', 'x', { calls: 1, answered: 1, booked: 1, distinct: 1 }), ...currentCalls()], options);
    const view = buildOverview(s, range('2026-09-09', '2026-09-14'));
    expect(view.notes.comparison.available).toBe(true);
    expect(view.tiles.calls.change).toEqual({ kind: 'new' });
    expect(view.tiles.answerRate.previous).toBeNull();
    expect(view.tiles.answerRate.change).toEqual({ kind: 'none' });
    expectAllFinite(view);

    const empty = buildOverview(makeStore([], options), range('2026-09-01', '2026-09-07'));
    for (const tile of Object.values(empty.tiles)) expect(tile.change).toEqual({ kind: 'none' });
  });

  it('revenue counts booked calls only and unique callers ignore blank hashes', () => {
    const calls = [
      makeCall({ localDate: '2026-09-14', callerHash: '', answered: true, outcome: 'not_qualified', booked: false, revenueUsd: 40 }),
      makeCall({ localDate: '2026-09-14', callerHash: 'a' }),
      makeCall({ localDate: '2026-09-01', callerHash: 'b' }),
    ];
    const { tiles } = buildOverview(makeStore(calls, options), week);
    expect(tiles.calls.current).toBe(2);
    expect(tiles.uniqueCallers.current).toBe(1);
    expect(tiles.revenueUsd.current).toBe(100);
  });
});

describe('buildOverview actions', () => {
  it("top actions are the three views' headlines in fixed order", () => {
    const s = store();
    const view = buildOverview(s, week);
    expect(view.topActions.map((t) => t.view)).toEqual(['campaigns', 'locations', 'missed-calls']);
    expect(view.topActions[0]?.action).toEqual(buildCampaigns(s, week).actions[0]);
    expect(view.topActions[1]?.action).toEqual(buildLocations(s, week).actions[0]);
    expect(view.topActions[2]?.action).toEqual(buildMissedCalls(s, week).actions[0]);
    expect(view.actions).toEqual(view.topActions.map((t) => t.action));
  });

  it('nothing to suggest still lists every view', () => {
    const calls = period('2026-09-14', 'c', { calls: 3, answered: 3, booked: 1, distinct: 3 });
    const view = buildOverview(makeStore(calls, options), range('2026-09-08', '2026-09-14'));
    expect(view.topActions.map((t) => t.action.kind)).toEqual(['no_budget_shift', 'no_office_stands_out', 'no_missed_calls']);
    expect(view.topActions.every((t) => !t.action.actionable)).toBe(true);
    expect(view.templateSentence).toBe(view.actions[0]?.text);
  });

  it('the template sentence is the first actionable top action', () => {
    const view = buildOverview(store(), week);
    const callBack = view.topActions.find((t) => t.view === 'missed-calls')?.action;
    expect(callBack?.kind).toBe('call_back');
    expect(view.topActions[0]?.action.actionable).toBe(false);
    expect(view.templateSentence).toBe(callBack?.text);
  });

  it('the fact sheet merges tiles and top-action facts without collisions', () => {
    const view = buildOverview(store(), week);
    const tileFactCount = 5 /* calls, callers, bookings, answer_rate, revenue */ + 4 /* changes */ + 1; // answer_rate points change
    const actionFacts = view.topActions.reduce((n, t) => n + Object.keys(t.action.facts).length, 0);
    expect(Object.keys(view.factSheet.facts)).toHaveLength(tileFactCount + actionFacts);
    const f = view.factSheet.facts;
    expect(formatFact(f['overview.calls']!)).toBe('12 calls');
    expect(formatFact(f['overview.calls_change']!)).toBe('+20.0%');
    expect(formatFact(f['overview.answer_rate_change']!)).toBe('-5.0 points');
    const names = view.topActions.flatMap((t) => t.action.facts && Object.values(t.action.facts))
      .flatMap((fact) => (fact.kind === 'name' ? [fact.value] : []));
    expect(view.factSheet.entities).toEqual([...new Set(names)].sort());
  });
});

describe('buildOverview edge cases', () => {
  it('a bad second range builds with no comparison', () => {
    const view = buildOverview(store(), week, { start: '2026-02-30', end: '2026-03-02' });
    for (const tile of Object.values(view.tiles)) {
      expect(tile.previous).toBeNull();
      expect(tile.change).toEqual({ kind: 'none' });
    }
    expect(view.notes.comparison.available).toBe(false);
    expect(view.notes.comparison.reason).toEqual(expect.any(String));
    expectAllFinite(view);
  });

  it('an empty range and an empty store build', () => {
    const view = buildOverview(makeStore([], options), range('2026-09-01', '2026-09-07'));
    expect(view.tiles.calls.current).toBe(0);
    expect(view.tiles.answerRate.current).toBeNull();
    expect(view.topActions.map((t) => t.action.kind)).toEqual(['no_budget_shift', 'no_office_stands_out', 'no_missed_calls']);
    expectAllFinite(view);

    const emptyRange = buildOverview(store(), range('2026-09-05', '2026-09-06'));
    expect(emptyRange.tiles.calls.current).toBe(0);
    expectAllFinite(emptyRange);
  });

  it('notes pass through', () => {
    const s = store();
    const view = buildOverview(s, week);
    const ctx = makeViewContext(s, week);
    expect(view.notes).toEqual(ctx.notes);
    expect(view.notes.skippedRows).toBe(ctx.notes.skippedRows);
    expect(view.notes.outcomeLag).toEqual(ctx.notes.outcomeLag);
    expect(view.notes.incompleteCurrent).toEqual(ctx.notes.incompleteCurrent);
  });
});

describe('buildOverview call-change alert', () => {
  const NOW = '2026-09-10';
  const BEFORE = '2026-09-03';
  const cs = [
    campaign('cmp_a', 'Best', 'social', 10),
    campaign('cmp_b', 'Worst', 'display', 10),
    campaign('cmp_z', 'Zed', 'social', 0),
  ];
  const on = (id: string, n: number, localDate: string, booked = 0, revenue = 0): CleanCall[] =>
    many(n).map((c, i) =>
      makeCall({
        ...c, campaignId: id, localDate,
        ...(i < booked
          ? { answered: true, booked: true, outcome: 'booked', revenueUsd: revenue }
          : { answered: true, booked: false, outcome: 'not_qualified', revenueUsd: 0 }),
      }),
    );
  const build = (calls: CleanCall[], r = week) => buildOverview(makeStore(calls, { campaigns: cs, locations: options.locations }), r);
  // A shift is possible (Best earns more per budget dollar than Worst) and Worst's calls fell 60 to 10.
  // One cmp_z call on the first day makes the data span cover the previous period.
  const anchor = () => on('cmp_z', 1, '2026-09-01');
  const withShift = () => [
    ...anchor(),
    ...on('cmp_a', 5, NOW, 5, 1000),
    ...on('cmp_b', 10, NOW, 10, 50),
    ...on('cmp_b', 60, BEFORE),
  ];

  it('the alert sits beside a shift, right after the Campaigns entry', () => {
    const view = build(withShift());
    expect(view.topActions.map((t) => t.view)).toEqual(['campaigns', 'campaigns', 'locations', 'missed-calls']);
    expect(view.topActions.slice(0, 2).map((t) => t.action.kind)).toEqual(['shift_budget', 'review_call_changes']);
    expect(view.actions).toEqual(view.topActions.map((t) => t.action));
  });

  it('an alert that is the Campaigns headline is listed once', () => {
    const view = build([...anchor(), ...on('cmp_a', 60, NOW), ...on('cmp_a', 30, BEFORE)]);
    expect(view.topActions).toHaveLength(3);
    expect(view.topActions[0]!.action.kind).toBe('review_call_changes');
    expect(view.topActions.filter((t) => t.action.kind === 'review_call_changes')).toHaveLength(1);
  });

  it('no alert keeps three entries', () => {
    const view = build([...on('cmp_a', 50, NOW), ...on('cmp_a', 50, BEFORE)]);
    expect(view.topActions.map((t) => t.view)).toEqual(['campaigns', 'locations', 'missed-calls']);
  });

  it('no comparison means no alert entry', () => {
    const view = build(withShift(), range('2026-09-01', '2026-09-14'));
    expect(view.notes.comparison.available).toBe(false);
    expect(view.topActions).toHaveLength(3);
    expect(view.topActions.some((t) => t.action.kind === 'review_call_changes')).toBe(false);
  });

  it('the fact sheet carries the alert facts and the campaign name', () => {
    const view = build(withShift());
    expect(view.factSheet.facts['alert.count']).toBeDefined();
    expect(view.factSheet.facts['alert.top.name']).toBeDefined();
    expect(view.factSheet.entities).toContain('Worst');
  });

  it('the headline is still the first actionable top action', () => {
    const view = build(withShift());
    expect(view.templateSentence).toBe(view.topActions[0]!.action.text);
    expect(view.topActions[0]!.action.kind).toBe('shift_budget');
  });
});

describe('buildOverview with a second range of another length', () => {
  const short = { start: '2026-09-01', end: '2026-09-03' };
  type Span = { start: string; end: string };
  /** n calls on each date of a span; booked ones are answered, booked, $100. */
  const onEach = (r: Span, n: number, tag: string, booked = false): CleanCall[] => {
    const out: CleanCall[] = [];
    for (let d = Number(r.start.slice(8)); d <= Number(r.end.slice(8)); d++) {
      const localDate = `2026-09-${String(d).padStart(2, '0')}`;
      for (let i = 0; i < n; i++) {
        const callerHash = `${tag}_${d}_${i}`;
        out.push(
          booked
            ? makeCall({ localDate, callerHash, answered: true, outcome: 'booked', booked: true, revenueUsd: 100 })
            : makeCall({ localDate, callerHash, answered: true, outcome: 'not_qualified', booked: false, revenueUsd: 0 }),
        );
      }
    }
    return out;
  };
  const build = (calls: CleanCall[], second: Span = short, r = week) => buildOverview(makeStore(calls, options), r, second);
  const day = (localDate: string) => makeCall({ localDate });

  it('per day, not totals', () => {
    // 14 calls in 7 days is 2 a day; 3 calls in 3 days is 1 a day: +100% per day (totals would say about +367%).
    const view = build([...onEach(week, 2, 'c'), ...onEach(short, 1, 'p')]);
    expect(view.tiles.calls).toEqual({ current: 14, previous: 3, change: { kind: 'percent', value: expect.closeTo(100, 6) } });
  });

  it('bookings and revenue per day', () => {
    // 1 a day now against 1 in 3 days (0.33 a day): +200% per day (totals would say +600%).
    const calls = [...onEach(week, 1, 'c', true), ...onEach({ start: '2026-09-01', end: '2026-09-01' }, 1, 'p', true)];
    const { tiles } = build(calls);
    expect(tiles.bookings).toEqual({ current: 7, previous: 1, change: { kind: 'percent', value: expect.closeTo(200, 6) } });
    expect(tiles.revenueUsd).toEqual({ current: 700, previous: 100, change: { kind: 'percent', value: expect.closeTo(200, 6) } });
  });

  it('unique callers are not compared', () => {
    const calls = [...onEach(week, 2, 'c'), ...onEach(short, 1, 'p')];
    const view = build(calls);
    expect(view.tiles.uniqueCallers.previous).toBeNull();
    expect(view.tiles.uniqueCallers.change).toEqual({ kind: 'none' });
    expect(view.tiles.calls.change.kind).toBe('percent');
    const equal = buildOverview(makeStore(calls, options), week);
    expect(equal.tiles.uniqueCallers.previous).not.toBeNull();
  });

  it('answer rate stays in points', () => {
    const miss = makeCall({ localDate: '2026-09-10', answered: false, outcome: 'missed', booked: false, revenueUsd: 0 });
    const hit = (localDate: string) => makeCall({ localDate, answered: true, outcome: 'not_qualified', booked: false, revenueUsd: 0 });
    const view = build([hit('2026-09-09'), miss, hit('2026-09-01'), hit('2026-09-02')]);
    expect(view.tiles.answerRate.change).toEqual({ kind: 'points', value: expect.closeTo(-50, 6) });
  });

  it('notes carry the per-day facts', () => {
    const calls = [...onEach(week, 1, 'c'), ...onEach(short, 1, 'p')];
    expect(build(calls).notes.comparison).toMatchObject({ perDay: true, currentDays: 7, previousDays: 3, reason: null });
    expect(buildOverview(makeStore(calls, options), week).notes.comparison).toMatchObject({ perDay: false, previousDays: 7 });
    const bad = build(calls, { start: '2026-02-30', end: '2026-03-02' });
    expect(bad.notes.comparison).toMatchObject({ available: false, perDay: false, previousDays: null, currentDays: 7 });
  });

  it('the fact sheet leaves out count and money changes but keeps answer rate', () => {
    const calls = [...onEach(week, 2, 'c'), ...onEach(short, 1, 'p')];
    const f = build(calls).factSheet.facts;
    expect(f['overview.answer_rate_change']).toBeDefined();
    for (const k of ['calls', 'callers', 'bookings', 'revenue']) expect(f[`overview.${k}_change`]).toBeUndefined();
    expect(buildOverview(makeStore(calls, options), week).factSheet.facts['overview.calls_change']).toBeDefined();
  });

  it('an empty second range reads new or none, never infinite', () => {
    // Anchors on 09-01 and 09-14 make the span cover 09-02..09-03, which holds no calls.
    const empty = { start: '2026-09-02', end: '2026-09-03' };
    const view = build([day('2026-09-01'), ...onEach(week, 1, 'c')], empty);
    expect(view.tiles.calls.change).toEqual({ kind: 'new' });
    expectAllFinite(view);
    const both = build([day('2026-09-01'), day('2026-09-14')], empty, range('2026-09-05', '2026-09-11'));
    expect(both.tiles.calls.change).toEqual({ kind: 'none' });
    expectAllFinite(both);
  });

  it('the selected range as the second range reads 0%', () => {
    const view = build(onEach(week, 1, 'c'), week);
    expect(view.tiles.calls.change).toEqual({ kind: 'percent', value: 0 });
    expect(view.notes.comparison.overlaps).toBe(true);
    expect(view.notes.comparison.perDay).toBe(false);
  });

  it('a one-day second range builds', () => {
    const view = build([day('2026-09-01'), ...onEach(week, 1, 'c')], { start: '2026-09-01', end: '2026-09-01' });
    expect(view.notes.comparison.previousDays).toBe(1);
    expectAllFinite(view);
  });

  it('a second range outside the data has no comparison', () => {
    const view = build(onEach(week, 1, 'c'), { start: '2026-07-01', end: '2026-07-03' });
    expect(view.notes.comparison.available).toBe(false);
    expect(view.notes.comparison.reason).toMatch(/^No full previous period/);
    for (const tile of Object.values(view.tiles)) {
      expect(tile.previous).toBeNull();
      expect(tile.change).toEqual({ kind: 'none' });
    }
  });
});
