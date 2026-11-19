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

/** The only I/O in the loader. `dir` defaults to DATA_DIR, or the current directory (the repo root) when unset or empty. */
export function readExportFromDir(dir?: string): LoadedExport {
  const folder = dir ?? (process.env.DATA_DIR || process.cwd());
  if (!existsSync(folder)) throw new LoadError(`Data folder not found: ${folder}`);
  return loadExport({
    calls: readCsv(join(folder, 'calls.csv')),
    campaigns: readCsv(join(folder, 'campaigns.csv')),
    locations: readCsv(join(folder, 'locations.csv')),
  });
}
