import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { createAiFromEnv, snapshotId } from '../../src/ai/fromEnv';
import { cleanExport } from '../../src/core/clean';
import { loadExport } from '../../src/core/loadExport';
import type { CallStore } from '../../src/core/types';
import { createMemoryHandle } from '../../src/db/handle';
import { seedFromTexts } from '../../src/db/prepare';
import { readStore } from '../../src/db/read';
import { createUploadService } from '../../src/db/upload/service';
import type { UploadCommitResponse } from '../../src/server/api';
import { createApp } from '../../src/server/app';
import { memoryDb } from '../db/helpers';
import { FakeModel, textReply } from '../ai/fakeModel';
import { get, tempDir } from '../server/helpers';
import { EXTENDED_TOTALS } from './extendedTotals';

const SHIPPED_DIR = 'tests/fixtures/original-export';
const EXTENDED_DIR = 'data/extended';

interface Texts {
  calls: string;
  campaigns: string;
  locations: string;
}

const texts = (dir: string): Texts => ({
  calls: readFileSync(join(dir, 'calls.csv'), 'utf8'),
  campaigns: readFileSync(join(dir, 'campaigns.csv'), 'utf8'),
  locations: readFileSync(join(dir, 'locations.csv'), 'utf8'),
});

const SHIPPED = texts(SHIPPED_DIR);
const EXTENDED = texts(EXTENDED_DIR);

const totals = (store: CallStore) => ({
  calls: store.calls.length,
  bookings: store.calls.filter((c) => c.booked).length,
  revenueUsd: Math.round(store.calls.reduce((sum, c) => sum + c.revenueUsd, 0)),
});

const SHIPPED_TOTALS = { calls: 5000, bookings: 1204, revenueUsd: 432894 };
const EXTENDED_SUMMARY = { calls: EXTENDED_TOTALS.calls, bookings: EXTENDED_TOTALS.bookings, revenueUsd: EXTENDED_TOTALS.revenueUsd };

const openHandles: { close: () => void }[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const h of openHandles.splice(0)) h.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** An in-memory database seeded from the three texts, and the server over it, with the upload routes on. */
function serverSeededWith(seed: Texts, options: { rebuildAi?: (store: CallStore) => ReturnType<typeof createAiFromEnv>; ai?: ReturnType<typeof createAiFromEnv> } = {}) {
  const db = memoryDb();
  seedFromTexts(db, { folder: 'test', ...seed });
  const store = readStore(db);
  const handle = createMemoryHandle(db);
  openHandles.push(handle);
  const app = createApp(store, { uploads: createUploadService(handle), ...options });
  return { app, store, db };
}

async function upload(app: Hono, name: string, text: string): Promise<UploadCommitResponse> {
  const form = new FormData();
  form.append('file', new File([text], name, { type: 'text/csv' }));
  const r = await get(app, '/api/upload/commit', { method: 'POST', body: form });
  expect(r.status, r.text.slice(0, 300)).toBe(200);
  return r.json as UploadCommitResponse;
}

const csvStoreOf = (t: Texts) => cleanExport(loadExport(t));
const storeNow = async (app: Hono) => (await get(app, '/api/meta')).json as { callCount: number };

describe('the shipped export, uploaded into a database seeded from it', () => {
  it('imports nothing and reports every row as a duplicate', async () => {
    const { app } = serverSeededWith(SHIPPED);
    const r = await upload(app, 'calls.csv', SHIPPED.calls);
    expect(r.written).toBe(0);
    expect(r.preview.counts).toEqual({ rowsRead: 5411, duplicates: 5411, newRows: 0, newVersions: 0, conflicts: 0, bad: 0 });
    const overview = (await get(app, '/api/overview?range=all')).text;
    expect(overview).toBe((await get(createApp(csvStoreOf(SHIPPED)), '/api/overview?range=all')).text);
    expect((await storeNow(app)).callCount).toBe(SHIPPED_TOTALS.calls);
  });

  it('leaves the store with the known totals', () => {
    const { store } = serverSeededWith(SHIPPED);
    expect(totals(store)).toEqual(SHIPPED_TOTALS);
    expect(store.dataNotes.unattributedCalls).toBe(144);
  });

  it('campaigns.csv and locations.csv are all duplicates (12 and 8 rows)', async () => {
    const { app } = serverSeededWith(SHIPPED);
    const campaigns = await upload(app, 'campaigns.csv', SHIPPED.campaigns);
    expect(campaigns.written).toBe(0);
    expect(campaigns.preview.counts).toMatchObject({ rowsRead: 12, duplicates: 12, newRows: 0, conflicts: 0, bad: 0 });
    const locations = await upload(app, 'locations.csv', SHIPPED.locations);
    expect(locations.written).toBe(0);
    expect(locations.preview.counts).toMatchObject({ rowsRead: 8, duplicates: 8, newRows: 0, conflicts: 0, bad: 0 });
  });
});

