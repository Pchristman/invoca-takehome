import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LoadError } from '../core/errors';
import { CHANNELS, OUTCOMES } from '../core/types';

/** Bump when a table changes. A file with another version is refused, never migrated or deleted. */
export const SCHEMA_VERSION = 2;

const IN_MEMORY = ':memory:';

const quoted = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');

/** The whole schema, created in one transaction. Every table is STRICT so a wrong type is an error, not a silent conversion. */
const SCHEMA = `
CREATE TABLE seeds (
  id INTEGER PRIMARY KEY,
  seeded_at TEXT NOT NULL,
  label TEXT NOT NULL,
  calls_sha256 TEXT NOT NULL,
  campaigns_sha256 TEXT NOT NULL,
  locations_sha256 TEXT NOT NULL,
  rows_read INTEGER NOT NULL
) STRICT;

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN (${quoted(CHANNELS)})),
  daily_budget_usd REAL
) STRICT;

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  timezone_valid INTEGER NOT NULL
) STRICT;

CREATE TABLE raw_calls (
  seq INTEGER PRIMARY KEY,
  row_key TEXT NOT NULL UNIQUE,
  seed_id INTEGER NOT NULL REFERENCES seeds (id),
  row_number INTEGER NOT NULL,
  call_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER NOT NULL,
  caller_hash TEXT NOT NULL,
  tracking_number TEXT NOT NULL,
  campaign_id TEXT,
  channel TEXT NOT NULL CHECK (channel IN (${quoted(CHANNELS)})),
  location_id TEXT NOT NULL,
  answered INTEGER NOT NULL,
  outcome TEXT CHECK (outcome IS NULL OR outcome IN (${quoted(OUTCOMES)})),
  revenue_usd REAL,
  agent_id TEXT,
  updated_at TEXT
) STRICT;

CREATE INDEX raw_calls_call_id ON raw_calls (call_id);

CREATE TABLE bad_rows (
  seq INTEGER PRIMARY KEY,
  row_key TEXT NOT NULL UNIQUE,
  seed_id INTEGER NOT NULL REFERENCES seeds (id),
  row_number INTEGER NOT NULL,
  call_id TEXT NOT NULL,
  updated_at TEXT,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL
) STRICT;

CREATE INDEX bad_rows_call_id ON bad_rows (call_id);

CREATE TABLE reference_issues (
  id INTEGER PRIMARY KEY,
  seed_id INTEGER NOT NULL REFERENCES seeds (id),
  file TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL,
  UNIQUE (file, row_number, reason, detail)
) STRICT;
`;

const notSqlite = (path: string) =>
  new LoadError(`Cannot read the database ${path}: it is not a valid SQLite file. Move it aside and restart to build a new one from the CSVs.`);
const damaged = (path: string, detail: string) =>
  new LoadError(`The database ${path} is damaged (${detail}). Move it aside and restart to build a new one from the CSVs.`);

/**
 * Turn a node:sqlite error into a LoadError that says what really happened. Only a file that is not SQLite or is
 * corrupt is called that; a locked, unreadable or read-only file must never tell the user to move it aside, because
 * the next start would then build a new database and hide what the old one holds.
 */
export function convertDatabaseError(path: string, error: unknown): LoadError {
  if (error instanceof LoadError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  const code = ((error as { errcode?: number }).errcode ?? 0) & 0xff; // the low byte is the main result code
  if (code === 26 || /not a database/i.test(detail)) return notSqlite(path);
  if (code === 5 || code === 6) return new LoadError(`The database ${path} is in use by another process (${detail}). Stop whatever is using it and try again.`);
  if (code === 14) return new LoadError(`Cannot open the database ${path}: ${detail}. Check that the path is a file this app may read and write.`);
  if (code === 8) return new LoadError(`The database ${path} is read-only (${detail}). Check the file's permissions.`);
  if (code === 11 || /malformed/i.test(detail)) return damaged(path, detail);
  return new LoadError(`Cannot use the database ${path}: ${detail}.`);
}

/** True when the path is a regular file with no bytes, or does not exist: nothing here to protect, and a file this run would create. */
export function startsEmpty(path: string): boolean {
  if (!existsSync(path)) return true;
  const info = statSync(path);
  return info.isFile() && info.size === 0;
}

/** Remove a file this run created after a failed seed. Never throws, so it cannot hide the error that caused it. */
export function removeQuietly(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // leave it; the original error is the one to report
  }
}

