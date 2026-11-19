import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LoadError } from '../core/errors';
import { loadExport } from '../core/loadExport';
import type { LoadedExport } from '../core/types';
import { loadDotEnv } from './env';

function readCsv(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new LoadError(`Cannot read ${path}: ${reason}`);
  }
}

/**
 * The folder to read: the explicit argument, else DATA_DIR (from the environment or `.env`),
 * else the current directory. Blank values count as unset. A relative path is relative to the current directory.
 */
function resolveDataDir(dir?: string): string {
  const explicit = dir?.trim();
  if (explicit) return explicit;
  loadDotEnv();
  return process.env.DATA_DIR?.trim() || process.cwd();
}

/** The only I/O in the loader. */
export function readExportFromDir(dir?: string): LoadedExport {
  const folder = resolveDataDir(dir);
  if (!existsSync(folder)) throw new LoadError(`Data folder not found: ${folder}`);
  return loadExport({
    calls: readCsv(join(folder, 'calls.csv')),
    campaigns: readCsv(join(folder, 'campaigns.csv')),
    locations: readCsv(join(folder, 'locations.csv')),
  });
}
