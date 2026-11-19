import { describe, expect, test } from 'vitest';
import { makeViewContext } from '../../../src/core/views/viewContext';
import { callAt, makeStore, range } from './fixtures';

const days = Array.from({ length: 14 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
const store = makeStore(
  days.map((d) => callAt(`${d}T16:00:00Z`)),
  { dataNotes: { outcomeLagDays: 3, badRows: 12 } },
);

describe('makeViewContext', () => {
  test('a range with an equal previous period gets a comparison', () => {
    const ctx = makeViewContext(store, range('2026-09-08', '2026-09-14'));
    expect(ctx.notes.comparison).toEqual({
      available: true,
      previous: { start: '2026-09-01', end: '2026-09-07' },
      reason: null,
      overlaps: false,
    });
    expect(ctx.previous?.map((c) => c.localDate)).toEqual(days.slice(0, 7));
    expect(ctx.current.map((c) => c.localDate)).toEqual(days.slice(7));
  });

  test('all data has no comparison', () => {
    const ctx = makeViewContext(store, range('2026-09-01', '2026-09-14'));
    expect(ctx.notes.comparison.available).toBe(false);
    expect(ctx.notes.comparison.previous).toEqual({ start: '2026-08-18', end: '2026-08-31' });
    expect(ctx.notes.comparison.reason).toMatch(/^No full previous period/);
    expect(ctx.previous).toBeNull();
    expect(ctx.notes.incompleteCurrent).toEqual({ includesFirstDay: true, includesLastDay: true });
    expect(ctx.notes.incompletePrevious).toEqual({ includesFirstDay: false, includesLastDay: false });
  });

  test('the caveat flags come from the store', () => {
    const ctx = makeViewContext(store, range('2026-09-08', '2026-09-14'));
    expect(ctx.notes.skippedRows).toBe(12);
    expect(ctx.notes.outcomeLag).toEqual({ days: 3, applies: true });
    expect(ctx.notes.asOf).toBe('2026-09-14');
    expect(ctx.notes.clamped).toBe(false);
    expect(makeViewContext(store, range('2026-09-01', '2026-09-07')).notes.outcomeLag.applies).toBe(false);
    expect(makeViewContext(store, { ...range('2026-09-08', '2026-09-14'), clamped: true }).notes.clamped).toBe(true);
  });

  test('an explicit second range is used', () => {
    const ctx = makeViewContext(store, range('2026-09-08', '2026-09-10'), { start: '2026-09-01', end: '2026-09-03' });
    expect(ctx.notes.comparison.available).toBe(true);
    expect(ctx.current.map((c) => c.localDate)).toEqual(days.slice(7, 10));
    expect(ctx.previous?.map((c) => c.localDate)).toEqual(days.slice(0, 3));
  });

  test('a malformed or inverted second range is not an error', () => {
    const ctx = makeViewContext(store, range('2026-09-08', '2026-09-14'), { start: '2026-02-30', end: '2026-03-02' });
    expect(ctx.notes.comparison.available).toBe(false);
    expect(ctx.notes.comparison.previous).toBeNull();
    expect(ctx.notes.comparison.reason).toContain('2026-02-30');
    expect(ctx.notes.incompletePrevious).toBeNull();
    expect(ctx.previous).toBeNull();
    const inverted = makeViewContext(store, range('2026-09-08', '2026-09-14'), { start: '2026-09-07', end: '2026-09-01' });
    expect(inverted.notes.comparison.available).toBe(false);
    expect(inverted.previous).toBeNull();
  });

  test('an unequal-length second range gives no comparison', () => {
    const ctx = makeViewContext(store, range('2026-09-08', '2026-09-14'), { start: '2026-09-01', end: '2026-09-03' });
    expect(ctx.notes.comparison.available).toBe(false);
    expect(ctx.notes.comparison.reason).toMatch(/^No like-for-like comparison/);
    expect(ctx.previous).toBeNull();
  });

  test('a store with no calls builds a context', () => {
    const ctx = makeViewContext(makeStore([]), range('2026-09-01', '2026-09-07'));
    expect(ctx.current).toEqual([]);
    expect(ctx.previous).toBeNull();
    expect(ctx.notes.asOf).toBe('2026-09-07');
    expect(ctx.notes.comparison.available).toBe(false);
  });

  test('calls are placed by local date, not UTC date', () => {
    const late = callAt('2026-09-11T02:00:00Z', { localDate: '2026-09-10' });
    const ctx = makeViewContext(makeStore([late]), range('2026-09-10', '2026-09-10'));
    expect(ctx.current).toEqual([late]);
  });
});
