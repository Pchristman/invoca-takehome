import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LoadError } from '../core/errors';
import { CHANNELS, OUTCOMES } from '../core/types';

/** Bump when a table changes. A file with another version is refused, never migrated or deleted. */
export const SCHEMA_VERSION = 1;

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
  daily_budget_usd REAL NOT NULL
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

CREATE TABLE reference_issues (
  id INTEGER PRIMARY KEY,
  seed_id INTEGER NOT NULL REFERENCES seeds (id),
  file TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL,
  UNIQUE (file, row_number, reason, detail)
) STRICT;

CREATE TABLE cleaned_calls (
  call_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  caller_hash TEXT NOT NULL,
  tracking_number TEXT NOT NULL,
  campaign_id TEXT,
  unattributed INTEGER NOT NULL,
  channel TEXT NOT NULL,
  location_id TEXT NOT NULL,
  answered INTEGER NOT NULL,
  outcome TEXT,
  booked INTEGER NOT NULL,
  pending INTEGER NOT NULL,
  revenue_usd REAL NOT NULL,
  agent_id TEXT,
  local_date TEXT NOT NULL,
  local_hour INTEGER NOT NULL,
  local_weekday INTEGER NOT NULL
) STRICT;
`;

const notSqlite = (path: string) =>
  new LoadError(`Cannot read the database ${path}: it is not a valid SQLite file. Move it aside and restart to build a new one from the CSVs.`);
const damaged = (path: string, detail: string) =>
  new LoadError(`The database ${path} is damaged (${detail}). Move it aside and restart to build a new one from the CSVs.`);

/** The message the read code uses when a query fails on a file that opened fine. */
export function damagedMessage(path: string, detail: string): string {
  return damaged(path, detail).message;
}

/** SQLITE_NOTADB is result code 26. */
function convertError(path: string, error: unknown): LoadError {
  if (error instanceof LoadError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  const code = (error as { errcode?: number }).errcode;
  if (code === 26 || /not a database/i.test(detail)) return notSqlite(path);
  return damaged(path, detail);
}

function isEmptyFile(path: string): boolean {
  return path !== IN_MEMORY && existsSync(path) && statSync(path).size === 0;
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
    db.exec('ROLLBACK');
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
    if (isEmptyFile(path) && !create) throw new LoadError(`The database ${path} is empty. Run "npm run seed" to fill it.`);
    if (create) mkdirSync(dirname(path), { recursive: true });
  } else if (!create) {
    throw new LoadError(`Database not found: ${path}`);
  }

  let db: DatabaseSync | undefined;
  try {
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
    checkIntegrity(db, path);
    return db;
  } catch (error) {
    try {
      db?.close(); // an open handle would lock the file on Windows
    } catch {
      // already closed or never opened
    }
    throw convertError(path, error);
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

/** True when there is nothing in the file to protect: it is missing, has zero bytes, or is a valid SQLite file with no tables. */
export function holdsNothing(path: string): boolean {
  if (path === IN_MEMORY) return true;
  if (!existsSync(path)) return true;
  if (statSync(path).size === 0) return true;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    return hasNothing(db, version);
  } catch {
    return false; // not SQLite or damaged: the real open reports it
  } finally {
    db?.close();
  }
}
