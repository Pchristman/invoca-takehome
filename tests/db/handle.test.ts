import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LoadError } from '../../src/core/errors';
import { openDatabase } from '../../src/db/database';
import { createFileHandle, createMemoryHandle } from '../../src/db/handle';
import { seedFromTexts } from '../../src/db/prepare';
import { tempDir } from '../server/helpers';
import { callLine, count, csvTexts, memoryDb } from './helpers';

function seededFile(dir: string): string {
  const path = join(dir, 'calls.db');
  const db = openDatabase(path);
  seedFromTexts(db, { folder: 'test', ...csvTexts({ calls: [callLine()] }) });
  db.close();
  return path;
}

describe('createFileHandle', () => {
  it('opens for each use and closes after, so the file can be deleted (Windows)', () => {
    const dir = tempDir();
    try {
      const path = seededFile(dir);
      const handle = createFileHandle(path);
      expect(handle.use((db) => count(db, 'raw_calls'))).toBe(1);
      expect(handle.use((db) => count(db, 'raw_calls'))).toBe(1);
      rmSync(path); // fails with EBUSY if a connection stayed open
      expect(existsSync(path)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('closes the connection even when the function throws', () => {
    const dir = tempDir();
    try {
      const path = seededFile(dir);
      const handle = createFileHandle(path);
      expect(() => handle.use(() => { throw new Error('boom'); })).toThrow('boom');
      rmSync(path);
      expect(existsSync(path)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a corrupt or missing file throws the LoadError from the database module', () => {
    const dir = tempDir();
    try {
      const corrupt = join(dir, 'bad.db');
      writeFileSync(corrupt, 'not sqlite at all');
      expect(() => createFileHandle(corrupt).use(() => 1)).toThrow(LoadError);
      expect(() => createFileHandle(join(dir, 'missing.db')).use(() => 1)).toThrow(LoadError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('close() is safe, twice', () => {
    const handle = createFileHandle(join(tempDir(), 'x.db'));
    handle.close();
    handle.close();
  });
});

describe('createMemoryHandle', () => {
  it('keeps its data between two uses', () => {
    const handle = createMemoryHandle(memoryDb());
    handle.use((db) => db.exec("INSERT INTO seeds (seeded_at, label, calls_sha256, campaigns_sha256, locations_sha256, rows_read) VALUES ('t', 'l', '', '', '', 0)"));
    expect(handle.use((db) => count(db, 'seeds'))).toBe(1);
  });

  it('close() closes the connection, and twice is safe', () => {
    const db = memoryDb();
    const handle = createMemoryHandle(db);
    handle.close();
    handle.close();
    expect(() => db.prepare('SELECT 1')).toThrow();
  });
});
