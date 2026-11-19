import { describe, expect, test } from 'vitest';
import { dataSpan, resolveRange } from '../../src/core/ranges';
import type { RangeResult, RangeSpec } from '../../src/core/ranges';
import { makeCall } from './helpers';

const span = { start: '2026-09-01', end: '2026-10-29' }; // 59 days

const custom = (start: string, end: string): RangeSpec => ({ kind: 'custom', start, end });
const preset = (name: 'last7' | 'last28' | 'all'): RangeSpec => ({ kind: 'preset', preset: name });

/** The resolved range, failing the test if resolving was rejected. */
const ok = (result: RangeResult) => {
  if (!result.ok) throw new Error(`expected a range, got ${result.error.code}: ${result.error.message}`);
  return result.range;
};
const err = (result: RangeResult) => {
  if (result.ok) throw new Error('expected an error, got a range');
  return result.error;
};

describe('dataSpan', () => {
  test('dataSpan is the min and max local date', () => {
    const calls = ['2026-10-02', '2026-09-01', '2026-10-29'].map((localDate) => makeCall({ localDate }));
    expect(dataSpan(calls)).toEqual(span);
  });

  test('dataSpan uses the local date, not the UTC date', () => {
    const call = makeCall({ startedAt: new Date('2026-10-30T02:00:00Z'), localDate: '2026-10-29' });
    expect(dataSpan([call])?.end).toBe('2026-10-29');
  });

  test('dataSpan of no calls is null', () => {
    expect(dataSpan([])).toBeNull();
  });
});

describe('resolveRange presets', () => {
  test('presets end on the as-of date', () => {
    expect(ok(resolveRange(span, preset('last7')))).toEqual({
      start: '2026-10-23',
      end: '2026-10-29',
      days: 7,
      clamped: false,
    });
    const last28 = ok(resolveRange(span, preset('last28')));
    expect(last28.start).toBe('2026-10-02');
    expect(last28.days).toBe(28);
    expect(ok(resolveRange(span, preset('all')))).toEqual({ ...span, days: 59, clamped: false });
  });

  test('a preset longer than the data is clamped', () => {
    const short = { start: '2026-10-27', end: '2026-10-29' };
    for (const name of ['last7', 'last28'] as const) {
      expect(ok(resolveRange(short, preset(name)))).toEqual({ ...short, days: 3, clamped: true });
    }
    expect(ok(resolveRange(short, preset('all'))).clamped).toBe(false);
  });
});

describe('resolveRange custom', () => {
  test('a custom range is inclusive at both ends', () => {
    expect(ok(resolveRange(span, custom('2026-09-10', '2026-09-16'))).days).toBe(7);
    const whole = ok(resolveRange(span, custom(span.start, span.end)));
    expect(whole.days).toBe(59);
    expect(whole.clamped).toBe(false);
  });

  test('a one-day range is valid', () => {
    expect(ok(resolveRange(span, custom('2026-09-10', '2026-09-10'))).days).toBe(1);
  });

  test('a custom range partly outside the data is clamped', () => {
    expect(ok(resolveRange(span, custom('2026-08-20', '2026-09-05')))).toEqual({
      start: '2026-09-01',
      end: '2026-09-05',
      days: 5,
      clamped: true,
    });
    expect(ok(resolveRange(span, custom('2026-10-25', '2026-11-10')))).toMatchObject({
      start: '2026-10-25',
      end: '2026-10-29',
      clamped: true,
    });
    expect(ok(resolveRange(span, custom('2026-08-01', '2026-12-01')))).toEqual({ ...span, days: 59, clamped: true });
  });

  test('a range wholly outside the data is rejected', () => {
    for (const [start, end] of [
      ['2026-08-01', '2026-08-31'],
      ['2026-10-30', '2026-11-05'],
    ] as const) {
      const error = err(resolveRange(span, custom(start, end)));
      expect(error.code).toBe('outside_data');
      expect(error.message).toContain('2026-09-01');
      expect(error.message).toContain('2026-10-29');
    }
  });

  test('start after end is rejected, even when also outside the data', () => {
    for (const [start, end] of [
      ['2026-09-10', '2026-09-09'],
      ['2026-12-01', '2026-11-01'],
    ] as const) {
      const error = err(resolveRange(span, custom(start, end)));
      expect(error.code).toBe('start_after_end');
      expect(error.message).toContain(start);
      expect(error.message).toContain(end);
    }
  });

  test.each(['2026-02-30', '2026-9-1', '', 'yesterday'])('impossible or malformed date %j is rejected by name', (bad) => {
    for (const spec of [custom(bad, '2026-09-16'), custom('2026-09-10', bad)]) {
      const error = err(resolveRange(span, spec));
      expect(error.code).toBe('bad_date');
      expect(error.message.startsWith(`"${bad}" is not a date`)).toBe(true);
    }
  });

  test('a bad date says whether it is the start or the end', () => {
    expect(err(resolveRange(span, custom('nope', '2026-09-16'))).field).toBe('start');
    expect(err(resolveRange(span, custom('2026-09-10', 'nope'))).field).toBe('end');
  });

  test('a very long bad value is shortened in the message', () => {
    const error = err(resolveRange(span, custom('9'.repeat(500), '2026-09-16')));
    expect(error.code).toBe('bad_date');
    expect(error.message.length).toBeLessThan(150);
  });
});

describe('resolveRange with no data', () => {
  test('no data rejects every spec', () => {
    for (const spec of [preset('last7'), preset('all'), custom('2026-09-10', '2026-09-16')]) {
      expect(err(resolveRange(null, spec)).code).toBe('no_data');
    }
  });
});
