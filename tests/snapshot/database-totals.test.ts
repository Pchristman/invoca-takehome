import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { snapshotId } from '../../src/ai/fromEnv';
import { cleanExport } from '../../src/core/clean';
import { loadExport } from '../../src/core/loadExport';
import type { CallStore } from '../../src/core/types';
import { readStore } from '../../src/db/read';
import { seedExport } from '../../src/db/seed';
import { createApp } from '../../src/server/app';
import { memoryDb, noSource } from '../db/helpers';
import { get } from '../server/helpers';
import { EXTENDED_TOTALS } from './extendedTotals';

function texts(dir: string) {
  return {
    calls: readFileSync(join(dir, 'calls.csv'), 'utf8'),
    campaigns: readFileSync(join(dir, 'campaigns.csv'), 'utf8'),
    locations: readFileSync(join(dir, 'locations.csv'), 'utf8'),
  };
}

const totals = (store: CallStore) => ({
  calls: store.calls.length,
  bookings: store.calls.filter((c) => c.booked).length,
  revenueUsd: Math.round(store.calls.reduce((sum, c) => sum + c.revenueUsd, 0)),
});

describe.each([
  ['shipped export', 'tests/fixtures/original-export', { calls: 5000, bookings: 1204, revenueUsd: 432894 }, 144],
  ['extended export', 'data/extended', { calls: EXTENDED_TOTALS.calls, bookings: EXTENDED_TOTALS.bookings, revenueUsd: EXTENDED_TOTALS.revenueUsd }, null],
])('%s through the database', (_name, dir, expected, unattributed) => {
  const csvStore = cleanExport(loadExport(texts(dir)));
  const db = memoryDb();
  seedExport(db, loadExport(texts(dir)), noSource);
  const dbStore = readStore(db);

  it('the store equals the CSV store, whole', () => {
    expect(dbStore).toEqual(csvStore);
  });

  it('the totals are the known ones', () => {
    expect(totals(dbStore)).toEqual(expected);
    if (unattributed !== null) expect(dbStore.dataNotes.unattributedCalls).toBe(unattributed);
  });

  it('the AI snapshot id is unchanged, so cached takeaways stay valid', () => {
    expect(snapshotId(dbStore)).toBe(snapshotId(csvStore));
  });

  it.each(['last7', 'last28', 'all'])('/api/overview?range=%s is the same JSON', async (range) => {
    const fromCsv = await get(createApp(csvStore), `/api/overview?range=${range}`);
    const fromDb = await get(createApp(dbStore), `/api/overview?range=${range}`);
    expect(fromDb.status).toBe(200);
    expect(fromDb.text).toBe(fromCsv.text);
  });
});
