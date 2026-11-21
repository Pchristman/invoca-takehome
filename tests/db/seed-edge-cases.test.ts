import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { LoadError } from '../../src/core/errors';
import { loadExport } from '../../src/core/loadExport';
import { openDatabase } from '../../src/db/database';
import { loadStore, seedFromTexts } from '../../src/db/prepare';
import { readStore } from '../../src/db/read';
import { seedExport } from '../../src/db/seed';
import { runSeed } from '../../src/db/seedCommand';
import type { ExportTexts } from '../../src/node/readDataDir';
import { tempDir } from '../server/helpers';
import { callLine, campaignLine, count, csvTexts, locationLine, memoryDb, noSource } from './helpers';

const asTexts = (texts: ReturnType<typeof csvTexts>, folder = 'test-folder'): ExportTexts => ({ ...texts, folder });

function writeFolder(texts: ReturnType<typeof csvTexts>, eol = '\n'): string {
  const dir = join(tempDir(), 'data');
  mkdirSync(dir, { recursive: true });
  for (const name of ['calls', 'campaigns', 'locations'] as const) writeFileSync(join(dir, `${name}.csv`), texts[name].replaceAll('\n', eol));
  return dir;
}

describe('a failed first seed into a file that already had an empty schema', () => {
  it('is seeded on the next start instead of served as zero calls', () => {
    const file = join(tempDir(), 'calls.db');
    const bare = new DatabaseSync(file);
    bare.exec('CREATE TABLE t (a TEXT); DROP TABLE t'); // non-empty, valid, no tables: this run did not create it
    bare.close();
    const broken = writeFolder({ ...csvTexts({ calls: [callLine()] }), calls: 'call_id\nc_1\n' });
    expect(() => loadStore({ dbPath: file, dataDir: broken })).toThrow(LoadError);

    const { store, notices } = loadStore({ dbPath: file, dataDir: writeFolder(csvTexts({ calls: [callLine()] })) });
    expect(store.calls).toHaveLength(1);
    expect(notices[0]).toMatch(/^Seeded /);
  });

  it('npm run seed after such a failure works too', () => {
    const file = join(tempDir(), 'calls.db');
    const bare = new DatabaseSync(file);
    bare.exec('CREATE TABLE t (a TEXT); DROP TABLE t');
    bare.close();
    const broken = writeFolder({ ...csvTexts({ calls: [callLine()] }), calls: 'call_id\nc_1\n' });
    expect(runSeed([broken], { DB_PATH: file }).exitCode).toBe(1);
    expect(runSeed([writeFolder(csvTexts({ calls: [callLine()] }))], { DB_PATH: file }).lines[2]).toBe('1 calls in the database.');
  });
});

describe('an office whose time zone becomes invalid in a later export', () => {
  it('can still be seeded; its calls are bad (invalid_timezone) instead of a crash', () => {
    const db = memoryDb();
    seedFromTexts(db, asTexts(csvTexts({ calls: [callLine({ call_id: 'c_1', location_id: 'loc_a' }), callLine({ call_id: 'c_9', location_id: 'loc_b' })] })));
    const later = csvTexts({
      calls: [callLine({ call_id: 'c_2', location_id: 'loc_a' })],
      locations: [locationLine('loc_a', 'Office A', 'Mars/Olympus'), locationLine('loc_b', 'Office B', 'America/Denver')],
    });
    expect(() => seedFromTexts(db, asTexts(later))).not.toThrow();
    const store = readStore(db);
    expect(store.calls.map((c) => c.callId)).toEqual(['c_9']);
    expect(store.dataNotes.badCallsByReason.invalid_timezone).toBe(2);
  });
});

describe('reference issues describe the latest seed only', () => {
  const badCampaign = campaignLine('cmp_x', 'Broken', 'carrier_pigeon', '5');
  const good = campaignLine('cmp_a', 'Alpha', 'social', '100');

  it('shifted rows are not stored twice and a fixed issue disappears', () => {
    const db = memoryDb();
    const a = csvTexts({ campaigns: [good, badCampaign] });
    seedFromTexts(db, asTexts(a));
    const b = csvTexts({ campaigns: [campaignLine('cmp_b', 'Beta', 'display', '50'), good, badCampaign] });
    seedFromTexts(db, asTexts(b));
    expect(readStore(db).dataNotes.referenceIssues).toEqual(loadExport(b).referenceIssues);
    expect(readStore(db).dataNotes.referenceIssues).toHaveLength(1);

    seedFromTexts(db, asTexts(csvTexts({ campaigns: [campaignLine('cmp_x', 'Fixed', 'social', '5'), good] })));
    expect(readStore(db).dataNotes.referenceIssues).toEqual([]);
    expect(count(db, 'reference_issues')).toBe(0);
  });
});

