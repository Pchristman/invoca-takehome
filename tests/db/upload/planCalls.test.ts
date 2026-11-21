import { describe, expect, test } from 'vitest';
import { seedFromTexts } from '../../../src/db/prepare';
import { readExportTexts } from '../../../src/node/readDataDir';
import { planUpload } from '../../../src/db/upload/plan';
import { readUpload } from '../../../src/db/upload/detect';
import { CALL_COLUMNS } from '../../../src/core/validate';
import { cleanExport } from '../../../src/core/clean';
import { loadExport } from '../../../src/core/loadExport';
import { callLine, campaignLine, count, csvTexts, memoryDb } from '../helpers';
import { csvOf, seeded } from './helpers';

const HEADER = CALL_COLUMNS.join(',');
const STORED_TIME = '2026-09-01T16:02:00Z'; // callLine's default updated_at

const database = () =>
  seeded({ calls: [callLine({ call_id: 'c_1' }), callLine({ call_id: 'c_2', updated_at: '2026-09-01T17:00:00Z' })] });
const upload = (lines: string[]) => readUpload('calls.csv', csvOf(HEADER, lines));
const plan = (db: ReturnType<typeof database>, lines: string[]) => planUpload(db, upload(lines));
const calls = (p: ReturnType<typeof planUpload>) => (p.kind === 'calls' ? p.calls : []);

const HINT_CAMPAIGN = (n: number) => `${n} rows name a campaign that is not in the database. Upload campaigns.csv first, then upload this file again.`;
const HINT_OFFICE = (n: number) => `${n} rows name an office that is not in the database. Upload locations.csv first, then upload this file again.`;
const HINT_CONFLICT = (n: number) => `${n} rows have the same call and time as a stored or earlier row but different values. They are not added.`;
const HINT_NEWER_BAD = (n: number) => `${n} bad rows are newer versions of calls already in the database; those calls keep their older, valid version.`;

