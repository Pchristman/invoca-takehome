import { describe, expect, test } from 'vitest';
import { buildCampaigns } from '../../../src/core/views/campaignsView';
import { makeViewContext } from '../../../src/core/views/viewContext';
import { callAt, makeStore, range } from './fixtures';

const days = Array.from({ length: 14 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
const store = makeStore(
  days.map((d) => callAt(`${d}T16:00:00Z`)),
  { dataNotes: { badRows: 12 } },
);

describe('makeViewContext', () => {
  test('a range with an equal previous period gets a comparison', () => {
    const ctx = makeViewContext(store, range('2026-09-08', '2026-09-14'));
    expect(ctx.notes.comparison).toEqual({
      available: true,
      previous: { start: '2026-09-01', end: '2026-09-07' },
      reason: null,
      overlaps: false,
      perDay: false,
      currentDays: 7,
      previousDays: 7,
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
    expect(ctx.notes.incompleteCurrent).toEqual({ includesFirstDay: true });
    expect(ctx.notes.incompletePrevious).toEqual({ includesFirstDay: false });
  });

  test('the caveat flags come from the store', () => {
    const ctx = makeViewContext(store, range('2026-09-08', '2026-09-14'));
    expect(ctx.notes.skippedRows).toBe(12);
    expect(ctx.notes.asOf).toBe('2026-09-14');
    expect(ctx.notes.clamped).toBe(false);
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

  test('an unequal-length second range is available and per day', () => {
    const ctx = makeViewContext(store, range('2026-09-08', '2026-09-14'), { start: '2026-09-01', end: '2026-09-03' });
    expect(ctx.notes.comparison.available).toBe(true);
    expect(ctx.notes.comparison.perDay).toBe(true);
    expect(ctx.notes.comparison.reason).toBeNull();
    expect(ctx.notes.comparison.currentDays).toBe(7);
    expect(ctx.notes.comparison.previousDays).toBe(3);
    expect(ctx.previous?.map((c) => c.localDate)).toEqual(days.slice(0, 3));
  });

  test('an unequal range outside the data gives the coverage reason', () => {
    const ctx = makeViewContext(store, range('2026-09-08', '2026-09-14'), { start: '2026-08-01', end: '2026-08-03' });
    expect(ctx.notes.comparison.available).toBe(false);
    expect(ctx.notes.comparison.perDay).toBe(false);
    expect(ctx.notes.comparison.reason).toMatch(/^No full previous period/);
    expect(ctx.notes.comparison.previousDays).toBe(3);
    expect(ctx.previous).toBeNull();
  });

  test('an unresolved second range has null previousDays', () => {
    const ctx = makeViewContext(store, range('2026-09-08', '2026-09-14'), { start: '2026-02-30', end: '2026-03-02' });
    expect(ctx.notes.comparison.perDay).toBe(false);
    expect(ctx.notes.comparison.previousDays).toBeNull();
    expect(ctx.notes.comparison.currentDays).toBe(7);
  });

  test('a store with no calls builds a context', () => {
    const ctx = makeViewContext(makeStore([]), range('2026-09-01', '2026-09-07'));
    expect(ctx.current).toEqual([]);
    expect(ctx.previous).toBeNull();
    expect(ctx.notes.asOf).toBe('2026-09-07');
    expect(ctx.notes.comparison.available).toBe(false);
  });

  test('a range whose days is not a positive integer, or whose start is after its end, throws', () => {
    const good = range('2026-09-08', '2026-09-14');
    expect(() => makeViewContext(store, { ...good, days: 0 })).toThrow(/days/);
    expect(() => makeViewContext(store, { ...good, days: -7 })).toThrow(/days/);
    expect(() => makeViewContext(store, { ...good, days: 2.5 })).toThrow(/days/);
    expect(() => makeViewContext(store, { ...good, start: '2026-09-14', end: '2026-09-08' })).toThrow(/start/);
  });

  test('every view builder inherits the guard (checked through buildCampaigns)', () => {
    const bad = { ...range('2026-09-08', '2026-09-14'), days: 0 };
    expect(() => buildCampaigns(store, bad)).toThrow(/days/);
  });

  test('calls are placed by local date, not UTC date', () => {
    const late = callAt('2026-09-11T02:00:00Z', { localDate: '2026-09-10' });
    const ctx = makeViewContext(makeStore([late]), range('2026-09-10', '2026-09-10'));
    expect(ctx.current).toEqual([late]);
  });
});
