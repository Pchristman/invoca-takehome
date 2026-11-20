import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { loadExport } from '../../src/core/loadExport';
import { readLoadedExport, readStore } from '../../src/db/read';
import { seedExport } from '../../src/db/seed';
import { callLine, csvTexts, memoryDb, messyTexts, noSource } from './helpers';

const seeded = (texts: ReturnType<typeof csvTexts>) => {
  const db = memoryDb();
  seedExport(db, loadExport(texts), noSource);
  return db;
};

const readFolder = (dir: string) => ({
  calls: readFileSync(join(dir, 'calls.csv'), 'utf8'),
  campaigns: readFileSync(join(dir, 'campaigns.csv'), 'utf8'),
  locations: readFileSync(join(dir, 'locations.csv'), 'utf8'),
});

describe('readStore', () => {
  it('round trip equals the CSV path on a hand-written messy export', () => {
    const texts = messyTexts();
    const store = readStore(seeded(texts));
    expect(store).toEqual(cleanExport(loadExport(texts)));
    // the fixture really does exercise the rules it claims to
    expect(store.dataNotes.tiedCalls).toBe(1);
    expect(store.dataNotes.badCalls).toBeGreaterThanOrEqual(3);
    expect(store.dataNotes.unattributedCalls).toBe(1);
    expect(store.dataNotes.revenueOnNonBookedCalls).toBe(1);
    expect(store.dataNotes.pendingCalls).toBeGreaterThanOrEqual(1);
    expect(store.dataNotes.unparseableUpdatedAt).toBeGreaterThanOrEqual(1);
    expect(store.dataNotes.unparseableEndedAt).toBeGreaterThanOrEqual(1);
  });

  it('empty values come back as empty values, not zero or missing', () => {
    const store = readStore(seeded(messyTexts()));
    const byId = (id: string) => store.calls.find((c) => c.callId === id)!;
    expect(byId('c_bookempty').revenueUsd).toBe(0);
    expect(byId('c_bookzero').revenueUsd).toBe(0);
    expect(store.dataNotes.bookedWithoutRevenueCalls).toBe(1); // the empty one only
    expect(byId('c_pending').callerHash).toBe('');
    expect(byId('c_unattr').trackingNumber).toBe('');
    expect(byId('c_unattr').campaignId).toBeNull();
    expect(store.campaigns[0]!.name).toBe(`O'Brien; DROP TABLE x -- "Café, Ltd"`);
  });

  it('a database seeded twice reads the same as seeded once', () => {
    const texts = messyTexts();
    const once = readStore(seeded(texts));
    const db = seeded(texts);
    seedExport(db, loadExport(texts), noSource);
    expect(readStore(db)).toEqual(once);
  });

  it('rows come back in file order across two seeds', () => {
    const first = [callLine({ call_id: 'c_3' }), callLine({ call_id: 'c_1' })];
    const db = seeded(csvTexts({ calls: first }));
    seedExport(db, loadExport(csvTexts({ calls: [...first, callLine({ call_id: 'c_2' })] })), noSource);
    expect(readStore(db).calls.map((c) => c.callId)).toEqual(['c_3', 'c_1', 'c_2']);
  });

  it('a newer version wins, across two seeds', () => {
    const old = callLine({ call_id: 'c_1', answered: 'true', outcome: '', updated_at: '2026-09-01T10:00:00Z' });
    const db = seeded(csvTexts({ calls: [old] }));
    const newer = callLine({ call_id: 'c_1', answered: 'true', outcome: 'booked', revenue_usd: '120', updated_at: '2026-09-02T10:00:00Z' });
    seedExport(db, loadExport(csvTexts({ calls: [old, newer] })), noSource);
    const store = readStore(db);
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0]).toMatchObject({ outcome: 'booked', revenueUsd: 120 });
    expect(store.dataNotes.duplicateRowsCollapsed).toBe(1);
  });

  it('a bad latest row after a good one makes the call bad, across two seeds', () => {
    const good = callLine({ call_id: 'c_1', updated_at: '2026-09-01T10:00:00Z' });
    const db = seeded(csvTexts({ calls: [good] }));
    const bad = callLine({ call_id: 'c_1', updated_at: '2026-09-02T10:00:00Z', location_id: 'loc_nope' });
    seedExport(db, loadExport(csvTexts({ calls: [good, bad] })), noSource);
    const store = readStore(db);
    expect(store.calls).toHaveLength(0);
    expect(store.dataNotes.badCallsByReason.unknown_location).toBe(1);
  });

  it('a database with no rows reads as zero calls with the note', () => {
    const db = seeded(csvTexts({ calls: [] }));
    const loaded = readLoadedExport(db);
    expect(loaded.notes).toEqual(['calls.csv is empty: starting with zero calls']);
    const store = readStore(db);
    expect(store.calls).toEqual([]);
    expect(store.dataNotes.notes).toContain('calls.csv is empty: starting with zero calls');
  });

  it.each([
    ['the shipped export', 'tests/fixtures/original-export'],
    ['the extended export', 'data/extended'],
  ])('%s: readStore equals cleanExport', (_name, dir) => {
    const texts = readFolder(dir);
    expect(readStore(seeded(texts))).toEqual(cleanExport(loadExport(texts)));
  });
});