describe('notes for empty files', () => {
  it('match the CSV route when all three files are header-only', () => {
    const texts = csvTexts({ calls: [], campaigns: [], locations: [] });
    const db = memoryDb();
    seedFromTexts(db, asTexts(texts));
    const fromCsv = cleanExport(loadExport(texts)).dataNotes.notes;
    expect(fromCsv).toHaveLength(3);
    expect(readStore(db).dataNotes.notes).toEqual(fromCsv);
  });

  it('a campaigns file whose only row was skipped is not "empty", on either route', () => {
    const texts = csvTexts({ campaigns: [campaignLine('cmp_x', 'Broken', 'carrier_pigeon', '5')] });
    const db = memoryDb();
    seedFromTexts(db, asTexts(texts));
    expect(readStore(db).dataNotes.notes).toEqual(cleanExport(loadExport(texts)).dataNotes.notes);
  });
});

describe('references kept from an earlier seed', () => {
  it('a campaign a newer export leaves out still validates its calls, so nothing turns bad or ties', () => {
    const db = memoryDb();
    const call = callLine({ call_id: 'c_1', campaign_id: 'cmp_b', marketing_channel: 'display' });
    seedFromTexts(db, asTexts(csvTexts({ calls: [call] })));
    const withoutB = csvTexts({ calls: [call], campaigns: [campaignLine('cmp_a', 'Alpha', 'social', '100')] });
    const report = seedFromTexts(db, asTexts(withoutB));
    expect(report).toMatchObject({ newRows: 0, badRowsNew: 0 });
    const store = readStore(db);
    expect(store.calls.map((c) => c.callId)).toEqual(['c_1']);
    expect(store.dataNotes.tiedCalls).toBe(0);
    expect(store.campaigns.map((c) => c.id)).toEqual(['cmp_a', 'cmp_b']);
  });

  it('a newer export with reordered columns that leaves a stored campaign and office out keeps them and their calls', () => {
    const db = memoryDb();
    const call = callLine({ call_id: 'c_1', campaign_id: 'cmp_b', marketing_channel: 'display', location_id: 'loc_b' });
    seedFromTexts(db, asTexts(csvTexts({ calls: [call] })));
    const reordered = {
      ...csvTexts({ calls: [call] }),
      campaigns: 'name,daily_budget_usd,campaign_id,channel\nAlpha,100,cmp_a,social\n',
      locations: 'timezone,location_id,name\nAmerica/Phoenix,loc_a,Office A\n',
    };
    const report = seedFromTexts(db, asTexts(reordered));
    expect(report).toMatchObject({ newRows: 0, badRowsNew: 0 });
    expect(count(db, 'bad_rows')).toBe(0);
    expect(count(db, 'reference_issues')).toBe(0);
    const store = readStore(db);
    expect(store.calls.map((c) => c.callId)).toEqual(['c_1']);
    expect(store.campaigns.find((c) => c.id === 'cmp_b')).toMatchObject({ name: 'Beta', channel: 'display', dailyBudgetUsd: 50 });
    expect(store.locations.find((l) => l.id === 'loc_b')).toMatchObject({ name: 'Office B', timezone: 'America/Denver' });
  });

  it('a re-seed with zero-byte campaigns and locations files works as a first seed would, keeping the stored ones', () => {
    const db = memoryDb();
    const call = callLine({ call_id: 'c_1' });
    seedFromTexts(db, asTexts(csvTexts({ calls: [call] })));
    const report = seedFromTexts(db, asTexts({ ...csvTexts({ calls: [call] }), campaigns: '', locations: '' }));
    expect(report).toMatchObject({ newRows: 0, badRowsNew: 0 });
    const store = readStore(db);
    expect(store.calls.map((c) => c.callId)).toEqual(['c_1']);
    expect(store.campaigns.map((c) => c.id)).toEqual(['cmp_a', 'cmp_b']);
    expect(store.locations.map((l) => l.id)).toEqual(['loc_a', 'loc_b']);
  });
});

