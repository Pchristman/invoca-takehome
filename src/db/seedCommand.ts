import { existsSync, rmSync, statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { LoadError } from '../core/errors';
import { readExportTexts } from '../node/readDataDir';
import { parseDbPath } from '../server/config';
import { openDatabase } from './database';
import { seedFromTexts } from './prepare';

export interface SeedCommandResult {
  exitCode: 0 | 1;
  lines: string[];
}

const fail = (message: string): SeedCommandResult => ({ exitCode: 1, lines: [`Cannot seed: ${message}`] });

/**
 * The body of `npm run seed [folder]`. The folder is the first argument that is not a flag, else DATA_DIR, else the
 * current folder; the file is DB_PATH (default data/calls.db). Never throws: every problem is one "Cannot seed" line.
 * Seeding changes nothing for a running server, which keeps the data it started with.
 */
export function runSeed(args: string[], env: NodeJS.ProcessEnv): SeedCommandResult {
  const dbPath = parseDbPath(env.DB_PATH);
  if (dbPath === ':memory:') return fail('DB_PATH is :memory:, so there is no file to seed. Set DB_PATH to a file.');

  const folder = args.find((a) => !a.startsWith('-')) ?? (env.DATA_DIR?.trim() || process.cwd());
  let db: DatabaseSync | undefined;
  let madeFile = false;
  try {
    const texts = readExportTexts(folder); // first, so a missing folder never creates a file
    madeFile = !existsSync(dbPath) || statSync(dbPath).size === 0;
    db = openDatabase(dbPath);
    const report = seedFromTexts(db, texts);
    return {
      exitCode: 0,
      lines: [
        `Seeded ${dbPath} from ${texts.folder} (seed #${report.seedId}).`,
        `${report.rowsRead} rows read: ${report.newRows} new, ${report.duplicateRows} already stored, ${report.newVersions} new versions of existing calls, ${report.badRowsNew} bad.`,
        `${report.callsAfter} calls in the database.`,
        'A running server keeps the data it started with; restart it to see this.',
      ],
    };
  } catch (error) {
    db?.close();
    db = undefined;
    if (madeFile) rmSync(dbPath, { force: true }); // only a file this run created
    if (error instanceof LoadError) return fail(error.message);
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    db?.close(); // an open handle would lock the file on Windows
  }
}
