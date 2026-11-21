import { describe, expect, it } from 'vitest';
import { loadExport } from '../../src/core/loadExport';
import type { LoadedExport } from '../../src/core/types';
import { seedExport } from '../../src/db/seed';
import { callLine, campaignLine, count, csvTexts, memoryDb, noSource } from './helpers';

const load = (parts: Parameters<typeof csvTexts>[0]) => loadExport(csvTexts(parts));
const counts = (db: ReturnType<typeof memoryDb>) => ({
  raw: count(db, 'raw_calls'),
  bad: count(db, 'bad_rows'),
  campaigns: count(db, 'campaigns'),
  locations: count(db, 'locations'),
  issues: count(db, 'reference_issues'),
  seeds: count(db, 'seeds'),
});

const three = [
  callLine({ call_id: 'c_1' }),
  callLine({ call_id: 'c_2', started_at: '2026-09-01T17:00:00Z', updated_at: '2026-09-01T17:05:00Z' }),
  callLine({ call_id: 'c_3', started_at: '2026-09-01T18:00:00Z', updated_at: '2026-09-01T18:05:00Z', location_id: 'loc_b' }),
];

describe('seedExport', () => {
  it('seeding the same export twice adds nothing', () => {
    const db = memoryDb();
    const first = seedExport(db, load({ calls: three }), noSource);
    const before = counts(db);
    const second = seedExport(db, load({ calls: three }), noSource);
    expect(first).toMatchObject({ rowsRead: 3, newRows: 3, duplicateRows: 0, newVersions: 0 });
    expect(second).toMatchObject({ rowsRead: 3, newRows: 0, duplicateRows: 3, newVersions: 0 });
    expect(counts(db)).toEqual({ ...before, seeds: 2 });
  });

  it('an export with two identical rows keeps both, and a second seed still adds nothing', () => {
    const db = memoryDb();
    const calls = [callLine({ call_id: 'c_1' }), callLine({ call_id: 'c_1' })];
    seedExport(db, load({ calls }), noSource);
    expect(count(db, 'raw_calls')).toBe(2);
    const again = seedExport(db, load({ calls }), noSource);
    expect(count(db, 'raw_calls')).toBe(2);
    expect(again.newRows).toBe(0);
  });

  it('a newer export adds only the new versions', () => {
    const db = memoryDb();
    seedExport(db, load({ calls: three }), noSource);
    const newer = callLine({ call_id: 'c_1', answered: 'true', outcome: 'booked', revenue_usd: '120', updated_at: '2026-09-02T10:00:00Z' });
    const report = seedExport(db, load({ calls: [...three, newer] }), noSource);
    expect(report).toMatchObject({ rowsRead: 4, newRows: 1, duplicateRows: 3, newVersions: 1 });
    expect(count(db, 'raw_calls')).toBe(4);
    const seqs = (db.prepare('SELECT seq FROM raw_calls ORDER BY seq').all() as { seq: number }[]).map((r) => r.seq);
    expect(seqs).toEqual([4, 5, 6, 7]); // the three already stored move up to this seed's place, in file order
    expect(db.prepare('SELECT outcome FROM raw_calls WHERE seq = 7').get()).toEqual({ outcome: 'booked' });
  });

  it('all versions are kept', () => {
    const db = memoryDb();
    const calls = [
      callLine({ call_id: 'c_1', updated_at: '2026-09-01T16:02:00Z' }),
      callLine({ call_id: 'c_1', updated_at: '2026-09-01T16:05:00Z', answered: 'true', outcome: 'booked' }),
      callLine({ call_id: 'c_1', updated_at: '2026-09-01T16:09:00Z', answered: 'true', outcome: 'booked', revenue_usd: '50' }),
      callLine({ call_id: 'c_2' }),
    ];
    seedExport(db, load({ calls }), noSource);
    const perCall = db.prepare('SELECT call_id, COUNT(*) AS n FROM raw_calls GROUP BY call_id ORDER BY call_id').all();
    expect(perCall).toEqual([
      { call_id: 'c_1', n: 3 },
      { call_id: 'c_2', n: 1 },
    ]);
  });

  it('bad rows are stored with their reason and never in raw_calls', () => {
    const db = memoryDb();
    const calls = [
      callLine({ call_id: 'c_ok' }),
      callLine({ call_id: 'c_loc', location_id: 'loc_nope' }),
      callLine({ call_id: 'c_time', started_at: 'yesterday' }),
    ];
    seedExport(db, load({ calls }), noSource);
    const bad = db.prepare('SELECT call_id, reason, detail FROM bad_rows ORDER BY seq').all() as { call_id: string; reason: string; detail: string }[];
    expect(bad.map((b) => [b.call_id, b.reason])).toEqual([
      ['c_loc', 'unknown_location'],
      ['c_time', 'bad_timestamp'],
    ]);
    expect(bad.every((b) => b.detail.length > 0)).toBe(true);
    expect(db.prepare('SELECT call_id FROM raw_calls').all()).toEqual([{ call_id: 'c_ok' }]);
  });

  it('bad rows are not duplicated by a second seed', () => {
    const db = memoryDb();
    const calls = [callLine({ call_id: 'c_loc', location_id: 'loc_nope' })];
    seedExport(db, load({ calls }), noSource);
    const again = seedExport(db, load({ calls }), noSource);
    expect(count(db, 'bad_rows')).toBe(1);
    expect(again.badRowsNew).toBe(0);
  });

  it('campaign values are upserted: the newer seed wins, ids missing from it are kept', () => {
    const db = memoryDb();
    seedExport(db, load({ campaigns: [campaignLine('cmp_a', 'Alpha', 'social', '100'), campaignLine('cmp_b', 'Beta', 'display', '100')] }), noSource);
    seedExport(db, load({ campaigns: [campaignLine('cmp_a', 'Alpha', 'social', '150')] }), noSource);
    expect(db.prepare('SELECT id, daily_budget_usd FROM campaigns ORDER BY rowid').all()).toEqual([
      { id: 'cmp_a', daily_budget_usd: 150 },
      { id: 'cmp_b', daily_budget_usd: 100 },
    ]);
  });

  it('reference issues (a skipped campaign row) are stored once', () => {
    const db = memoryDb();
    const parts = { campaigns: [campaignLine('cmp_a', 'Alpha', 'social', '100'), campaignLine('cmp_x', 'Broken', 'carrier_pigeon', '5')] };
    const loaded = load(parts);
    expect(loaded.referenceIssues.length).toBeGreaterThan(0);
    seedExport(db, loaded, noSource);
    const once = count(db, 'reference_issues');
    seedExport(db, load(parts), noSource);
    expect(once).toBe(loaded.referenceIssues.length);
    expect(count(db, 'reference_issues')).toBe(once);
  });

  it('null, empty and zero are stored as themselves', () => {
    const db = memoryDb();
    const awkward = `O'Brien; DROP TABLE x -- "Café, Ltd"`;
    const calls = [
      callLine({ call_id: 'c_empty', answered: 'true', outcome: 'booked', revenue_usd: '', caller_number_hash: '' }),
      callLine({ call_id: 'c_zero', answered: 'true', outcome: 'booked', revenue_usd: '0' }),
      callLine({ call_id: 'c_dates', ended_at: 'garbage', updated_at: 'garbage' }),
    ];
    seedExport(db, load({ calls, campaigns: [campaignLine('cmp_a', awkward, 'social', '100')] }), noSource);
    const row = (id: string) => db.prepare('SELECT revenue_usd, caller_hash, ended_at, updated_at, typeof(revenue_usd) AS t FROM raw_calls WHERE call_id = ?').get(id);
    expect(row('c_empty')).toMatchObject({ revenue_usd: null, caller_hash: '' });
    expect(row('c_zero')).toMatchObject({ revenue_usd: 0, t: 'real' });
    expect(row('c_dates')).toMatchObject({ ended_at: null, updated_at: null });
    expect(db.prepare('SELECT name FROM campaigns WHERE id = ?').get('cmp_a')).toEqual({ name: awkward });
  });

  it('a failure partway rolls everything back, and a later seed still works', () => {
    const db = memoryDb();
    seedExport(db, load({ calls: three }), noSource);
    const before = counts(db);
    const good = load({ calls: [callLine({ call_id: 'c_new' }), callLine({ call_id: 'c_nan' })] });
    const broken: LoadedExport = structuredClone(good);
    const second = broken.rows[1]!;
    if (!second.ok) throw new Error('fixture row should be good');
    second.call.durationSeconds = Number.NaN; // a STRICT NOT NULL INTEGER column rejects it
    broken.campaigns[0]!.dailyBudgetUsd = 999;
    expect(() => seedExport(db, broken, noSource)).toThrow();
    expect(counts(db)).toEqual(before);
    expect(db.prepare("SELECT daily_budget_usd FROM campaigns WHERE id = 'cmp_a'").get()).toEqual({ daily_budget_usd: 100 });

    const report = seedExport(db, good, noSource);
    expect(report.newRows).toBe(2);
    expect(count(db, 'seeds')).toBe(before.seeds + 1);
  });
});