function hasNothing(db: DatabaseSync, version: number): boolean {
  if (version !== 0) return false;
  const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number };
  return tables.n === 0;
}

function createSchema(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    // Another process may have filled it between our check and the lock.
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (hasNothing(db, version)) {
      db.exec(SCHEMA);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK'); // SQLite may already have rolled back
    throw error;
  }
}

function checkVersion(path: string, version: number): void {
  if (version > SCHEMA_VERSION) {
    throw new LoadError(`The database ${path} was made by a newer version of this app (schema version ${version}). Use that version, or move the file aside.`);
  }
  if (version < SCHEMA_VERSION) {
    throw new LoadError(
      `The database ${path} has schema version ${version}; this app needs ${SCHEMA_VERSION}. Move or delete the file, then run "npm run seed" (or restart) to build a new one.`,
    );
  }
}

function checkIntegrity(db: DatabaseSync, path: string): void {
  const rows = db.prepare('PRAGMA quick_check').all() as { quick_check: string }[];
  const problems = rows.map((r) => r.quick_check).filter((m) => m !== 'ok');
  if (problems.length > 0) throw damaged(path, problems[0]!);
}

function open(path: string, create: boolean): DatabaseSync {
  if (path !== IN_MEMORY) {
    if (!existsSync(path) && !create) throw new LoadError(`Database not found: ${path}`);
    if (startsEmpty(path) && !create) throw new LoadError(`The database ${path} is empty. Run "npm run seed" to fill it.`);
  } else if (!create) {
    throw new LoadError(`Database not found: ${path}`);
  }

  let db: DatabaseSync | undefined;
  try {
    if (create && path !== IN_MEMORY) mkdirSync(dirname(path), { recursive: true });
    db = new DatabaseSync(path);
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (hasNothing(db, version)) {
      if (!create) throw new LoadError(`The database ${path} is empty. Run "npm run seed" to fill it.`);
      createSchema(db);
      return db;
    }
    checkVersion(path, version);
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'seeds'").get()) {
      throw new LoadError(`The database ${path} has this app's schema version but not its tables. Move or delete the file, then run "npm run seed" (or restart) to build a new one.`);
    }
    checkIntegrity(db, path);
    return db;
  } catch (error) {
    try {
      db?.close(); // an open handle would lock the file on Windows
    } catch {
      // already closed or never opened
    }
    throw convertDatabaseError(path, error);
  }
}

/** Open for seeding: creates the file and schema when there is nothing in it. A file with data must pass the version and integrity checks. */
export function openDatabase(path: string): DatabaseSync {
  return open(path, true);
}

/** Open for reading: a missing or empty file is a LoadError, never created. */
export function openExistingDatabase(path: string): DatabaseSync {
  return open(path, false);
}

/**
 * True when there is nothing in the file to protect: it is missing, has zero bytes, is a valid SQLite file with no
 * tables, or has the schema but no seed ever completed (a first seed that failed). A directory or anything else
 * is left for the real open to report.
 */
export function holdsNothing(path: string): boolean {
  if (path === IN_MEMORY || !existsSync(path)) return true;
  const info = statSync(path);
  if (!info.isFile()) return false;
  if (info.size === 0) return true;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (hasNothing(db, version)) return true;
    if (version !== SCHEMA_VERSION) return false;
    return (db.prepare('SELECT COUNT(*) AS n FROM seeds').get() as { n: number }).n === 0;
  } catch {
    return false; // not SQLite or damaged: the real open reports it
  } finally {
    db?.close();
  }
}
