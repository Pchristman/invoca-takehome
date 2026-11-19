import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { readExportFromDir } from '../../src/node/readDataDir';

const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'original-export');

// These catch regressions on the shipped export; they are not the rules (each rule has its own test).
describe('shipped export, cleaned', () => {
  const store = cleanExport(readExportFromDir(FIXTURE_DIR));
  const { dataNotes } = store;

  test('5,000 calls from 5,411 rows, none bad', () => {
    expect(store.calls).toHaveLength(5000);
    expect(dataNotes.rowsRead).toBe(5411);
    expect(dataNotes.callsAfterDedup).toBe(5000);
    expect(dataNotes.duplicateRowsCollapsed).toBe(411);
    expect(dataNotes.badCalls).toBe(0);
  });

  test('1,204 bookings and $432,894 revenue', () => {
    expect(store.calls.filter((c) => c.booked)).toHaveLength(1204);
    expect(store.calls.reduce((sum, c) => sum + c.revenueUsd, 0)).toBe(432894);
  });

  test('144 unattributed calls on 10 tracking numbers', () => {
    expect(dataNotes.unattributedCalls).toBe(144);
    expect(dataNotes.unattributedTrackingNumbers).toHaveLength(10);
    expect(dataNotes.unattributedTrackingNumbers.reduce((sum, t) => sum + t.calls, 0)).toBe(144);
  });

  test('41 pending calls, no ties, no revenue oddities', () => {
    expect(dataNotes.pendingCalls).toBe(41);
    expect(dataNotes.tiedCalls).toBe(0);
    expect(dataNotes.revenueOnNonBookedCalls).toBe(0);
    expect(dataNotes.bookedWithoutRevenueCalls).toBe(0);
  });

  test('outcome lag is 3 days (about 71.7 hours)', () => {
    expect(dataNotes.outcomeLagDays).toBe(3);
  });

  test('every call has a plausible local date and hour', () => {
    for (const call of store.calls) {
      expect(call.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(call.localHour).toBeGreaterThanOrEqual(0);
      expect(call.localHour).toBeLessThanOrEqual(23);
      expect(call.localWeekday).toBeGreaterThanOrEqual(0);
      expect(call.localWeekday).toBeLessThanOrEqual(6);
    }
  });
});
