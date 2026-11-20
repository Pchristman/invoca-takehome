// Takeaway cache: the model's checked placeholder text, keyed on everything that could change the answer.
// Placeholders stay in the text so names and numbers are always filled from the current fact sheet.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FactSheet } from '../core/views/facts';

/** JSON with object keys sorted at every level, so equal data always gives the same string. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function cacheKey(parts: { snapshotId: string; sheet: FactSheet; promptVersion: string; model: string }): string {
  return createHash('sha256').update(stableStringify(parts)).digest('hex');
}

interface Entry { text: string; createdAt: string }

function isEntry(value: unknown): value is Entry {
  if (value === null || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.text === 'string' && typeof entry.createdAt === 'string';
}

export class TakeawayCache {
  readonly loadProblem: string | null = null;
  private entries = new Map<string, Entry>();

  /** A null path keeps everything in memory only. */
  constructor(private readonly path: string | null) {
    if (path !== null) this.loadProblem = this.load(path);
  }

  get(key: string): string | undefined {
    return this.entries.get(key)?.text;
  }

  /** Always stored in memory. Returns false if the file could not be written. */
  set(key: string, text: string): boolean {
    this.entries.set(key, { text, createdAt: new Date().toISOString() });
    return this.path === null ? true : this.save(this.path);
  }

  /** Fills the entries. Returns a message when the file was unreadable or damaged, else null. */
  private load(path: string): string | null {
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      return 'The takeaway cache file could not be read.';
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return 'The takeaway cache file is not valid JSON.';
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'The takeaway cache file is not an object.';
    }
    let skipped = 0;
    for (const [key, value] of Object.entries(parsed)) {
      if (isEntry(value)) this.entries.set(key, { text: value.text, createdAt: value.createdAt });
      else skipped++;
    }
    return skipped > 0 ? `The takeaway cache file had ${skipped} damaged entries, which were ignored.` : null;
  }

  /** Write a temp file, then rename it over the real one, so the file is never half-written. */
  private save(path: string): boolean {
    const temp = `${path}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(temp, JSON.stringify(Object.fromEntries(this.entries)));
      renameSync(temp, path);
      return true;
    } catch {
      rmSync(temp, { force: true });
      return false;
    }
  }
}
