import { describe, expect, test } from 'vitest';
import {
  callsInRange,
  changeInCount,
  changeInCountPerDay,
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

describe('changeInCountPerDay', () => {
  test.each([
    ['equal days equals changeInCount', 56, 28, 28, 28, 100],
    ['28 days against 7', 56, 28, 7, 7, 100],
    ['7 days against 14', 14, 7, 14, 14, 100],
    ['7 days against 3, same rate', 14, 7, 6, 3, 0],
    ['1 day against 28', 5, 1, 28, 28, 400],
    ['zero now', 0, 7, 12, 3, -100],
  ])('%s', (_name, current, currentDays, previous, previousDays, percent) => {
    const change = changeInCountPerDay(current, currentDays, previous, previousDays);
    expect(change.kind).toBe('percent');
    expect(change.kind === 'percent' && change.value).toBeCloseTo(percent);
  });

  test('zero before is new', () => {
    expect(changeInCountPerDay(10, 7, 0, 14)).toEqual({ kind: 'new' });
  });

  test('both zero is none', () => {
    expect(changeInCountPerDay(0, 7, 0, 3)).toEqual({ kind: 'none' });
  });

  test.each([
    [5, 0, 5, 7],
    [5, 7, 5, -1],
    [5, 2.5, 5, 7],
    [5, NaN, 5, 7],
    [5, 7, 5, Infinity],
    [5, 0, 5, 0],
  ])('days not usable (%s, %s, %s, %s) shows no change', (current, currentDays, previous, previousDays) => {
    expect(changeInCountPerDay(current, currentDays, previous, previousDays)).toEqual({ kind: 'none' });
  });

  test.each([
    [NaN, 7, 5, 3],
    [5, 7, Infinity, 3],
  ])('count not usable (%s, %s, %s, %s) shows no change', (current, currentDays, previous, previousDays) => {
    expect(changeInCountPerDay(current, currentDays, previous, previousDays)).toEqual({ kind: 'none' });
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

describe('numbers that are not finite never reach the screen', () => {
  test.each([
    [Number.NaN, 3],
    [3, Number.NaN],
    [Number.POSITIVE_INFINITY, 2],
  ])('rate(%s, %s) is null', (numerator, denominator) => {
    expect(rate(numerator, denominator)).toBeNull();
  });

  test.each([
    [5, Number.NaN],
    [Number.NaN, 5],
    [Number.POSITIVE_INFINITY, 5],
  ])('changeInCount(%s, %s) shows no change', (current, previous) => {
    expect(changeInCount(current, previous)).toEqual({ kind: 'none' });
  });

  test('changeInRate with a NaN rate shows no change', () => {
    expect(changeInRate(Number.NaN, 0.2)).toEqual({ kind: 'none' });
    expect(changeInRate(0.2, Number.NaN)).toEqual({ kind: 'none' });
  });

  test('a non-finite budget or day count estimates $0, which makes cost per booking blank', () => {
    expect(estimatedSpend(Number.NaN, 3)).toBe(0);
    expect(estimatedSpend(10, Number.NaN)).toBe(0);
    expect(costPerBooking(Number.NaN, 5)).toBeNull();
    expect(revenuePerBudgetDollar(900, Number.NaN)).toBeNull();
    expect(revenuePerBudgetDollar(Number.NaN, 600)).toBeNull();
  });

  test('estimated spend is rounded to whole cents', () => {
    expect(estimatedSpend(0.1, 3)).toBe(0.3);
  });

  test('tally treats a non-finite revenue as $0', () => {
    const total = tally([makeCall({ revenueUsd: Number.NaN }), makeCall({ revenueUsd: 50 })]);
    expect(total.revenueUsd).toBe(50);
    expect(total.bookings).toBe(2);
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

  test('tally counts revenue on booked calls only, whatever a call carries', () => {
    const calls = [
      makeCall({ revenueUsd: 100 }),
      makeCall({ outcome: 'qualified_lead', booked: false, revenueUsd: 50 }),
    ];
    expect(tally(calls).revenueUsd).toBe(100);
  });

  test('calls with no caller hash are not counted as one shared caller', () => {
    const calls = [makeCall({ callerHash: '' }), makeCall({ callerHash: '' }), makeCall({ callerHash: 'h1' })];
    expect(tally(calls)).toMatchObject({ calls: 3, uniqueCallers: 1 });
  });

  test('tally sums money in whole cents', () => {
    const calls = [makeCall({ revenueUsd: 0.1 }), makeCall({ revenueUsd: 0.2 })];
    expect(tally(calls).revenueUsd).toBe(0.3);
  });

  test('tally of no calls is all zeros', () => {
    expect(tally([])).toEqual({ calls: 0, uniqueCallers: 0, answered: 0, bookings: 0, revenueUsd: 0 });
  });
});
