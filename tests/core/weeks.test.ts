import { describe, expect, test } from 'vitest';
import { callsPerWeek } from '../../src/core/weeks';
import type { DateRange } from '../../src/core/ranges';
import { makeCall } from './helpers';

// 2026-10-26 is a Monday.
const wide: DateRange = { start: '2026-09-01', end: '2027-03-01' };
const range = (start: string, end: string): DateRange => ({ start, end });
const onDays = (...days: string[]) => days.map((localDate) => makeCall({ localDate }));

describe('callsPerWeek', () => {
  test('one full Monday to Sunday week is not partial', () => {
    expect(callsPerWeek([], range('2026-10-26', '2026-11-01'), wide)).toEqual([
      { weekStart: '2026-10-26', weekEnd: '2026-11-01', calls: 0, partial: false },
    ]);
  });

  test('a range starting midweek has partial first and last weeks', () => {
    const weeks = callsPerWeek([], range('2026-10-28', '2026-11-03'), wide);
    expect(weeks.map((w) => [w.weekStart, w.partial])).toEqual([
      ['2026-10-26', true],
      ['2026-11-02', true],
    ]);
  });

  test('a one-day range gives one partial bucket', () => {
    const weeks = callsPerWeek([], range('2026-11-01', '2026-11-01'), wide);
    expect(weeks).toEqual([{ weekStart: '2026-10-26', weekEnd: '2026-11-01', calls: 0, partial: true }]);
  });

  test('a week cut off by the end of the data is partial even when the range reaches past it', () => {
    const endsWednesday = range('2026-09-01', '2026-10-28');
    const weeks = callsPerWeek([], range('2026-10-26', '2026-11-01'), endsWednesday);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.partial).toBe(true);
  });

  test('the week holding the first date in the data is partial even when that date is a Monday', () => {
    const startsMonday = range('2026-10-19', '2027-03-01');
    const weeks = callsPerWeek([], range('2026-10-19', '2026-11-01'), startsMonday);
    expect(weeks.map((w) => [w.weekStart, w.partial])).toEqual([
      ['2026-10-19', true],
      ['2026-10-26', false],
    ]);
  });

  test('a week cut off by the start of the data is partial', () => {
    const startsThursday = range('2026-10-22', '2027-03-01');
    const weeks = callsPerWeek([], range('2026-10-19', '2026-11-01'), startsThursday);
    expect(weeks.map((w) => [w.weekStart, w.partial])).toEqual([
      ['2026-10-19', true],
      ['2026-10-26', false],
    ]);
  });

  test('weeks with no calls appear with zero, in order', () => {
    const calls = onDays('2026-10-07', '2026-10-07', '2026-10-21');
    const weeks = callsPerWeek(calls, range('2026-10-05', '2026-10-25'), wide);
    expect(weeks.map((w) => [w.weekStart, w.calls])).toEqual([
      ['2026-10-05', 2],
      ['2026-10-12', 0],
      ['2026-10-19', 1],
    ]);
  });

  test('only calls inside the range are counted', () => {
    const calls = onDays('2026-10-25', '2026-10-30', '2026-11-02');
    const weeks = callsPerWeek(calls, range('2026-10-26', '2026-11-01'), wide);
    expect(weeks.map((w) => w.calls)).toEqual([1]);
  });

  test('a week spanning New Year groups correctly', () => {
    const weeks = callsPerWeek(onDays('2026-12-31', '2027-01-01'), range('2026-12-28', '2027-01-03'), wide);
    expect(weeks).toEqual([{ weekStart: '2026-12-28', weekEnd: '2027-01-03', calls: 2, partial: false }]);
  });

  test('no calls in the range gives zero-filled buckets, not an empty list', () => {
    const weeks = callsPerWeek([], range('2026-10-26', '2026-11-08'), wide);
    expect(weeks.map((w) => w.calls)).toEqual([0, 0]);
  });
});
