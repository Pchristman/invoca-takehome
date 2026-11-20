import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { dataSpan } from '../../../src/core/ranges';
import { CALL_COLUMNS } from '../../../src/core/validate';
import { buildOverview } from '../../../src/core/views/overviewView';
import { openDatabase } from '../../../src/db/database';
import { seedFromTexts } from '../../../src/db/prepare';
import { readStore } from '../../../src/db/read';
import { commitUpload } from '../../../src/db/upload/commit';
import { readUpload } from '../../../src/db/upload/detect';
import { planUpload } from '../../../src/db/upload/plan';
import { UploadFailed } from '../../../src/db/upload/types';
import { tempDir } from '../../server/helpers';
import { callLine, campaignLine, count, csvTexts, locationLine } from '../helpers';
import { csvOf, seeded } from './helpers';

const CALLS_HEADER = CALL_COLUMNS.join(',');
const CAMPAIGNS_HEADER = 'campaign_id,name,channel,daily_budget_usd';
const LOCATIONS_HEADER = 'location_id,name,timezone';

const callsFile = (lines: string[], name = 'calls.csv') => readUpload(name, csvOf(CALLS_HEADER, lines));
const campaignsFile = (lines: string[], name = 'campaigns.csv') => readUpload(name, csvOf(CAMPAIGNS_HEADER, lines));
const locationsFile = (lines: string[], name = 'locations.csv') => readUpload(name, csvOf(LOCATIONS_HEADER, lines));

const database = () => seeded({ calls: [callLine({ call_id: 'c_1' })] });
const TABLES = ['raw_calls', 'bad_rows', 'seeds', 'cleaned_calls', 'campaigns', 'locations', 'reference_issues'];
const counted = (db: ReturnType<typeof database>) => Object.fromEntries(TABLES.map((t) => [t, count(db, t)]));
const booked = (extra: Record<string, string> = {}) => ({ answered: 'true', outcome: 'booked', revenue_usd: '300', ...extra });

