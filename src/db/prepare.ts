import { createHash } from 'node:crypto';
import { existsSync, rmSync, statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { loadExport } from '../core/loadExport';
import type { CallStore } from '../core/types';
import { readExportTexts, type ExportTexts } from '../node/readDataDir';
import { holdsNothing, openDatabase, openExistingDatabase } from './database';
import { readStore } from './read';
import { seedExport, type SeedReport } from './seed';

export interface LoadedStore {
  store: CallStore;
  /** One-line messages for the person starting the app (what was seeded, a stale data folder). */
  notices: string[];
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const hashesOf = (texts: ExportTexts) => ({ calls: sha256(texts.calls), campaigns: sha256(texts.campaigns), locations: sha256(texts.locations) });

/** Load the three texts through the normal load step and write them into the database. */
export function seedFromTexts(db: DatabaseSync, texts: ExportTexts): SeedReport {
  return seedExport(db, loadExport(texts), { label: texts.folder, hashes: hashesOf(texts) });
}

/** A message when the data folder holds an export no seed came from; null when it matches or cannot be read. */
export function staleSeedWarning(db: DatabaseSync, texts: ExportTexts | null, dbPath: string): string | null {
  if (texts === null) return null;
  const h = hashesOf(texts);
  const match = db
    .prepare('SELECT 1 FROM seeds WHERE calls_sha256 = ? AND campaigns_sha256 = ? AND locations_sha256 = ?')
    .get(h.calls, h.campaigns, h.locations);
  if (match) return null;
  return `The CSVs in ${texts.folder} are not what ${dbPath} was seeded from, so the app is showing the database. Run "npm run seed" to add them, or move ${dbPath} aside to start fresh.`;
}

function tryReadTexts(dataDir: string | undefined): ExportTexts | null {
  try {
    return readExportTexts(dataDir);
  } catch {
    return null; // no data folder next to the database is fine
  }
}

/** First start: make the database from the data folder. A file this call made is removed if seeding fails, so the next start tries again. */
function seedNewDatabase(dbPath: string, dataDir: string | undefined): LoadedStore {
  const texts = readExportTexts(dataDir);
  const madeFile = dbPath !== ':memory:' && (!existsSync(dbPath) || statSync(dbPath).size === 0);
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase(dbPath);
    seedFromTexts(db, texts);
    const store = readStore(db);
    const notices = dbPath === ':memory:' ? [] : [`Seeded ${dbPath} from ${texts.folder}: ${store.calls.length} calls.`];
    return { store, notices };
  } catch (error) {
    db?.close();
    db = undefined;
    if (madeFile) rmSync(dbPath, { force: true });
    throw error;
  } finally {
    db?.close(); // an open handle would lock the file on Windows
  }
}

/**
 * The store the server serves. `:memory:` seeds a private database from the data folder. A file that holds nothing is
 * seeded from the data folder. A file with data is read as it is (the data folder is not needed) and never changed.
 */
export function loadStore(options: { dbPath: string; dataDir?: string }): LoadedStore {
  const { dbPath, dataDir } = options;
  if (holdsNothing(dbPath)) return seedNewDatabase(dbPath, dataDir);

  const db = openExistingDatabase(dbPath);
  try {
    const store = readStore(db);
    const warning = staleSeedWarning(db, tryReadTexts(dataDir), dbPath);
    return { store, notices: warning ? [warning] : [] };
  } finally {
    db.close();
  }
}
