import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/database';
import { loadStore, seedFromTexts } from '../../src/db/prepare';
import { readExportTexts } from '../../src/node/readDataDir';
import { tempDir } from '../server/helpers';
import { callLine, csvTexts } from './helpers';

function folder(texts: ReturnType<typeof csvTexts>): string {
  const dir = join(tempDir(), 'data');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'calls.csv'), texts.calls);
  writeFileSync(join(dir, 'campaigns.csv'), texts.campaigns);
  writeFileSync(join(dir, 'locations.csv'), texts.locations);
  return dir;
}

const exportA = () => csvTexts({ calls: [callLine({ call_id: 'c_a' })] });
const exportB = () => csvTexts({ calls: [callLine({ call_id: 'c_b' })] });

describe('the stale-seed warning', () => {
  it('no warning when the folder holds what was seeded', () => {
    const file = join(tempDir(), 'calls.db');
    const dir = folder(exportA());
    loadStore({ dbPath: file, dataDir: dir });
    expect(loadStore({ dbPath: file, dataDir: dir }).notices).toEqual([]);
  });

  it('a warning names the folder and the fix when the folder holds a different export, and the load still works', () => {
    const file = join(tempDir(), 'calls.db');
    loadStore({ dbPath: file, dataDir: folder(exportA()) });
    const other = folder(exportB());
    const { store, notices } = loadStore({ dbPath: file, dataDir: other });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain(other);
    expect(notices[0]).toContain('npm run seed');
    expect(store.calls.map((c) => c.callId)).toEqual(['c_a']); // the database is what is shown
  });

  it('no warning when the folder is missing (Docker without a mount)', () => {
    const file = join(tempDir(), 'calls.db');
    loadStore({ dbPath: file, dataDir: folder(exportA()) });
    expect(loadStore({ dbPath: file, dataDir: join(tempDir(), 'nowhere') }).notices).toEqual([]);
  });

  it('no warning once the other export has been seeded too (any recorded seed matches)', () => {
    const file = join(tempDir(), 'calls.db');
    const a = folder(exportA());
    const b = folder(exportB());
    loadStore({ dbPath: file, dataDir: a });
    const db = openDatabase(file);
    seedFromTexts(db, readExportTexts(b));
    db.close();
    expect(loadStore({ dbPath: file, dataDir: b }).notices).toEqual([]);
    expect(loadStore({ dbPath: file, dataDir: a }).notices).toEqual([]);
  });
});