describe('the extended export, uploaded into a database seeded from it', () => {
  it('imports nothing and reports every row as a duplicate', async () => {
    const { app, store } = serverSeededWith(EXTENDED);
    const r = await upload(app, 'calls.csv', EXTENDED.calls);
    expect(r.written).toBe(0);
    expect(r.preview.counts).toEqual({ rowsRead: 6911, duplicates: 6911, newRows: 0, newVersions: 0, conflicts: 0, bad: 0 });
    expect(totals(store)).toEqual(EXTENDED_SUMMARY);
    expect((await storeNow(app)).callCount).toBe(EXTENDED_TOTALS.calls);
  });
});

describe('the extended calls.csv uploaded into a database seeded from the shipped export', () => {
  async function afterUpload() {
    const server = serverSeededWith(SHIPPED);
    const result = await upload(server.app, 'calls.csv', EXTENDED.calls);
    return { ...server, result };
  }

  it('adds the new rows and the new versions, and the totals equal the extended export', async () => {
    const { result, app } = await afterUpload();
    const c = result.preview.counts;
    expect(c.rowsRead).toBe(6911);
    expect(c.duplicates).toBe(5411);
    expect(c.newRows + c.newVersions + c.duplicates).toBe(6911);
    expect(c.conflicts + c.bad).toBe(0);
    expect(result.written).toBe(c.newRows + c.newVersions);
    expect((await storeNow(app)).callCount).toBe(EXTENDED_TOTALS.calls);
  });

  it('reads back as exactly what loading the extended export gives, field for field', async () => {
    const { db } = await afterUpload();
    expect(totals(readStore(db))).toEqual(EXTENDED_SUMMARY);
    expect(readStore(db)).toEqual(csvStoreOf(EXTENDED));
  });

  it.each(['last7', 'last28', 'all'])('every view (%s) is the same JSON as a server built from the extended export', async (range) => {
    const { app } = await afterUpload();
    const reference = createApp(csvStoreOf(EXTENDED));
    for (const path of ['overview', 'campaigns', 'locations', 'missed-calls']) {
      const url = `/api/${path}?range=${range}`;
      const mine = await get(app, url);
      expect(mine.status, url).toBe(200);
      expect(mine.text, url).toBe((await get(reference, url)).text);
    }
  });

  it('the same file uploaded again imports nothing', async () => {
    const { app } = await afterUpload();
    const again = await upload(app, 'calls.csv', EXTENDED.calls);
    expect(again.written).toBe(0);
    expect(again.preview.counts).toMatchObject({ rowsRead: 6911, duplicates: 6911, newRows: 0, newVersions: 0 });
    expect((await storeNow(app)).callCount).toBe(EXTENDED_TOTALS.calls);
  });

  it('a file with another column order, an extra column, a BOM and CRLF imports the same rows', async () => {
    const [header, ...rows] = EXTENDED.calls.trimEnd().split(/\r?\n/);
    const columns = header!.split(',');
    const order = [...columns.keys()].reverse();
    const rewritten = [
      [...order.map((i) => columns[i]), 'note'].join(','),
      ...rows.map((row) => {
        const cells = row.split(',');
        return [...order.map((i) => cells[i]), 'extra'].join(',');
      }),
    ];
    const text = '﻿' + rewritten.join('\r\n') + '\r\n';
    const plain = await afterUpload();
    const server = serverSeededWith(SHIPPED);
    const r = await upload(server.app, 'reordered.csv', text);
    expect(r.preview.counts).toEqual(plain.result.preview.counts);
    expect(r.written).toBe(plain.result.written);
    expect(readStore(server.db)).toEqual(readStore(plain.db));
  });
});

describe('the AI snapshot id follows the upload', () => {
  it('changes, matches the extended export, and a takeaway for the old data is asked for again', async () => {
    const dir = tempDir();
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    const cachePath = join(dir, 'takeaways.json');

    // One real fact key from the overview's own sheet, so the model's reply holds only a placeholder.
    const probe = createApp(csvStoreOf(SHIPPED));
    const sheet = ((await get(probe, '/api/overview')).json as { factSheet: { facts: Record<string, unknown> } }).factSheet;
    const key = Object.keys(sheet.facts)[0]!;

    const model = new FakeModel(textReply(`Look at {${key}}.`));
    const env = { ANTHROPIC_API_KEY: 'test-key' };
    const build = (store: CallStore) => createAiFromEnv(store, env, { model, cachePath, logPath: null });
    const shippedStore = csvStoreOf(SHIPPED);
    const server = serverSeededWith(SHIPPED, { ai: build(shippedStore), rebuildAi: build });

    const before = snapshotId(server.store);
    await get(server.app, '/api/takeaway/overview');
    await get(server.app, '/api/takeaway/overview');
    expect(model.calls).toBe(1); // the repeat was a cache hit

    await upload(server.app, 'calls.csv', EXTENDED.calls);
    const after = snapshotId(readStore(server.db));
    expect(after).not.toBe(before);
    expect(after).toBe(snapshotId(csvStoreOf(EXTENDED)));

    const answered = await get(server.app, '/api/takeaway/overview');
    expect(answered.status).toBe(200);
    expect(model.calls).toBe(2); // not reused from the cache
  });
});
