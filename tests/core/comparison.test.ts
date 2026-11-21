import { describe, expect, test } from 'vitest';
import { incompleteDays, outcomeLagApplies, resolveComparison } from '../../src/core/comparison';
import type { RangeComparison } from '../../src/core/comparison';
import type { DateRange } from '../../src/core/ranges';

const span: DateRange = { start: '2026-09-01', end: '2026-10-29' };
const range = (start: string, end: string): DateRange => ({ start, end });

/** The comparison, failing the test if resolving was rejected. */
const compare = (current: DateRange, previous?: DateRange, within: DateRange = span): RangeComparison => {
  const result = resolveComparison(within, current, previous);
  if (!result.ok) throw new Error(`expected a comparison, got ${result.error.code}`);
  return result.comparison;
};

describe('resolveComparison default previous period', () => {
  test('the default previous period is the same length, immediately before', () => {
    expect(compare(range('2026-10-23', '2026-10-29'))).toEqual({
      previous: { start: '2026-10-16', end: '2026-10-22', days: 7 },
      available: true,
      unavailableReason: null,
      sameLength: true,
      perDay: false,
      overlaps: false,
    });
  });

  test('a one-day range compares with the day before', () => {
    const c = compare(range('2026-10-29', '2026-10-29'));
    expect(c.previous).toEqual({ start: '2026-10-28', end: '2026-10-28', days: 1 });
    expect(c.available).toBe(true);
  });

  test('a previous period that exactly touches the data start is available', () => {
    const c = compare(range('2026-09-08', '2026-09-14'));
    expect(c.previous).toMatchObject({ start: '2026-09-01', end: '2026-09-07' });
    expect(c.available).toBe(true);
  });

  test('a previous period one day before the data start is not available', () => {
    const c = compare(range('2026-09-07', '2026-09-13'));
    expect(c.previous).toMatchObject({ start: '2026-08-31', end: '2026-09-06' });
    expect(c.available).toBe(false);
    expect(c.unavailableReason).toMatch(/^No full previous period/);
    expect(c.unavailableReason).toContain('2026-09-01');
    expect(c.unavailableReason).toContain('2026-08-31');
  });

  test('all data never has a comparison', () => {
    const c = compare(span);
    expect(c.available).toBe(false);
    expect(c.unavailableReason).toMatch(/^No full previous period/);
  });

  test('a one-day range on the first data day has no comparison', () => {
    expect(compare(range('2026-09-01', '2026-09-01')).available).toBe(false);
  });

  test('a short preset on short data has no comparison', () => {
    const short = range('2026-10-27', '2026-10-29');
    expect(compare(short, undefined, short).available).toBe(false);
  });

  test('the previous period crosses a leap day correctly', () => {
    const leapSpan = range('2028-01-01', '2028-03-31');
    const c = compare(range('2028-03-01', '2028-03-07'), undefined, leapSpan);
    expect(c.previous).toEqual({ start: '2028-02-23', end: '2028-02-29', days: 7 });
  });
});

