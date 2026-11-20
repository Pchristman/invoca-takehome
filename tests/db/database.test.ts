import { appendFileSync, existsSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { LoadError } from '../../src/core/errors';
import { openDatabase, openExistingDatabase, SCHEMA_VERSION } from '../../src/db/database';
import { tempDir } from '../server/helpers';

const TABLES = ['bad_rows', 'campaigns', 'cleaned_calls', 'locations', 'raw_calls', 'reference_issues', 'seeds'];

function tableNames(db: DatabaseSync): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
  return rows.map((r) => r.name);
}

function userVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

/** Make a seeded-looking file: schema plus a few rows, closed again. */
function makeFile(dir: string): string {
  const file = join(dir, 'calls.db');
  const db = openDatabase(file);
  db.exec(`INSERT INTO seeds (seeded_at, label, calls_sha256, campaigns_sha256, locations_sha256, rows_read) VALUES ('2026-01-01T00:00:00.000Z', 'x', '', '', '', 0)`);
  const insert = db.prepare(`INSERT INTO campaigns (id, name, channel, daily_budget_usd) VALUES (?, ?, 'social', 1.5)`);
  for (let i = 0; i < 400; i++) insert.run(`cmp_${i}`, `Campaign number ${i} with a long enough name to fill pages`);
  db.close();
  return file;
}

describe('driver: node:sqlite does the job on this Node', () => {
  it('round-trips values, rolls back, enforces UNIQUE, keeps user_version, and releases a file on close', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (n INTEGER, r REAL, s TEXT, z TEXT, u TEXT UNIQUE) STRICT');
    const name = `O'B"r;ien é-x`;
    db.prepare('INSERT INTO t (n, r, s, z, u) VALUES (?, ?, ?, ?, ?)').run(0, 0.1, '', null, name);
    const row = db.prepare('SELECT * FROM t').get() as Record<string, unknown>;
    expect(row).toMatchObject({ n: 0, r: 0.1, s: '', z: null, u: name });

    expect(() => {
      db.exec('BEGIN');
      db.prepare('INSERT INTO t (n, r, s, u) VALUES (1, 1, ?, ?)').run('a', 'other');
      throw new Error('boom');
    }).toThrow('boom');
    db.exec('ROLLBACK');
    expect((db.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }).c).toBe(1);

    expect(() => db.prepare('INSERT INTO t (n, r, s, u) VALUES (2, 2, ?, ?)').run('b', name)).toThrow();
    expect((db.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }).c).toBe(1);

    db.exec('PRAGMA user_version = 7');
    expect(userVersion(db)).toBe(7);
    db.close();

    const file = join(tempDir(), 'x.db');
    const onDisk = new DatabaseSync(file);
    onDisk.exec('CREATE TABLE a (b TEXT) STRICT');
    onDisk.close();
    rmSync(file);
    expect(existsSync(file)).toBe(false);
  });
});

describe('openDatabase', () => {
  it('an in-memory database has all seven tables and the schema version', () => {
    const db = openDatabase(':memory:');
    expect(tableNames(db)).toEqual(TABLES);
    expect(userVersion(db)).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('a zero-byte file is treated as empty and seeded with the schema', () => {
    const file = join(tempDir(), 'calls.db');
    writeFileSync(file, '');
    const db = openDatabase(file);
    expect(tableNames(db)).toEqual(TABLES);
    expect(userVersion(db)).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('a valid SQLite file with no tables is treated as empty', () => {
    const file = join(tempDir(), 'calls.db');
    const bare = new DatabaseSync(file);
    bare.exec('select 1');
    bare.close();
    const db = openDatabase(file);
    expect(tableNames(db)).toEqual(TABLES);
    db.close();
  });

  it('creates the parent folder', () => {
    const file = join(tempDir(), 'a', 'b', 'calls.db');
    const db = openDatabase(file);
    expect(existsSync(file)).toBe(true);
    db.close();
  });

  it('reopens a seeded file without changing it', () => {
    const file = makeFile(tempDir());
    const before = readFileSync(file);
    const db = openDatabase(file);
    expect((db.prepare('SELECT COUNT(*) AS c FROM campaigns').get() as { c: number }).c).toBe(400);
    db.close();
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it('a file that is not SQLite is a LoadError and is left unchanged', () => {
    const file = join(tempDir(), 'calls.db');
    writeFileSync(file, 'hello, this is a csv');
    expect(() => openDatabase(file)).toThrow(LoadError);
    expect(() => openDatabase(file)).toThrow(/not a valid SQLite/);
    expect(readFileSync(file, 'utf8')).toBe('hello, this is a csv');
  });

  it('an older schema says the version, to move the file, and to reseed', () => {
    const file = makeFile(tempDir());
    const raw = new DatabaseSync(file);
    raw.exec('PRAGMA user_version = 0');
    raw.close();
    const before = readFileSync(file);
    const attempt = () => openDatabase(file);
    expect(attempt).toThrow(LoadError);
    expect(attempt).toThrow(/schema version 0/);
    expect(attempt).toThrow(/move|delete/i);
    expect(attempt).toThrow(/reseed|npm run seed/);
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it('a newer schema is refused', () => {
    const file = makeFile(tempDir());
    const raw = new DatabaseSync(file);
    raw.exec('PRAGMA user_version = 99');
    raw.close();
    expect(() => openDatabase(file)).toThrow(/newer version/);
  });

  it('a damaged file is a LoadError that says damaged', () => {
    const file = makeFile(tempDir());
    const bytes = readFileSync(file);
    const page = 4096;
    // flip the middle of the second page onwards, then truncate if that did not trip quick_check
    for (let i = page + 100; i < page * 2 && i < bytes.length; i++) bytes[i] = bytes[i]! ^ 0xff;
    writeFileSync(file, bytes);
    try {
      openDatabase(file).close();
    } catch {
      expect(() => openDatabase(file)).toThrow(/damaged|not a valid SQLite/);
      return;
    }
    // quick_check did not notice: truncate to half instead
    truncateSync(file, Math.floor(statSync(file).size / 2));
    appendFileSync(file, '');
    expect(() => openDatabase(file)).toThrow(/damaged/);
  });
});

describe('openExistingDatabase', () => {
  it('a missing path is "not found" and creates nothing', () => {
    const file = join(tempDir(), 'sub', 'calls.db');
    expect(() => openExistingDatabase(file)).toThrow(LoadError);
    expect(() => openExistingDatabase(file)).toThrow(/not found/);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(join(file, '..'))).toBe(false);
  });

  it('an empty file is a LoadError, not created into a database', () => {
    const file = join(tempDir(), 'calls.db');
    writeFileSync(file, '');
    expect(() => openExistingDatabase(file)).toThrow(LoadError);
    expect(statSync(file).size).toBe(0);
  });

  it('opens a seeded file', () => {
    const file = makeFile(tempDir());
    const db = openExistingDatabase(file);
    expect(userVersion(db)).toBe(SCHEMA_VERSION);
    db.close();
  });
});
