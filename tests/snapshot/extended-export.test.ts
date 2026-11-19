import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeExtended } from '../../scripts/generate-extended';
import { cleanExport } from '../../src/core/clean';
import { resolveComparison } from '../../src/core/comparison';
import { callsInRange, changeInCount, estimatedSpend, revenuePerBudgetDollar, tally } from '../../src/core/metrics';
import { dataSpan, resolveRange } from '../../src/core/ranges';
import type { CleanCall } from '../../src/core/types';
import { inclusiveDays } from '../../src/core/localDate';
import { officeOutlier } from '../../src/core/ranking';
import { generateExtendedCalls } from '../../scripts/generate-extended';
import { readExportFromDir } from '../../src/node/readDataDir';

const ORIGINAL_DIR = join(__dirname, '..', 'fixtures', 'original-export');
const EXTENDED_DIR = join(__dirname, '..', '..', 'data', 'extended');
const text = (dir: string, file: string) => readFileSync(join(dir, file), 'utf8');

// Observed on the committed seed, recorded not derived. Best and worst campaign by revenue per budget dollar
// over all data are the same as in the original export (the planted patterns don't move them).
const OBSERVED = { bookings: 1470, revenueUsd: 531431, bestWorst: { best: 'cmp_11', worst: 'cmp_07' } };

const original = cleanExport(readExportFromDir(ORIGINAL_DIR));
const loadedExtended = readExportFromDir(EXTENDED_DIR);
const extended = cleanExport(loadedExtended);
const spanOf = (calls: readonly CleanCall[]) => dataSpan(calls)!;
const allOf = (calls: readonly CleanCall[]) => {
  const result = resolveRange(spanOf(calls), { kind: 'preset', preset: 'all' });
  if (!result.ok) throw new Error(result.error.message);
  return result.range;
};

/** Each office against all the others pooled, over the whole span, on answer rate and booking rate. */
function officeFlags(calls: readonly CleanCall[], locationIds: string[]) {
  const inRange = callsInRange(calls, allOf(calls));
  const total = tally(inRange);
  return Object.fromEntries(
    locationIds.map((id) => {
      const mine = tally(inRange.filter((c) => c.locationId === id));
      const rest = { calls: total.calls - mine.calls };
      const answer = officeOutlier(
        { successes: mine.answered, calls: mine.calls },
        { successes: total.answered - mine.answered, ...rest },
      );
      const booking = officeOutlier(
        { successes: mine.bookings, calls: mine.calls },
        { successes: total.bookings - mine.bookings, ...rest },
      );
      return [id, { answer, booking }];
    }),
  );
}

describe('extended export: the files', () => {
  it('regenerating from the seed gives the committed file', () => {
    const regenerated = generateExtendedCalls({
      calls: text(ORIGINAL_DIR, 'calls.csv'),
      campaigns: text(ORIGINAL_DIR, 'campaigns.csv'),
      locations: text(ORIGINAL_DIR, 'locations.csv'),
    });
    expect(regenerated).toBe(text(EXTENDED_DIR, 'calls.csv'));
  });

  it('writeExtended writes the same three files', () => {
    const out = mkdtempSync(join(tmpdir(), 'extended-'));
    writeExtended(ORIGINAL_DIR, out);
    for (const file of ['calls.csv', 'campaigns.csv', 'locations.csv']) expect(text(out, file)).toBe(text(EXTENDED_DIR, file));
  });

  it('the original export is untouched', () => {
    for (const file of ['calls.csv', 'campaigns.csv', 'locations.csv']) {
      expect(readFileSync(join(__dirname, '..', '..', file)).equals(readFileSync(join(ORIGINAL_DIR, file)))).toBe(true);
    }
    for (const file of ['campaigns.csv', 'locations.csv']) {
      expect(readFileSync(join(EXTENDED_DIR, file)).equals(readFileSync(join(ORIGINAL_DIR, file)))).toBe(true);
    }
    expect(text(EXTENDED_DIR, 'calls.csv').startsWith(text(ORIGINAL_DIR, 'calls.csv'))).toBe(true);
  });
});

describe('extended export: loads clean', () => {
  it('has no bad rows', () => {
    expect(Object.values(loadedExtended.badByReason).every((n) => n === 0)).toBe(true);
    expect(loadedExtended.referenceIssues).toEqual([]);
    expect(loadedExtended.unparseableUpdatedAt).toBe(0);
    expect(loadedExtended.unparseableEndedAt).toBe(0);
  });

  it('totals', () => {
    const notes = extended.dataNotes;
    expect(notes.rowsRead).toBe(6911);
    expect(extended.calls).toHaveLength(6400);
    expect(notes.callsAfterDedup).toBe(6400);
    expect(notes.duplicateRowsCollapsed).toBe(511);
    expect(notes.badCalls).toBe(0);
    expect(notes.unattributedCalls).toBe(174);
    expect(notes.unattributedTrackingNumbers.map((n) => n.trackingNumber).sort()).toEqual(
      original.dataNotes.unattributedTrackingNumbers.map((n) => n.trackingNumber).sort(),
    );
    expect(notes.unattributedTrackingNumbers).toHaveLength(10);
    expect(notes.pendingCalls).toBe(51);
    expect(notes.tiedCalls).toBe(0);
    expect(notes.revenueOnNonBookedCalls).toBe(0);
    expect(notes.bookedWithoutRevenueCalls).toBe(0);
    expect(notes.outcomeLagDays).toBe(3);

    // Observed values, recorded not derived: this is what the committed seed produces.
    const total = tally(callsInRange(extended.calls, allOf(extended.calls)));
    expect(total.bookings).toBe(OBSERVED.bookings);
    expect(total.revenueUsd).toBe(OBSERVED.revenueUsd);
    expect(total.bookings).toBeGreaterThanOrEqual(1204 + 72);
    expect(total.bookings).toBeLessThanOrEqual(1204 + 1400);
    expect(total.revenueUsd).toBeGreaterThan(432894);
  });

  it('the data span and as-of date do not move', () => {
    expect(spanOf(extended.calls)).toEqual(spanOf(original.calls));
  });
});

