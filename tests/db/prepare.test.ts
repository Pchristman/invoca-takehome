import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { LoadError } from '../../src/core/errors';
import { loadExport } from '../../src/core/loadExport';
import { openDatabase } from '../../src/db/database';
import { loadStore } from '../../src/db/prepare';
import { seedExport } from '../../src/db/seed';
import { readExportFromDir } from '../../src/node/readDataDir';
import { tempDir } from '../server/helpers';
import { callLine, csvTexts } from './helpers';

/** Write the three CSVs into a new folder and return it. */
function writeFolder(texts: ReturnType<typeof csvTexts>, dir = join(tempDir(), 'data')): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'calls.csv'), texts.calls);
  writeFileSync(join(dir, 'campaigns.csv'), texts.campaigns);
  writeFileSync(join(dir, 'locations.csv'), texts.locations);
  return dir;
}

const oneCall = (id = 'c_1') => csvTexts({ calls: [callLine({ call_id: id })] });

/** Counts read from a closed file, read-only. */
function seedCount(file: string): number {
  const db = new DatabaseSync(file, { readOnly: true });
  const n = (db.prepare('SELECT COUNT(*) AS n FROM seeds').get() as { n: number }).n;
  db.close();
  return n;
}

describe('loadStore', () => {
  it(':memory: seeds from the folder and returns its store', () => {
    const dir = writeFolder(csvTexts({ calls: [callLine({ call_id: 'c_1' }), callLine({ call_id: 'c_2' })] }));
    const { store } = loadStore({ dbPath: ':memory:', dataDir: dir });
    expect(store).toEqual(cleanExport(readExportFromDir(dir)));
  });

  it('a missing file is created and seeded; a second load reads it without seeding', () => {
    const dir = writeFolder(oneCall());
    const file = join(tempDir(), 'sub', 'calls.db');
    const first = loadStore({ dbPath: file, dataDir: dir });
    expect(first.notices).toEqual([`Seeded ${file} from ${dir}: 1 calls.`]);
    const second = loadStore({ dbPath: file, dataDir: dir });
    expect(second.notices).toEqual([]);
    expect(second.store).toEqual(first.store);
    expect(seedCount(file)).toBe(1);
  });

  it('a later start sees rows seeded into the file after the first start', () => {
    const dir = writeFolder(oneCall('c_1'));
    const file = join(tempDir(), 'calls.db');
    loadStore({ dbPath: file, dataDir: dir });
    const db = openDatabase(file);
    seedExport(db, loadExport(csvTexts({ calls: [callLine({ call_id: 'c_1' }), callLine({ call_id: 'c_2' })] })), {
      label: 'later',
      hashes: { calls: 'x', campaigns: 'x', locations: 'x' },
    });
    db.close();
    expect(loadStore({ dbPath: file }).store.calls.map((c) => c.callId)).toEqual(['c_1', 'c_2']);
  });

  it('a zero-byte file is seeded', () => {
    const file = join(tempDir(), 'calls.db');
    writeFileSync(file, '');
    expect(loadStore({ dbPath: file, dataDir: writeFolder(oneCall()) }).store.calls).toHaveLength(1);
    expect(seedCount(file)).toBe(1);
  });

  it('a SQLite file with no tables is seeded', () => {
    const file = join(tempDir(), 'calls.db');
    const bare = new DatabaseSync(file);
    bare.exec('select 1');
    bare.close();
    expect(loadStore({ dbPath: file, dataDir: writeFolder(oneCall()) }).store.calls).toHaveLength(1);
    expect(seedCount(file)).toBe(1);
  });

  it('an export with zero calls seeds and serves zero calls with the note', () => {
    const file = join(tempDir(), 'calls.db');
    const { store } = loadStore({ dbPath: file, dataDir: writeFolder(csvTexts({ calls: [] })) });
    expect(store.calls).toEqual([]);
    expect(store.dataNotes.notes.join(' ')).toMatch(/zero calls/);
    expect(existsSync(file)).toBe(true);
  });

  it('a completely empty calls.csv acts as in the CSV path: zero calls, not an error', () => {
    const file = join(tempDir(), 'calls.db');
    const { store } = loadStore({ dbPath: file, dataDir: writeFolder({ ...oneCall(), calls: '' }) });
    expect(store.calls).toEqual([]);
    expect(store.dataNotes.notes.join(' ')).toMatch(/zero calls/);
  });

  it('a bad CSV on first seed leaves no database file behind', () => {
    const file = join(tempDir(), 'calls.db');
    const texts = { ...oneCall(), calls: 'call_id,started_at\nc_1,2026-09-01T00:00:00Z\n' };
    expect(() => loadStore({ dbPath: file, dataDir: writeFolder(texts) })).toThrow(/column/i);
    expect(existsSync(file)).toBe(false);
  });

  it('an existing database is not touched by a start, even with a broken data folder', () => {
    const file = join(tempDir(), 'calls.db');
    loadStore({ dbPath: file, dataDir: writeFolder(oneCall()) });
    const before = readFileSync(file);
    const broken = writeFolder({ ...oneCall(), calls: 'call_id\nc_9\n' });
    const { store, notices } = loadStore({ dbPath: file, dataDir: broken });
    expect(store.calls).toHaveLength(1);
    expect(notices).toHaveLength(1); // the stale warning, not an error
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it('a corrupt file is a LoadError and is not overwritten', () => {
    const file = join(tempDir(), 'calls.db');
    writeFileSync(file, 'hello, this is a csv');
    expect(() => loadStore({ dbPath: file, dataDir: writeFolder(oneCall()) })).toThrow(/not a valid SQLite/);
    expect(readFileSync(file, 'utf8')).toBe('hello, this is a csv');
  });

  it('an older-schema file is a LoadError and is not overwritten', () => {
    const file = join(tempDir(), 'calls.db');
    loadStore({ dbPath: file, dataDir: writeFolder(oneCall()) });
    const raw = new DatabaseSync(file);
    raw.exec('PRAGMA user_version = 0');
    raw.close();
    const before = readFileSync(file);
    expect(() => loadStore({ dbPath: file, dataDir: writeFolder(oneCall()) })).toThrow(/schema version 0/);
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it('an existing database with a missing data folder starts fine, with no warning', () => {
    const file = join(tempDir(), 'calls.db');
    loadStore({ dbPath: file, dataDir: writeFolder(oneCall()) });
    const { store, notices } = loadStore({ dbPath: file, dataDir: join(tempDir(), 'nowhere') });
    expect(store.calls).toHaveLength(1);
    expect(notices).toEqual([]);
  });

  it('no database and no data folder is the Data folder not found error, and creates nothing', () => {
    const file = join(tempDir(), 'calls.db');
    const missing = join(tempDir(), 'nowhere');
    expect(() => loadStore({ dbPath: file, dataDir: missing })).toThrow(/Data folder not found/);
    expect(existsSync(file)).toBe(false);
  });
});