describe('planUpload on calls', () => {
  test('the same file again: every row is a duplicate', () => {
    const p = plan(database(), [callLine({ call_id: 'c_1' }), callLine({ call_id: 'c_2', updated_at: '2026-09-01T17:00:00Z' })]);
    expect(p.preview.counts).toEqual({ rowsRead: 2, newRows: 0, newVersions: 0, duplicates: 2, conflicts: 0, bad: 0 });
    expect(calls(p)).toEqual([]);
  });

  test('a new call_id is a new row', () => {
    const p = plan(database(), [callLine({ call_id: 'c_new', duration_seconds: '90' })]);
    expect(p.preview.counts).toMatchObject({ newRows: 1, newVersions: 0, duplicates: 0 });
    expect(calls(p).map((c) => [c.callId, c.durationSeconds, c.rowNumber])).toEqual([['c_new', 90, 1]]);
  });

  test('a stored call_id with a new updated_at is a new version', () => {
    const p = plan(database(), [callLine({ call_id: 'c_1', updated_at: '2026-09-01T18:00:00Z', outcome: 'voicemail' })]);
    expect(p.preview.counts).toMatchObject({ newRows: 0, newVersions: 1, duplicates: 0 });
    expect(calls(p)[0]).toMatchObject({ callId: 'c_1', outcome: 'voicemail' });
    expect(calls(p)[0]!.updatedAt!.toISOString()).toBe('2026-09-01T18:00:00.000Z');
  });

  test('a version older than the stored latest is still a new version', () => {
    const p = plan(database(), [callLine({ call_id: 'c_1', updated_at: '2026-09-01T08:00:00Z' })]);
    expect(p.preview.counts.newVersions).toBe(1);
    expect(calls(p)).toHaveLength(1);
  });

  test('a repeat inside the file is a duplicate', () => {
    const line = callLine({ call_id: 'c_new' });
    const p = plan(database(), [line, line]);
    expect(p.preview.counts).toMatchObject({ newRows: 1, duplicates: 1 });
    expect(p.preview.examples.duplicate).toEqual([{ row: 2, id: 'c_new', note: 'repeated in this file (row 1)' }]);
    expect(calls(p)).toHaveLength(1);
  });

  test('two versions of one new call in the file are both new rows', () => {
    const p = plan(database(), [callLine({ call_id: 'c_new' }), callLine({ call_id: 'c_new', updated_at: '2026-09-01T19:00:00Z' })]);
    expect(p.preview.counts).toMatchObject({ newRows: 2, newVersions: 0, duplicates: 0 });
  });

  test('the same call_id and updated_at as a stored call with different values is a conflict, not planned, and hinted', () => {
    const lines = [callLine({ call_id: 'c_1', answered: 'true', outcome: 'booked' })];
    const p = plan(database(), lines);
    expect(p.preview.counts).toEqual({ rowsRead: 1, newRows: 0, newVersions: 0, duplicates: 0, conflicts: 1, bad: 0 });
    expect(calls(p)).toEqual([]);
    expect(p.preview.examples.conflict).toEqual([{ row: 1, id: 'c_1', note: 'differs from the stored call with the same time' }]);
    expect(p.preview.hints).toContain(HINT_CONFLICT(1));
  });

  test('a tie inside the file with different values: the first row is planned, the later one a conflict naming the fields', () => {
    const p = plan(database(), [
      callLine({ call_id: 'c_new', outcome: 'missed' }),
      callLine({ call_id: 'c_new', answered: 'true', outcome: 'booked' }),
    ]);
    expect(p.preview.counts).toEqual({ rowsRead: 2, newRows: 1, newVersions: 0, duplicates: 0, conflicts: 1, bad: 0 });
    expect(calls(p).map((c) => [c.rowNumber, c.outcome])).toEqual([[1, 'missed']]);
    expect(p.preview.examples.conflict[0]).toEqual({
      row: 2,
      id: 'c_new',
      note: 'differs from row 1 in this file: answered is "false" in row 1, "true" in this row; outcome is "missed" in row 1, "booked" in this row',
    });
    expect(p.preview.hints).toContain(HINT_CONFLICT(1));
  });

  test('upload and CSV paths agree on the number of calls for an in-file tie; the upload keeps the first row', () => {
    const lines = [callLine({ call_id: 'c_t', outcome: 'missed' }), callLine({ call_id: 'c_t', answered: 'true', outcome: 'booked' })];
    const csv = cleanExport(loadExport(csvTexts({ calls: lines })));
    const p = plan(seeded(), lines);
    expect(csv.calls).toHaveLength(1);
    expect(calls(p)).toHaveLength(1);
    expect(p.preview.counts.conflicts).toBe(1);
    expect(calls(p)[0]!.rowNumber).toBe(1);
  });

  test('an identical repeat after a tie row is still a duplicate of the first row', () => {
    const p = plan(database(), [callLine({ call_id: 'c_new' }), callLine({ call_id: 'c_new', outcome: 'voicemail' }), callLine({ call_id: 'c_new' })]);
    expect(p.preview.counts).toMatchObject({ newRows: 1, conflicts: 1, duplicates: 1 });
  });

  test('a bad row that is a newer version of a stored call is hinted, never silent', () => {
    const p = plan(database(), [callLine({ call_id: 'c_1', updated_at: '2026-09-02T00:00:00Z', outcome: 'weird' })]);
    expect(p.preview.counts).toMatchObject({ bad: 1, newVersions: 0 });
    expect(p.preview.hints).toContain(HINT_NEWER_BAD(1));
  });

  test('a bad row newer than a call planned earlier in the file is hinted; an older one or an unknown call is not', () => {
    const p = plan(database(), [
      callLine({ call_id: 'n1' }),
      callLine({ call_id: 'n1', updated_at: '2026-09-02T00:00:00Z', outcome: 'weird' }),
      callLine({ call_id: 'c_1', updated_at: '2026-09-01T08:00:00Z', outcome: 'weird' }),
      callLine({ call_id: 'zzz', updated_at: '2026-09-02T00:00:00Z', outcome: 'weird' }),
    ]);
    expect(p.preview.counts.bad).toBe(3);
    expect(p.preview.hints).toContain(HINT_NEWER_BAD(1));
  });

  test('a bad row note is shortened to 100 characters', () => {
    const p = plan(database(), [callLine({ call_id: 'x', outcome: 'z'.repeat(5000) })]);
    const note = p.preview.examples.bad[0]!.note;
    expect(note.length).toBeLessThanOrEqual(103);
    expect(note.endsWith('...')).toBe(true);
  });

  test('a row with no usable updated_at is a duplicate only when the whole row is identical', () => {
    const db = seeded({ calls: [callLine({ call_id: 'c_g', updated_at: 'garbage' })] });
    const same = plan(db, [callLine({ call_id: 'c_g', updated_at: 'garbage' })]);
    expect(same.preview.counts).toMatchObject({ duplicates: 1, newVersions: 0 });
    const different = plan(db, [callLine({ call_id: 'c_g', updated_at: 'garbage', duration_seconds: '61' })]);
    expect(different.preview.counts).toMatchObject({ duplicates: 0, newVersions: 1 });
  });

  test('a call whose latest stored row is bad does not block its corrected row', () => {
    const db = seeded({ calls: [callLine({ call_id: 'c_bad', location_id: 'loc_nope' })] });
    expect(count(db, 'bad_rows')).toBe(1);
    const p = plan(db, [callLine({ call_id: 'c_bad', location_id: 'loc_a' })]);
    expect(p.preview.counts).toMatchObject({ newRows: 1, duplicates: 0, newVersions: 0 });
  });

  test('rows are validated against the stored campaigns and locations, not the file', () => {
    const lines = [
      callLine({ call_id: 'x1', campaign_id: 'cmp_nope' }),
      callLine({ call_id: 'x2', location_id: 'loc_nope' }),
      callLine({ call_id: 'x3', started_at: 'nope' }),
      callLine({ call_id: 'x4', answered: 'maybe' }),
      callLine({ call_id: 'x5', outcome: 'won' }),
      callLine({ call_id: 'x6', duration_seconds: '-5' }),
      callLine({ call_id: '' }),
    ];
    const p = planUpload(database(), upload(lines));
    expect(p.preview.counts.bad).toBe(7);
    expect(p.preview.badByReason).toEqual({
      unknown_campaign: 1, unknown_location: 1, bad_timestamp: 1, bad_boolean: 1, bad_outcome: 1, bad_duration: 1, missing_call_id: 1,
    });
    expect(p.preview.hints).toContain(HINT_CAMPAIGN(1));
    expect(p.preview.hints).toContain(HINT_OFFICE(1));
    const clean = planUpload(database(), upload([callLine({ call_id: 'ok' }), callLine({ call_id: 'x3', started_at: 'nope' })]));
    expect(clean.preview.hints).toEqual([]);
  });

  test('bad rows are never planned', () => {
    const p = plan(database(), [callLine({ call_id: 'ok' }), callLine({ call_id: 'bad', location_id: 'loc_nope' })]);
    expect(calls(p).map((c) => c.callId)).toEqual(['ok']);
    expect(p.preview.counts.bad).toBe(1);
  });

  test('whitespace around ids does not hide a duplicate', () => {
    const p = plan(database(), [callLine({ call_id: ' c_1 ', updated_at: ` ${STORED_TIME} ` })]);
    expect(p.preview.counts.duplicates).toBe(1);
  });

  test('a call that names a campaign the database has only after a campaigns upload', () => {
    const db = database();
    const lines = [callLine({ call_id: 'c_x', campaign_id: 'cmp_c' })];
    expect(plan(db, lines).preview.counts).toMatchObject({ bad: 1, newRows: 0 });
    seedFromTexts(db, { folder: 'more', ...csvTexts({ campaigns: [campaignLine('cmp_c', 'Gamma', 'social', '10')] }) });
    expect(plan(db, lines).preview.counts).toMatchObject({ bad: 0, newRows: 1 });
  });

  test('an unattributed call (empty campaign_id) is fine', () => {
    const p = plan(database(), [callLine({ call_id: 'c_u', campaign_id: '' })]);
    expect(p.preview.counts).toMatchObject({ newRows: 1, bad: 0 });
  });

  test('a mixed file adds up', () => {
    const p = plan(database(), [
      callLine({ call_id: 'c_1' }),
      callLine({ call_id: 'c_1', updated_at: '2026-09-02T00:00:00Z' }),
      callLine({ call_id: 'n1' }),
      callLine({ call_id: 'b1', location_id: 'zzz' }),
      callLine({ call_id: 'n1' }),
    ]);
    const c = p.preview.counts;
    expect(c).toEqual({ rowsRead: 5, newRows: 1, newVersions: 1, duplicates: 2, conflicts: 0, bad: 1 });
    expect(c.newRows + c.newVersions + c.duplicates + c.conflicts + c.bad).toBe(c.rowsRead);
  });

  test('examples are capped at 5 per class, carry the row number and the call id', () => {
    const lines = Array.from({ length: 8 }, (_, i) => callLine({ call_id: `n${i}` }));
    const p = plan(database(), lines);
    expect(p.preview.counts.newRows).toBe(8);
    expect(p.preview.examples.new).toHaveLength(5);
    expect(p.preview.examples.new[2]).toMatchObject({ row: 3, id: 'n2' });
  });

  test('text in ids and names is carried through unchanged', () => {
    const db = database();
    const id = `<img src=x onerror=alert(1)>'; DROP TABLE raw_calls;--`;
    const before = count(db, 'raw_calls');
    const p = plan(db, [callLine({ call_id: id })]);
    expect(calls(p)[0]!.callId).toBe(id);
    expect(count(db, 'raw_calls')).toBe(before);
  });

  test('it never writes', () => {
    const db = database();
    const tables = ['seeds', 'raw_calls', 'bad_rows', 'campaigns', 'locations', 'reference_issues'];
    const before = tables.map((t) => count(db, t));
    planUpload(db, upload([callLine({ call_id: 'n' }), callLine({ call_id: 'c_1', updated_at: '2026-09-05T00:00:00Z' }), callLine({ call_id: 'b', location_id: 'zz' })]));
    expect(tables.map((t) => count(db, t))).toEqual(before);
  });

  test.each([
    ['tests/fixtures/original-export', 5411],
    ['data/extended', 6911],
  ])('the shipped export %s uploaded into a database seeded from it: every row is a duplicate', (dir, rows) => {
    const db = memoryDb();
    const texts = readExportTexts(dir);
    seedFromTexts(db, texts);
    const p = planUpload(db, readUpload('calls.csv', texts.calls));
    expect(p.preview.counts).toEqual({ rowsRead: rows, newRows: 0, newVersions: 0, duplicates: rows, conflicts: 0, bad: 0 });
  });

  test('planUpload on a campaigns file uses the reference planner', () => {
    const file = readUpload('campaigns.csv', csvOf('campaign_id,name,channel,daily_budget_usd', [campaignLine('cmp_z', 'Zed', 'social', '5')]));
    const p = planUpload(database(), file);
    expect(p.kind).toBe('campaigns');
    expect(p.preview.counts.newRows).toBe(1);
  });
});