describe('bad and good rows of one call keep their file order', () => {
  it('a bad row before a good row with the same updated_at: the later (good) row wins, as in the CSV route', () => {
    const texts = csvTexts({
      calls: [callLine({ call_id: 'c_x', location_id: 'loc_nope' }), callLine({ call_id: 'c_x', outcome: 'missed' })],
    });
    const db = memoryDb();
    seedExport(db, loadExport(texts), noSource);
    expect(readStore(db)).toEqual(cleanExport(loadExport(texts)));
    expect(readStore(db).calls.map((c) => c.callId)).toEqual(['c_x']);
  });

  it('a call whose first row is bad keeps its first-appearance place', () => {
    const texts = csvTexts({
      calls: [
        callLine({ call_id: 'c_y', location_id: 'loc_nope', updated_at: '2026-09-01T10:00:00Z' }),
        callLine({ call_id: 'c_z', started_at: '2026-09-01T17:00:00Z' }),
        callLine({ call_id: 'c_y', updated_at: '2026-09-01T11:00:00Z' }),
      ],
    });
    const db = memoryDb();
    seedExport(db, loadExport(texts), noSource);
    const store = readStore(db);
    expect(store.calls.map((c) => c.callId)).toEqual(['c_y', 'c_z']);
    expect(store).toEqual(cleanExport(loadExport(texts)));
  });
});

describe('newVersions', () => {
  it('a brand-new call with two rows in one seed is not a new version of an existing call', () => {
    const db = memoryDb();
    const report = seedExport(
      db,
      loadExport(csvTexts({ calls: [callLine({ call_id: 'c_new' }), callLine({ call_id: 'c_new', updated_at: '2026-09-02T10:00:00Z' })] })),
      noSource,
    );
    expect(report).toMatchObject({ newRows: 2, newVersions: 0 });
  });
});

describe('the stale-folder warning', () => {
  it('names the folder to seed', () => {
    const file = join(tempDir(), 'calls.db');
    loadStore({ dbPath: file, dataDir: writeFolder(csvTexts({ calls: [callLine({ call_id: 'c_a' })] })) });
    const other = writeFolder(csvTexts({ calls: [callLine({ call_id: 'c_b' })] }));
    expect(loadStore({ dbPath: file, dataDir: other }).notices[0]).toContain(`npm run seed -- ${other}`);
  });

  it('is not triggered by a checkout that only changed line endings', () => {
    const file = join(tempDir(), 'calls.db');
    const texts = csvTexts({ calls: [callLine({ call_id: 'c_a' })] });
    loadStore({ dbPath: file, dataDir: writeFolder(texts, '\n') });
    expect(loadStore({ dbPath: file, dataDir: writeFolder(texts, '\r\n') }).notices).toEqual([]);
  });
});

describe('paths that are not a database file', () => {
  it('npm run seed with a directory as DB_PATH is one Cannot seed line, never a throw', () => {
    const dir = tempDir();
    const result = runSeed([writeFolder(csvTexts({ calls: [callLine()] }))], { DB_PATH: dir });
    expect(result.exitCode).toBe(1);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatch(/^Cannot seed: /);
  });

  it('loadStore with a directory or a file-as-parent is a LoadError that is not about damage', () => {
    const dataDir = writeFolder(csvTexts({ calls: [callLine()] }));
    const dir = tempDir();
    expect(() => loadStore({ dbPath: dir, dataDir })).toThrow(LoadError);
    expect(() => loadStore({ dbPath: dir, dataDir })).not.toThrow(/damaged/);
    const blocker = join(tempDir(), 'a-file');
    writeFileSync(blocker, 'x');
    expect(() => loadStore({ dbPath: join(blocker, 'calls.db'), dataDir })).toThrow(LoadError);
  });

  it('a failed seed does not hide its error behind a failed clean-up', () => {
    const file = join(tempDir(), 'calls.db');
    const broken = writeFolder({ ...csvTexts({ calls: [callLine()] }), calls: 'call_id\nc_1\n' });
    expect(() => loadStore({ dbPath: file, dataDir: broken })).toThrow(/column/i);
  });
});

describe('transactions', () => {
  it('a failure after SQLite already rolled back reports the real error, not "no transaction is active"', () => {
    const db = openDatabase(':memory:');
    const loaded = loadExport(csvTexts({ calls: [callLine()] }));
    db.exec('PRAGMA foreign_keys = ON');
    const broken = structuredClone(loaded);
    const row = broken.rows[0]!;
    if (!row.ok) throw new Error('fixture row should be good');
    row.call.durationSeconds = Number.NaN;
    expect(() => seedExport(db, broken, noSource)).toThrow(/NOT NULL|constraint/i);
    expect(db.isTransaction).toBe(false);
  });
});

