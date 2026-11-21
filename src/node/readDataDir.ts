import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LoadError } from '../core/errors';
import { loadExport } from '../core/loadExport';
import type { LoadedExport } from '../core/types';

function readCsv(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new LoadError(`Cannot read ${path}: ${reason}`);
  }
}

/**
 * The folder to read: the explicit argument, else DATA_DIR, else the current directory. Blank values count as unset.
 * A relative path is relative to the current directory. `.env` is not read here: each entry point loads it first.
 */
function resolveDataDir(dir?: string): string {
  const explicit = dir?.trim();
  if (explicit) return explicit;
  return process.env.DATA_DIR?.trim() || process.cwd();
}

export interface ExportTexts {
  calls: string;
  campaigns: string;
  locations: string;
  /** The folder the texts were read from, as resolved. */
  folder: string;
}

/** Read the three CSV files as text. The only file I/O for an export; seeding hashes this text. */
export function readExportTexts(dir?: string): ExportTexts {
  const folder = resolveDataDir(dir);
  if (!existsSync(folder)) throw new LoadError(`Data folder not found: ${folder}`);
  return {
    calls: readCsv(join(folder, 'calls.csv')),
    campaigns: readCsv(join(folder, 'campaigns.csv')),
    locations: readCsv(join(folder, 'locations.csv')),
    folder,
  };
}

export function readExportFromDir(dir?: string): LoadedExport {
  return loadExport(readExportTexts(dir));
}
