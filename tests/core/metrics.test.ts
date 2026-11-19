import { describe, expect, test } from 'vitest';
import {
  callsInRange,
  changeInCount,
  changeInRate,
  costPerBooking,
  estimatedSpend,
  rate,
  revenuePerBudgetDollar,
  tally,
} from '../../src/core/metrics';
import { makeCall } from './helpers';

describe('rate', () => {
  test.each([
    [1, 4, 0.25],
    [0, 5, 0],
    [3, 0, null],
    [0, 0, null],
  ])('rate(%d, %d) is %s', (numerator, denominator, expected) => {
    expect(rate(numerator, denominator)).toBe(expected);
  });
});

describe('changeInCount', () => {
  test.each([
    [120, 100, 20],
    [80, 100, -20],
    [0, 100, -100],
    [100, 100, 0],
  ])('changeInCount(%d, %d) is %d percent', (current, previous, percent) => {
    expect(changeInCount(current, previous)).toEqual({ kind: 'percent', value: percent });
  });

  test('a previous value of 0 with a current value above 0 is new, never infinity', () => {
    expect(changeInCount(5, 0)).toEqual({ kind: 'new' });
  });

  test('both 0 shows no change', () => {
    expect(changeInCount(0, 0)).toEqual({ kind: 'none' });
  });

  test('money changes are a percentage too', () => {
    const change = changeInCount(432894, 400000);
    expect(change.kind).toBe('percent');
    expect(change.kind === 'percent' && change.value).toBeCloseTo(8.2235, 3);
  });
});

describe('changeInRate', () => {
  test.each([
    [0.25, 0.2, 5],
    [0.2, 0.25, -5],
    [0.1, 0, 10], // 0% to 10% is +10 points, not "new"
    [0, 0.2, -20],
  ])('changeInRate(%d, %d) is %d points', (current, previous, points) => {
    const change = changeInRate(current, previous);
    expect(change.kind).toBe('points');
    expect(change.kind === 'points' && change.value).toBeCloseTo(points, 9);
  });

  test.each([
    [0, 0],
    [null, 0.2],
    [0.2, null],
    [null, null],
  ])('changeInRate(%s, %s) shows no change', (current, previous) => {
    expect(changeInRate(current, previous)).toEqual({ kind: 'none' });
  });
});

describe('spend and cost', () => {
  test.each([
    [10, 7, 70],
    [0, 60, 0],
    [12.5, 3, 37.5],
  ])('estimatedSpend(%d, %d) is %d', (budget, days, spend) => {
    expect(estimatedSpend(budget, days)).toBe(spend);
  });

  test.each([
    [600, 12, 50],
    [0, 5, null], // zero budget
    [600, 0, null], // zero bookings
    [0, 0, null],
  ])('costPerBooking(%d, %d) is %s, never infinity', (spend, bookings, expected) => {
    expect(costPerBooking(spend, bookings)).toBe(expected);
  });

  test.each([
    [900, 600, 1.5],
    [900, 0, null],
    [0, 600, 0],
  ])('revenuePerBudgetDollar(%d, %d) is %s', (revenue, spend, expected) => {
    expect(revenuePerBudgetDollar(revenue, spend)).toBe(expected);
  });
});

describe('callsInRange', () => {
  const onDay = (localDate: string) => makeCall({ localDate });

  test('callsInRange is inclusive at both ends', () => {
    const calls = ['2026-09-09', '2026-09-10', '2026-09-16', '2026-09-17'].map(onDay);
    const kept = callsInRange(calls, { start: '2026-09-10', end: '2026-09-16' });
    expect(kept.map((c) => c.localDate)).toEqual(['2026-09-10', '2026-09-16']);
  });

  test('a one-day range keeps only that day', () => {
    const calls = ['2026-09-09', '2026-09-10', '2026-09-11'].map(onDay);
    expect(callsInRange(calls, { start: '2026-09-10', end: '2026-09-10' })).toHaveLength(1);
  });

  test('callsInRange uses the local date, not the UTC date', () => {
    const lateLocal = makeCall({ startedAt: new Date('2026-09-11T02:00:00Z'), localDate: '2026-09-10' });
    expect(callsInRange([lateLocal], { start: '2026-09-10', end: '2026-09-10' })).toEqual([lateLocal]);
  });
});

describe('tally', () => {
  test('tally counts calls, unique callers, answered, bookings and revenue', () => {
    const calls = [
      makeCall({ callerHash: 'h1', revenueUsd: 250 }),
      makeCall({ callerHash: 'h1', outcome: 'qualified_lead', booked: false, revenueUsd: 0 }),
      makeCall({ callerHash: 'h2', answered: false, outcome: 'missed', booked: false, revenueUsd: 0 }),
      makeCall({ callerHash: 'h3', outcome: null, booked: false, pending: true, revenueUsd: 0 }),
    ];
    expect(tally(calls)).toEqual({ calls: 4, uniqueCallers: 3, answered: 3, bookings: 1, revenueUsd: 250 });
  });

  test('tally sums money in whole cents', () => {
    const calls = [makeCall({ revenueUsd: 0.1 }), makeCall({ revenueUsd: 0.2 })];
    expect(tally(calls).revenueUsd).toBe(0.3);
  });

  test('tally of no calls is all zeros', () => {
    expect(tally([])).toEqual({ calls: 0, uniqueCallers: 0, answered: 0, bookings: 0, revenueUsd: 0 });
  });
});
