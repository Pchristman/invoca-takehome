import type { DatabaseSync } from 'node:sqlite';
import { readTable } from '../core/csv';
import { loadExport } from '../core/loadExport';
import type { BadReason, CallStore, LoadedExport } from '../core/types';
import { CAMPAIGN_COLUMNS, parseCampaigns } from '../core/reference';
import { buildReferences, CALL_COLUMNS, validateCall } from '../core/validate';
import { readExportTexts, type ExportTexts } from '../node/readDataDir';
import { createFileHandle, createMemoryHandle, type DatabaseHandle } from './handle';
import { convertDatabaseError, holdsNothing, openDatabase, openExistingDatabase, removeQuietly, startsEmpty } from './database';
import { readCampaigns, readLocations, readStore } from './read';
import { seedExport, sha256, type SeedReport } from './seed';

export interface LoadedStore {
  store: CallStore;
  /** One-line messages for the person starting the app (what was seeded, a stale data folder). */
  notices: string[];
  /** How uploads reach the database: a file is opened for each use; `:memory:` keeps the seeded connection open. */
  database: DatabaseHandle;
}

// Line endings are normalised so a checkout that only changed CRLF to LF is not mistaken for a different export.
const textHash = (text: string) => sha256(text.replaceAll('\r\n', '\n'));

const hashesOf = (texts: ExportTexts) => ({ calls: textHash(texts.calls), campaigns: textHash(texts.campaigns), locations: textHash(texts.locations) });

/** The stored records whose id `have` lacks, in stored order. */
function missingFrom<T extends { id: string }>(stored: T[], have: T[]): T[] {
  const ids = new Set(have.map((x) => x.id));
  return stored.filter((x) => !ids.has(x.id));
}

/** The only reasons a stored campaign or office can fix, so the only bad rows worth checking again. */
const FIXED_BY_STORED: ReadonlySet<BadReason> = new Set(['unknown_campaign', 'unknown_location']);

/**
 * Load the three texts through the normal load step, then check calls against the campaigns and locations already
 * stored as well as the ones in the files (stored ones are kept for good, so an export that leaves one out must not
 * turn its calls bad). Rows the files have win. Stored ones the files lack are added as typed records, never as CSV
 * text, so a file's column order, or a zero-byte file, reads the same as on a first seed.
 */
function loadWithStoredReferences(db: DatabaseSync, texts: ExportTexts): LoadedExport {
  const loaded = loadExport(texts);
  const extraCampaigns = missingFrom(readCampaigns(db), loaded.campaigns);
  const extraLocations = missingFrom(readLocations(db), loaded.locations);
  if (extraCampaigns.length === 0 && extraLocations.length === 0) return loaded;

  const campaigns = [...loaded.campaigns, ...extraCampaigns];
  const locations = [...loaded.locations, ...extraLocations];
  // The file's unusable campaigns, so a re-checked call names them as the CSV route does (invalid_campaign, not unknown).
  const { invalidCampaigns } = parseCampaigns(readTable(texts.campaigns, 'campaigns.csv', CAMPAIGN_COLUMNS));
  const refs = buildReferences(campaigns, locations, invalidCampaigns);
  const rawRows = readTable(texts.calls, 'calls.csv', CALL_COLUMNS).rows;
  // Only rows the file alone called unknown are checked again; the counts move with them. updated_at is read the
  // same way for good and bad rows, so the unparseable updated_at count cannot change.
  const badByReason = { ...loaded.badByReason };
  let unparseableEndedAt = loaded.unparseableEndedAt;
  const rows = loaded.rows.map((row, index) => {
    if (row.ok || !FIXED_BY_STORED.has(row.bad.reason)) return row;
    const checked = validateCall(rawRows[index]!, index + 1, refs);
    badByReason[row.bad.reason] -= 1;
    if (!checked.ok) badByReason[checked.bad.reason] += 1;
    else if (checked.call.endedAt === null) unparseableEndedAt += 1;
    return checked;
  });
  return { ...loaded, campaigns, locations, rows, badByReason, unparseableEndedAt };
}

/** Load the three texts and write them into the database. */
export function seedFromTexts(db: DatabaseSync, texts: ExportTexts): SeedReport {
  return seedExport(db, loadWithStoredReferences(db, texts), { label: texts.folder, hashes: hashesOf(texts) });
}

/** A message when the data folder holds an export no seed came from; null when it matches or cannot be read. */
function staleSeedWarning(db: DatabaseSync, texts: ExportTexts | null, dbPath: string): string | null {
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
  let keepOpen = false;
  try {
    db = openDatabase(dbPath);
    seedFromTexts(db, texts);
    const store = readStore(db);
    if (dbPath === ':memory:') {
      keepOpen = true; // the database is gone when its connection closes
      return { store, notices: [], database: createMemoryHandle(db) };
    }
    return { store, notices: [`Seeded ${dbPath} from ${texts.folder}: ${store.calls.length} calls.`], database: createFileHandle(dbPath) };
  } catch (error) {
    db?.close();
    db = undefined;
    if (madeFile) removeQuietly(dbPath);
    throw error instanceof Error && 'errcode' in error ? convertDatabaseError(dbPath, error) : error;
  } finally {
    if (!keepOpen) db?.close(); // an open handle would lock the file on Windows
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
    return { store, notices: warning ? [warning] : [], database: createFileHandle(dbPath) };
  } finally {
    db.close();
  }
}