describe('extended export: Locations', () => {
  const ids = extended.locations.map((l) => l.id);
  const flags = officeFlags(extended.calls, ids);

  it('Canyon (loc_06) is flagged worse on answer rate, not on booking rate', () => {
    expect(flags.loc_06?.answer.flagged).toBe(true);
    expect(flags.loc_06?.answer.direction).toBe('worse');
    expect(flags.loc_06?.booking.flagged).toBe(false);
  });

  it('Riverside (loc_02) is flagged worse on booking rate, not on answer rate', () => {
    expect(flags.loc_02?.booking.flagged).toBe(true);
    expect(flags.loc_02?.booking.direction).toBe('worse');
    expect(flags.loc_02?.answer.flagged).toBe(false);
  });

  // Each office is tested against all the others pooled, and the planted offices pull that pooled rate down,
  // so a couple of ordinary offices can read as "better" (loc_04 on booking rate, loc_08 on answer rate).
  // Only "worse" is a planted problem, so that is what this pins. See DECISIONS.md.
  it('no other office is flagged worse on either', () => {
    for (const id of ids.filter((id) => id !== 'loc_06' && id !== 'loc_02')) {
      expect([id, flags[id]?.answer.direction !== 'worse', flags[id]?.booking.direction !== 'worse']).toEqual([id, true, true]);
    }
  });

  it("Canyon's busiest missed slot is on a weekday morning", () => {
    const slots = new Map<string, number>();
    for (const c of extended.calls.filter((c) => c.locationId === 'loc_06' && !c.answered)) {
      const key = `${c.localWeekday}/${c.localHour}`;
      slots.set(key, (slots.get(key) ?? 0) + 1);
    }
    const [top] = [...slots.entries()].sort((a, b) => b[1] - a[1]);
    const [weekday, hour] = (top?.[0] ?? '').split('/').map(Number) as [number, number];
    expect(weekday).toBeGreaterThanOrEqual(0);
    expect(weekday).toBeLessThanOrEqual(4);
    expect(hour).toBeGreaterThanOrEqual(9);
    expect(hour).toBeLessThanOrEqual(11);
  });

  it('the shipped export flags no office on answer rate or booking rate', () => {
    const shipped = officeFlags(original.calls, original.locations.map((l) => l.id));
    for (const [id, f] of Object.entries(shipped)) expect([id, f.answer.flagged, f.booking.flagged]).toEqual([id, false, false]);
  });
});

describe('extended export: Campaigns', () => {
  const span = spanOf(extended.calls);
  const last28 = resolveRange(span, { kind: 'preset', preset: 'last28' });
  if (!last28.ok) throw new Error(last28.error.message);
  const comparison = resolveComparison(span, last28.range);
  if (!comparison.ok || !comparison.comparison.available) throw new Error('no previous 28 days');
  const callsFor = (id: string, range: { start: string; end: string }) =>
    tally(callsInRange(extended.calls, range).filter((c) => c.campaignId === id)).calls;

  it('cmp_04 calls are at least 50% above the previous 28 days', () => {
    const change = changeInCount(callsFor('cmp_04', last28.range), callsFor('cmp_04', comparison.comparison.previous));
    expect(change.kind).toBe('percent');
    expect(change.kind === 'percent' && change.value).toBeGreaterThanOrEqual(50);
  });

  it('cmp_06 calls are at least 30% below the previous 28 days', () => {
    const change = changeInCount(callsFor('cmp_06', last28.range), callsFor('cmp_06', comparison.comparison.previous));
    expect(change.kind).toBe('percent');
    expect(change.kind === 'percent' && change.value).toBeLessThanOrEqual(-30);
  });

  // Plain clones and patterns A and B copy from every campaign, so cmp_06's bookings can grow; what pattern D
  // guarantees is a lower booking rate in the 28 days before the last 28.
  it('cmp_06 booking rate in the earlier 28 days is lower than in the original', () => {
    const range = comparison.comparison.previous;
    const bookingRate = (store: typeof extended) => {
      const mine = tally(callsInRange(store.calls, range).filter((c) => c.campaignId === 'cmp_06'));
      return mine.bookings / mine.calls;
    };
    expect(bookingRate(extended)).toBeLessThan(bookingRate(original));
  });

  it('best and worst campaign by revenue per budget dollar, over all data (recorded)', () => {
    const rank = (store: typeof extended) => {
      const range = allOf(store.calls);
      const days = inclusiveDays(range.start, range.end);
      return store.campaigns
        .map((camp) => {
          const mine = tally(callsInRange(store.calls, range).filter((c) => c.campaignId === camp.id));
          return { id: camp.id, value: revenuePerBudgetDollar(mine.revenueUsd, estimatedSpend(camp.dailyBudgetUsd, days)) };
        })
        .filter((row): row is { id: string; value: number } => row.value !== null)
        .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
    };
    const ranked = rank(extended);
    expect({ best: ranked[0]?.id, worst: ranked.at(-1)?.id }).toEqual(OBSERVED.bestWorst);
  });
});