describe('commitUpload', () => {
  test('new calls are written and the returned store contains them', () => {
    const db = database();
    const before = counted(db);
    const file = callsFile([callLine({ call_id: 'c_new', started_at: '2026-09-02T16:00:00Z' })], 'more.csv');
    const result = commitUpload(db, file);
    expect(result.written).toBe(1);
    expect(result.store?.calls.map((c) => c.callId)).toContain('c_new');
    expect(count(db, 'raw_calls')).toBe(before.raw_calls! + 1);
    expect(count(db, 'cleaned_calls')).toBe(before.cleaned_calls! + 1);
    expect(count(db, 'seeds')).toBe(before.seeds! + 1);
    const seed = db.prepare('SELECT * FROM seeds ORDER BY id DESC LIMIT 1').get() as Record<string, unknown>;
    expect(seed.label).toBe('upload: more.csv');
    expect(seed.calls_sha256).toBe(file.textSha256);
    expect(seed.campaigns_sha256).toBe('');
    expect(seed.locations_sha256).toBe('');
    expect(seed.rows_read).toBe(1);
  });

  test('the same file twice: the second imports nothing', () => {
    const db = database();
    const file = callsFile([callLine({ call_id: 'c_new' })]);
    expect(commitUpload(db, file).written).toBe(1);
    const seeds = count(db, 'seeds');
    const second = commitUpload(db, file);
    expect(second.written).toBe(0);
    expect(second.store).toBeNull();
    expect(count(db, 'seeds')).toBe(seeds);
    expect(second.preview.counts).toMatchObject({ rowsRead: 1, newRows: 0, newVersions: 0, duplicates: 1 });
  });

  test('confirm twice in a row writes once', () => {
    const db = database();
    const file = callsFile([callLine({ call_id: 'c_a' }), callLine({ call_id: 'c_b' })]);
    const before = count(db, 'raw_calls');
    const results = [commitUpload(db, file), commitUpload(db, file)];
    expect(results.map((r) => r.written)).toEqual([2, 0]);
    expect(count(db, 'raw_calls')).toBe(before + 2);
  });

  test('a new version wins when it is the latest and loses when it is older', () => {
    const db = database(); // c_1 missed at 16:02
    const newer = commitUpload(db, callsFile([callLine(booked({ call_id: 'c_1', updated_at: '2026-09-01T18:00:00Z' }))]));
    expect(newer.preview.counts.newVersions).toBe(1);
    const afterNewer = newer.store!.calls.find((c) => c.callId === 'c_1')!;
    expect(afterNewer.booked).toBe(true);
    expect(afterNewer.revenueUsd).toBe(300);

    const older = commitUpload(db, callsFile([callLine({ call_id: 'c_1', updated_at: '2026-09-01T15:00:00Z' })]));
    expect(older.written).toBe(1);
    const afterOlder = older.store!.calls.find((c) => c.callId === 'c_1')!;
    expect(afterOlder.booked).toBe(true);
    expect(afterOlder.revenueUsd).toBe(300);
  });

  test("a call's new version changes the numbers the views read", () => {
    const db = database();
    const range = { start: '2026-09-01', end: '2026-09-01', days: 1, clamped: false };
    const before = buildOverview(readStore(db), range).tiles;
    const result = commitUpload(db, callsFile([callLine(booked({ call_id: 'c_1', updated_at: '2026-09-01T18:00:00Z' }))]));
    const after = buildOverview(result.store!, range).tiles;
    expect(after.bookings.current! - before.bookings.current!).toBe(1);
    expect(after.revenueUsd.current! - before.revenueUsd.current!).toBe(300);
  });

  test('an upload of new calls moves the data span', () => {
    const db = database();
    const before = dataSpan(readStore(db).calls)!;
    const result = commitUpload(db, callsFile([callLine({ call_id: 'c_later', started_at: '2026-09-10T16:00:00Z' })]));
    const after = dataSpan(result.store!.calls)!;
    expect(after.end > before.end).toBe(true);
    expect(after.start).toBe(before.start);
  });

  test('campaigns and locations are written and the store lists them', () => {
    const db = database();
    const cleanedBefore = count(db, 'cleaned_calls');
    const c = commitUpload(db, campaignsFile([campaignLine('cmp_new', 'Gamma', 'paid_search', '75')]));
    expect(c.written).toBe(1);
    expect(c.store?.campaigns.map((x) => x.id)).toContain('cmp_new');
    const locations = locationsFile([locationLine('loc_new', 'Office N', 'America/Chicago')]);
    const l = commitUpload(db, locations);
    expect(l.written).toBe(1);
    expect(l.store?.locations.map((x) => x.id)).toContain('loc_new');
    expect(count(db, 'cleaned_calls')).toBe(cleanedBefore);
    const seed = db.prepare('SELECT * FROM seeds ORDER BY id DESC LIMIT 1').get() as Record<string, unknown>;
    expect(seed.locations_sha256).toBe(locations.textSha256);
  });

  test('a campaigns upload makes calls that were bad valid', () => {
    const db = seeded({ campaigns: [], calls: [] });
    const calls = [callLine({ call_id: 'c_x' }), callLine({ call_id: 'c_y' })];
    const first = commitUpload(db, callsFile(calls));
    expect(first.preview.counts.bad).toBe(2);
    expect(first.written).toBe(0);
    expect(first.store).toBeNull();

    expect(commitUpload(db, campaignsFile([campaignLine('cmp_a', 'Alpha', 'social', '100')])).written).toBe(1);

    const again = commitUpload(db, callsFile(calls));
    expect(again.written).toBe(2);
    expect(again.store!.calls.map((c) => c.callId).sort()).toEqual(['c_x', 'c_y']);
  });

  test('a stale preview does not write what it promised', () => {
    const db = database();
    const x = callsFile([callLine({ call_id: 'c_1x' }), callLine({ call_id: 'c_2x' }), callLine({ call_id: 'c_3x' })], 'x.csv');
    const y = callsFile([callLine({ call_id: 'c_1x' }), callLine({ call_id: 'c_2x' })], 'y.csv');
    expect(planUpload(db, x).preview.counts.newRows).toBe(3); // what the user was told

    expect(commitUpload(db, y).written).toBe(2); // the database moves on
    const result = commitUpload(db, x);
    expect(result.written).toBe(1);
    expect(result.preview.counts.duplicates).toBe(2);
    const repeats = db.prepare('SELECT call_id, COUNT(*) AS n FROM raw_calls GROUP BY call_id, updated_at HAVING n > 1').all();
    expect(repeats).toEqual([]);
  });

  describe('a write that fails', () => {
    const BOOM_RAW = `CREATE TRIGGER boom BEFORE INSERT ON raw_calls WHEN NEW.call_id = 'c_boom' BEGIN SELECT RAISE(ABORT, 'boom'); END`;
    const lines = () => [callLine({ call_id: 'c_ok' }), callLine({ call_id: 'c_boom' }), callLine({ call_id: 'c_ok2' })];

    test('a failure partway rolls everything back', () => {
      const db = database();
      const before = counted(db);
      db.exec(BOOM_RAW);
      expect(() => commitUpload(db, callsFile(lines()))).toThrow(UploadFailed);
      try {
        commitUpload(db, callsFile(lines()));
      } catch (error) {
        expect((error as Error).message).toContain('nothing was stored');
      }
      expect(counted(db)).toEqual(before);
      expect(db.isTransaction).toBe(false);
      expect(db.prepare("SELECT 1 FROM raw_calls WHERE call_id = 'c_ok'").get()).toBeUndefined();

      db.exec('DROP TRIGGER boom');
      const result = commitUpload(db, callsFile(lines()));
      expect(result.written).toBe(3);
      expect(count(db, 'raw_calls')).toBe(before.raw_calls! + 3);
    });

    test('a failure while rebuilding the store also rolls back', () => {
      const db = database();
      const before = counted(db);
      db.exec(`CREATE TRIGGER boom BEFORE INSERT ON cleaned_calls WHEN NEW.call_id = 'c_boom' BEGIN SELECT RAISE(ABORT, 'boom'); END`);
      expect(() => commitUpload(db, callsFile(lines()))).toThrow(/nothing was stored/);
      expect(counted(db)).toEqual(before);
      expect(db.isTransaction).toBe(false);
    });

    test('nothing in a failed message is file content', () => {
      const db = database();
      db.exec(BOOM_RAW);
      let message = '';
      try {
        commitUpload(db, callsFile(lines(), 'secret-name.csv'));
      } catch (error) {
        expect(error).toBeInstanceOf(UploadFailed);
        message = (error as Error).message;
      }
      expect(message).toContain('boom'); // the SQLite detail may appear
      expect(message).not.toContain('c_boom');
      expect(message).not.toContain('c_ok');
      expect(message).not.toContain('secret-name');
    });

    test('a file-backed database keeps its bytes when the write fails', () => {
      const dir = tempDir();
      const path = join(dir, 'calls.db');
      try {
        const db = openDatabase(path);
        seedFromTexts(db, { folder: 'test', ...csvTexts({ calls: [callLine({ call_id: 'c_1' })] }) });
        db.exec(BOOM_RAW);
        const before = readFileSync(path);
        expect(() => commitUpload(db, callsFile(lines()))).toThrow(/nothing was stored/);
        // before closing: close() would roll back by itself and hide a missing ROLLBACK
        expect(db.isTransaction).toBe(false);
        const other = openDatabase(path);
        try {
          expect(count(other, 'raw_calls')).toBe(1);
          expect(count(other, 'seeds')).toBe(1);
        } finally {
          other.close();
        }
        expect(readFileSync(path).equals(before)).toBe(true);
        db.close();
        expect(readFileSync(path).equals(before)).toBe(true);
        rmSync(path); // would fail on Windows if the connection were still open
        expect(existsSync(path)).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  test('a failure message does not carry the database file path', () => {
    const dir = tempDir();
    const path = join(dir, 'calls.db');
    try {
      const db = openDatabase(path);
      seedFromTexts(db, { folder: 'test', ...csvTexts({ calls: [callLine({ call_id: 'c_1' })] }) });
      db.exec(`CREATE TRIGGER boom BEFORE INSERT ON raw_calls WHEN NEW.call_id = 'c_boom' BEGIN SELECT RAISE(ABORT, 'boom'); END`);
      let message = '';
      try {
        commitUpload(db, callsFile([callLine({ call_id: 'c_boom' })]));
      } catch (error) {
        message = (error as Error).message;
      }
      db.close();
      expect(message).toContain('boom');
      expect(message).not.toContain(path);
      expect(message).not.toContain(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('another connection holding the write lock fails the commit cleanly, and the same upload works once it lets go', () => {
    const dir = tempDir();
    const path = join(dir, 'calls.db');
    try {
      const db = openDatabase(path);
      seedFromTexts(db, { folder: 'test', ...csvTexts({ calls: [callLine({ call_id: 'c_1' })] }) });
      db.exec('PRAGMA busy_timeout = 50'); // do not wait the full 5 s
      const other = openDatabase(path); // stands in for `npm run seed`
      try {
        other.exec('BEGIN IMMEDIATE');
        const file = callsFile([callLine({ call_id: 'c_new' })]);
        expect(() => commitUpload(db, file)).toThrow(UploadFailed);
        expect(() => commitUpload(db, file)).toThrow(/nothing was stored/);
        expect(db.isTransaction).toBe(false);
        other.exec('ROLLBACK');
        expect(count(other, 'raw_calls')).toBe(1);
        expect(count(other, 'seeds')).toBe(1);

        other.exec('BEGIN IMMEDIATE');
        other.exec('COMMIT');
        expect(commitUpload(db, file).written).toBe(1);
        expect(count(other, 'raw_calls')).toBe(2);
      } finally {
        other.close();
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a calls commit rebuilds the store once, not twice, inside the lock', () => {
    const db = database();
    const file = callsFile([callLine({ call_id: 'c_once' })]);
    const watch = () => {
      let n = 0;
      const real = db.prepare.bind(db);
      db.prepare = ((sql: string) => {
        if (sql === 'SELECT * FROM locations ORDER BY rowid') n += 1; // one per readStore
        return real(sql);
      }) as typeof db.prepare;
      return { count: () => n, stop: () => { db.prepare = real as typeof db.prepare; } };
    };
    const planning = watch();
    planUpload(db, file);
    const planned = planning.count();
    planning.stop();
    const committing = watch();
    commitUpload(db, file);
    const total = committing.count();
    committing.stop();
    // planning inside the commit reads as much as planning alone; the store is then read exactly once more
    expect(total - planned).toBe(1);
  });

  test('a later npm run seed of the same export still adds nothing after an upload', () => {
    const texts = { folder: 'test', ...csvTexts({ calls: [callLine({ call_id: 'c_1' }), callLine({ call_id: 'c_2', updated_at: '2026-09-01T17:00:00Z' })] }) };
    const db = seeded();
    seedFromTexts(db, texts);
    expect(commitUpload(db, callsFile([callLine({ call_id: 'c_up' })])).written).toBe(1);
    const again = seedFromTexts(db, texts);
    expect(again.newRows).toBe(0);
    expect(again.duplicateRows).toBe(again.rowsRead);
  });

  test('hostile text is stored verbatim', () => {
    const db = database();
    const name = `O'Brien; DROP TABLE x -- "Café, Ltd"`;
    const id = '<b>x</b>';
    const fileName = `<script>alert("x")</script>'; DROP TABLE seeds; --.csv`;
    expect(commitUpload(db, campaignsFile([campaignLine(id, name, 'social', '10')], fileName)).written).toBe(1);
    const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as { name: string };
    expect(row.name).toBe(name);
    const seed = db.prepare('SELECT label FROM seeds ORDER BY id DESC LIMIT 1').get() as { label: string };
    expect(seed.label).toBe(`upload: ${fileName}`);
    expect(count(db, 'seeds')).toBe(2); // the table is still there
  });

  test('an upload of only duplicates and bad rows writes nothing and reports why', () => {
    const db = database();
    const before = counted(db);
    const result = commitUpload(db, callsFile([callLine({ call_id: 'c_1' }), callLine({ call_id: 'c_bad', location_id: 'loc_nope' })]));
    expect(result.written).toBe(0);
    expect(result.store).toBeNull();
    expect(result.preview.counts).toMatchObject({ rowsRead: 2, duplicates: 1, bad: 1 });
    expect(result.preview.badByReason).toEqual({ unknown_location: 1 });
    expect(counted(db)).toEqual(before);
  });
});
