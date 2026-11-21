import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { incompleteDays, resolveComparison } from '../../src/core/comparison';
import { addDays } from '../../src/core/localDate';
import { buildMissedValueRates, estimateMissedCallValue } from '../../src/core/missedValue';
import { callsInRange, rate, tally } from '../../src/core/metrics';
import { dataSpan, resolveRange } from '../../src/core/ranges';
import type { RangeSpec } from '../../src/core/ranges';
import { callsPerWeek } from '../../src/core/weeks';
import { readExportFromDir } from '../../src/node/readDataDir';

const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'original-export');

// These catch regressions on the shipped export; they are not the rules (each rule has its own test).
describe('shipped export, ranges and metrics', () => {
  const store = cleanExport(readExportFromDir(FIXTURE_DIR));
  const span = dataSpan(store.calls)!;

  const resolve = (spec: RangeSpec) => {
    const result = resolveRange(span, spec);
    if (!result.ok) throw new Error(result.error.message);
    return result.range;
  };
  const all = resolve({ kind: 'preset', preset: 'all' });
  const last7 = resolve({ kind: 'preset', preset: 'last7' });
  const last28 = resolve({ kind: 'preset', preset: 'last28' });

  test('all data tallies to the known totals', () => {
    const total = tally(callsInRange(store.calls, all));
    expect(total.calls).toBe(5000);
    expect(total.bookings).toBe(1204);
    expect(total.revenueUsd).toBe(432894);
  });

  test('the answer rate and booking rate are fractions between 0 and 1', () => {
    const total = tally(callsInRange(store.calls, all));
    for (const value of [rate(total.answered, total.calls), rate(total.bookings, total.calls)]) {
      expect(value).not.toBeNull();
      expect(value!).toBeGreaterThan(0);
      expect(value!).toBeLessThan(1);
    }
  });

  test('last 28 days plus everything before it equals all data', () => {
    const recent = tally(callsInRange(store.calls, last28)).calls;
    const earlier = tally(callsInRange(store.calls, { start: span.start, end: addDays(last28.start, -1) })).calls;
    expect(recent + earlier).toBe(5000);
  });

  test('last 28 days has a full 28-day comparison; all data has none', () => {
    const last = resolveComparison(span, last28);
    expect(last.ok).toBe(true);
    expect(last.ok && last.comparison.available).toBe(true);
    expect(last.ok && last.comparison.previous.days).toBe(28);

    const everything = resolveComparison(span, all);
    expect(everything.ok).toBe(true); // an error result must not pass for "no comparison"
    expect(everything.ok && everything.comparison.available).toBe(false);
  });

  test('presets flag no incomplete day; all data flags only the first day', () => {
    expect(incompleteDays(span, last7)).toEqual({ includesFirstDay: false });
    expect(incompleteDays(span, all)).toEqual({ includesFirstDay: true });
  });

  test('the per-week counts for the whole range add up to its calls, and only the end weeks can be partial', () => {
    const weeks = callsPerWeek(store.calls, all, span);
    expect(weeks.reduce((sum, w) => sum + w.calls, 0)).toBe(5000);
    expect(weeks.filter((w) => w.partial).length).toBeLessThanOrEqual(2);
    expect(weeks.slice(1, -1).every((w) => !w.partial)).toBe(true);
  });

  test('missed-call rates run on the whole export', () => {
    const rates = buildMissedValueRates(store.calls);
    expect(rates.overall.bookings).toBe(1204);
    expect(rates.overall.revenueCents).toBe(43289400);

    const unattributed = store.calls.find((c) => c.unattributed)!;
    const value = estimateMissedCallValue(rates, unattributed);
    expect(Number.isFinite(value.valueUsd)).toBe(true);
    expect(value.valueUsd).toBeGreaterThanOrEqual(0);
  });
});
