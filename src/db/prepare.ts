import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { loadExport } from '../core/loadExport';
import { convertDatabaseError } from './database';
import type { CallStore } from '../core/types';
import { readExportTexts, type ExportTexts } from '../node/readDataDir';
import { holdsNothing, openDatabase, openExistingDatabase, removeQuietly, startsEmpty } from './database';
import { readStore } from './read';
import { seedExport, type SeedReport } from './seed';

export interface LoadedStore {
  store: CallStore;
  /** One-line messages for the person starting the app (what was seeded, a stale data folder). */
  notices: string[];
}

// Line endings are normalised so a checkout that only changed CRLF to LF is not mistaken for a different export.
const sha256 = (text: string) => createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');

const hashesOf = (texts: ExportTexts) => ({ calls: sha256(texts.calls), campaigns: sha256(texts.campaigns), locations: sha256(texts.locations) });

const csvCell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

/**
 * Load the three texts through the normal load step, checking calls against the campaigns and locations already stored
 * as well as the ones in the file (stored ones are kept for good, so an export that leaves one out must not turn its
 * calls bad). Stored ids the file lacks are added as extra rows at the end; rows the file has win.
 */
function loadWithStoredReferences(db: DatabaseSync, texts: ExportTexts) {
  const loaded = loadExport(texts);
  const haveCampaigns = new Set(loaded.campaigns.map((c) => c.id));
  const haveLocations = new Set(loaded.locations.map((l) => l.id));
  const storedCampaigns = (db.prepare('SELECT id, name, channel, daily_budget_usd FROM campaigns ORDER BY rowid').all() as Record<string, string | number>[]).filter(
    (c) => !haveCampaigns.has(String(c.id)),
  );
  const storedLocations = (db.prepare('SELECT id, name, timezone FROM locations ORDER BY rowid').all() as Record<string, string>[]).filter((l) => !haveLocations.has(String(l.id)));
  if (storedCampaigns.length === 0 && storedLocations.length === 0) return loaded;
  const append = (text: string, lines: string[]) => (lines.length === 0 ? text : (text.endsWith('\n') ? text : text + '\n') + lines.join('\n') + '\n');
  return loadExport({
    calls: texts.calls,
    campaigns: append(texts.campaigns, storedCampaigns.map((c) => [c.id, c.name, c.channel, c.daily_budget_usd].map((v) => csvCell(String(v))).join(','))),
    locations: append(texts.locations, storedLocations.map((l) => [l.id, l.name, l.timezone].map((v) => csvCell(String(v))).join(','))),
  });
}

/** Load the three texts and write them into the database. */
export function seedFromTexts(db: DatabaseSync, texts: ExportTexts): SeedReport {
  return seedExport(db, loadWithStoredReferences(db, texts), { label: texts.folder, hashes: hashesOf(texts) });
}

/** A message when the data folder holds an export no seed came from; null when it matches or cannot be read. */
export function staleSeedWarning(db: DatabaseSync, texts: ExportTexts | null, dbPath: string): string | null {
  if (texts === null) return null;
  const h = hashesOf(texts);
  const match = db
    .prepare('SELECT 1 FROM seeds WHERE calls_sha256 = ? AND campaigns_sha256 = ? AND locations_sha256 = ?')
    .get(h.calls, h.campaigns, h.locations);
  if (match) return null;
  return `The CSVs in ${texts.folder} are not what ${dbPath} was seeded from, so the app is showing the database. Run "npm run seed -- ${texts.folder}" to add them, or move ${dbPath} aside to start fresh.`;
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
  const madeFile = dbPath !== ':memory:' && startsEmpty(dbPath);
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
    if (madeFile) removeQuietly(dbPath);
    throw error instanceof Error && 'errcode' in error ? convertDatabaseError(dbPath, error) : error;
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
