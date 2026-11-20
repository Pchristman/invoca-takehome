import type { DatabaseSync } from 'node:sqlite';
import { seedFromTexts } from '../../../src/db/prepare';
import { csvTexts, memoryDb } from '../helpers';

/** An in-memory database seeded from csvTexts(parts). */
export function seeded(parts: Parameters<typeof csvTexts>[0] = {}): DatabaseSync {
  const db = memoryDb();
  seedFromTexts(db, { folder: 'test', ...csvTexts(parts) });
  return db;
}

/** A CSV text from a header and data lines. */
export const csvOf = (header: string, lines: string[]): string => [header, ...lines].join('\n') + '\n';