describe('resolveComparison with an explicit second range', () => {
  const current = range('2026-10-23', '2026-10-29');

  test('an explicit second range of the same length is available', () => {
    const c = compare(current, range('2026-09-01', '2026-09-07'));
    expect(c.available).toBe(true);
    expect(c.sameLength).toBe(true);
    expect(c.unavailableReason).toBeNull();
  });

  test('another length is available and per day', () => {
    const c = compare(current, range('2026-09-01', '2026-09-03'));
    expect(c.available).toBe(true);
    expect(c.perDay).toBe(true);
    expect(c.sameLength).toBe(false);
    expect(c.unavailableReason).toBeNull();
    expect(c.previous.days).toBe(3);
  });

  test('the same length is not per day', () => {
    expect(compare(current, range('2026-09-01', '2026-09-07')).perDay).toBe(false);
  });

  test.each([
    ['wholly before', '2026-07-01', '2026-07-03'],
    ['wholly after', '2026-11-05', '2026-11-08'],
    ['straddling the start', '2026-08-30', '2026-09-02'],
    ['straddling the end', '2026-10-28', '2026-11-02'],
  ])('outside the data beats the length: %s', (_name, start, end) => {
    const c = compare(current, range(start, end));
    expect(c.available).toBe(false);
    expect(c.perDay).toBe(false);
    expect(c.unavailableReason).toMatch(/^No full previous period/);
  });

  test('the selected range itself is available, overlaps, and is not per day', () => {
    const c = compare(current, current);
    expect(c.available).toBe(true);
    expect(c.overlaps).toBe(true);
    expect(c.perDay).toBe(false);
  });

  test('a range that contains the selected range is per day and overlaps', () => {
    const c = compare(current, range('2026-10-01', '2026-10-29'));
    expect(c.available).toBe(true);
    expect(c.overlaps).toBe(true);
    expect(c.perDay).toBe(true);
  });

  test('a range later than the selected range is available', () => {
    const c = compare(range('2026-09-08', '2026-09-14'), range('2026-10-01', '2026-10-07'));
    expect(c.available).toBe(true);
    expect(c.overlaps).toBe(false);
    expect(c.perDay).toBe(false);
  });

  test('a one-day second range is available and per day', () => {
    const c = compare(current, range('2026-09-01', '2026-09-01'));
    expect(c.available).toBe(true);
    expect(c.perDay).toBe(true);
    expect(c.previous.days).toBe(1);
  });

  test('a range the data does not cover is reported as that, before the length', () => {
    const c = compare(current, range('2026-10-28', '2026-11-02')); // 6 days and past the data end
    expect(c.unavailableReason).toMatch(/^No full previous period/);
  });

  test('overlaps is true when the two ranges share a day, false when they merely touch', () => {
    expect(compare(current, range('2026-10-20', '2026-10-26')).overlaps).toBe(true);
    expect(compare(current, range('2026-10-16', '2026-10-22')).overlaps).toBe(false); // ends the day before
    expect(compare(current, current).overlaps).toBe(true);
    expect(compare(current).overlaps).toBe(false); // the default previous period never overlaps
  });

  test('an explicit second range running past the data end is unavailable', () => {
    const c = compare(current, range('2026-10-27', '2026-11-02'));
    expect(c.available).toBe(false);
    expect(c.unavailableReason).toContain('2026-10-29');
  });

  test('an explicit second range that is inverted or malformed is an error', () => {
    const inverted = resolveComparison(span, current, range('2026-09-10', '2026-09-09'));
    expect(inverted.ok === false && inverted.error.code).toBe('start_after_end');
    const malformed = resolveComparison(span, current, range('2026-02-30', '2026-03-01'));
    expect(malformed.ok === false && malformed.error.code).toBe('bad_date');
  });
});

describe('resolveComparison checks the current range too', () => {
  test('a malformed current range is an error, not a thrown exception', () => {
    const result = resolveComparison(span, range('', '2026-10-05'));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('bad_date');
  });

  test('an inverted current range names its own dates, not the derived previous period', () => {
    const result = resolveComparison(span, range('2026-10-05', '2026-10-01'));
    expect(!result.ok && result.error.code).toBe('start_after_end');
    const message = !result.ok ? result.error.message : '';
    expect(message).toContain('2026-10-05');
    expect(message).toContain('2026-10-01');
    expect(message).not.toContain('2026-10-08');
  });
});

describe('incompleteDays', () => {
  test('incompleteDays flags the first data day', () => {
    expect(incompleteDays(span, range('2026-10-23', '2026-10-29'))).toEqual({ includesFirstDay: false });
    expect(incompleteDays(span, span)).toEqual({ includesFirstDay: true });
    expect(incompleteDays(span, range('2026-09-10', '2026-09-16'))).toEqual({ includesFirstDay: false });
    expect(incompleteDays(span, range('2026-09-01', '2026-09-01'))).toEqual({ includesFirstDay: true });
  });
});

describe('outcomeLagApplies', () => {
  test('outcomeLagApplies compares the gap to the lag', () => {
    expect(outcomeLagApplies(span, range('2026-10-23', '2026-10-29'), 3)).toBe(true); // gap 0
    expect(outcomeLagApplies(span, range('2026-10-23', '2026-10-26'), 3)).toBe(true); // gap 3
    expect(outcomeLagApplies(span, range('2026-10-23', '2026-10-25'), 3)).toBe(false); // gap 4
    expect(outcomeLagApplies(span, range('2026-10-23', '2026-10-29'), 0)).toBe(false); // no lag measured
  });
});