describe('a call made bad by a faulty export recovers when the good export is seeded again', () => {
  const good = csvTexts({ calls: [callLine({ call_id: 'c_1' }), callLine({ call_id: 'c_2', location_id: 'loc_b', campaign_id: 'cmp_b', marketing_channel: 'display' })] });
  const notesOf = (db: DatabaseSync) => {
    const { calls, dataNotes: n } = readStore(db);
    return { calls: calls.map((c) => c.callId), badCalls: n.badCalls };
  };
  const fresh = () => {
    const db = memoryDb();
    seedFromTexts(db, asTexts(good));
    return notesOf(db);
  };

  it('after an invalid time zone: good, faulty, good ends with the calls a fresh load of the good export has', () => {
    const db = memoryDb();
    seedFromTexts(db, asTexts(good));
    const faulty = { ...good, locations: csvTexts({ locations: [locationLine('loc_a', 'Office A', 'Mars/Olympus'), locationLine('loc_b', 'Office B', 'America/Denver')] }).locations };
    seedFromTexts(db, asTexts(faulty));
    expect(readStore(db).dataNotes.badRows).toBe(1); // c_1 once: its stored bad row, not also its old good row
    const report = seedFromTexts(db, asTexts(good));
    expect(report).toMatchObject({ newRows: 0, duplicateRows: 2 });
    expect(notesOf(db)).toEqual(fresh());
  });

  it('after an unusable campaign budget: good, faulty, good ends with the calls a fresh load of the good export has', () => {
    const db = memoryDb();
    seedFromTexts(db, asTexts(good));
    const faulty = { ...good, campaigns: csvTexts({ campaigns: [campaignLine('cmp_a', 'Alpha', 'social', 'abc'), campaignLine('cmp_b', 'Beta', 'display', '50')] }).campaigns };
    seedFromTexts(db, asTexts(faulty));
    seedFromTexts(db, asTexts(good));
    expect(notesOf(db)).toEqual(fresh());
  });

  it('A, then B with the same updated_at, then A again: A wins, as the later row does', () => {
    const db = memoryDb();
    const a = csvTexts({ calls: [callLine({ outcome: 'missed' })] });
    const b = csvTexts({ calls: [callLine({ answered: 'true', outcome: 'not_qualified' })] });
    seedFromTexts(db, asTexts(a));
    seedFromTexts(db, asTexts(b));
    expect(readStore(db).calls[0]!.outcome).toBe('not_qualified');
    expect(seedFromTexts(db, asTexts(a))).toMatchObject({ newRows: 0, duplicateRows: 1, newVersions: 0 });
    expect(readStore(db).calls[0]!.outcome).toBe('missed');
  });

  it('the same holds for bad rows: good, bad, good again leaves the call good; bad again makes it bad', () => {
    const db = memoryDb();
    const goodRow = csvTexts({ calls: [callLine()] });
    const badRow = csvTexts({ calls: [callLine({ answered: 'maybe' })] });
    for (const texts of [goodRow, badRow, goodRow]) seedFromTexts(db, asTexts(texts));
    expect(readStore(db).calls).toHaveLength(1);
    seedFromTexts(db, asTexts(badRow));
    expect(readStore(db).dataNotes.badCalls).toBe(1);
  });
});

describe('a call re-checked against a stored office', () => {
  it('names a campaign the file has as unusable invalid_campaign, as the CSV route does', () => {
    const db = memoryDb();
    seedFromTexts(db, asTexts(csvTexts()));
    const later = csvTexts({
      calls: [callLine({ location_id: 'loc_b', campaign_id: 'cmp_x' })],
      campaigns: [campaignLine('cmp_x', 'Broken', 'tv', '10')],
      locations: [locationLine('loc_a', 'Office A', 'America/Phoenix')],
    });
    seedFromTexts(db, asTexts(later));
    expect(readStore(db).dataNotes.badRowsByReason).toMatchObject({ invalid_campaign: 1, unknown_campaign: 0, unknown_location: 0 });
  });
});

describe('a campaign with no budget', () => {
  it('survives a seed: stored as null, its calls count, and the note is kept', () => {
    const db = memoryDb();
    const texts = csvTexts({
      calls: [callLine({ campaign_id: 'cmp_a' })],
      campaigns: [campaignLine('cmp_a', 'Alpha', 'social', ''), campaignLine('cmp_b', 'Beta', 'display', '$150.00')],
    });
    seedFromTexts(db, asTexts(texts));
    const store = readStore(db);
    expect(store.campaigns.map((c) => [c.id, c.dailyBudgetUsd])).toEqual([['cmp_a', null], ['cmp_b', null]]);
    expect(store.calls.map((c) => c.campaignId)).toEqual(['cmp_a']);
    expect(store.dataNotes.referenceIssues.map((i) => i.reason)).toEqual(['no_budget', 'bad_budget']);
    expect(store).toEqual(cleanExport(loadExport(texts)));
  });
});
