import { describe, expect, test } from 'vitest';
import { addDays, daysBetween, isLocalDate, weekStart } from '../../src/core/localDate';
import { THRESHOLDS } from '../../src/core/thresholds';

describe('addDays', () => {
  test('addDays crosses month, year and leap-day boundaries', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    // A US DST date: strings are zone-free, so the day count is unaffected.
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-03-08', 0)).toBe('2026-03-08');
  });
});

describe('daysBetween', () => {
  test('daysBetween is signed and counts whole days', () => {
    expect(daysBetween('2026-09-01', '2026-10-29')).toBe(58);
    expect(daysBetween('2026-10-29', '2026-09-01')).toBe(-58);
    expect(daysBetween('2026-09-01', '2026-09-01')).toBe(0);
  });
});

describe('isLocalDate', () => {
  test.each(['2026-02-28', '2028-02-29'])('accepts the real date %s', (value) => {
    expect(isLocalDate(value)).toBe(true);
  });

  test.each([
    '2026-02-29',
    '2026-02-30',
    '2026-13-01',
    '2026-2-3',
    '26-02-03',
    '',
    '2026-02-03T00:00:00Z',
    ' 2026-02-03',
    '2026-02-03\n',
  ])('rejects %j', (value) => {
    expect(isLocalDate(value)).toBe(false);
  });
});

describe('weekStart', () => {
  test('weekStart returns the Monday on or before', () => {
    expect(weekStart('2026-10-28')).toBe('2026-10-26'); // Wednesday
    expect(weekStart('2026-10-26')).toBe('2026-10-26'); // Monday
    expect(weekStart('2026-11-01')).toBe('2026-10-26'); // Sunday
    expect(weekStart('2027-01-01')).toBe('2026-12-28'); // Friday, across the year
  });
});

describe('THRESHOLDS', () => {
  test('THRESHOLDS match the PLAN.md table', () => {
    expect(THRESHOLDS).toEqual({
      MIN_BOOKINGS_TO_RANK: 5,
      MIN_CALLS_BEST_CAMPAIGN: 20,
      MIN_CALLS_OUTLIER: 50,
      OUTLIER_Z: 2.5,
      MIN_ANSWERED_FOR_RATE: 30,
    });
  });
});
