import { describe, expect, test } from 'vitest';
import { loadExport } from '../../src/core/loadExport';
import { LoadError } from '../../src/core/errors';
import { CALL_COLUMNS } from '../../src/core/validate';
import type { BadReason } from '../../src/core/types';

const CAMPAIGNS = 'campaign_id,name,channel,daily_budget_usd\ncmp_a,Alpha,social,10\ncmp_b,Beta,direct,0\n';
const LOCATIONS = 'location_id,name,timezone\nloc_1,One,America/Phoenix\nloc_2,Two,America/Denver\nloc_bad,Bad,Mars/Olympus\n';

const goodRow = (over: Record<string, string> = {}): Record<string, string> => ({
  call_id: 'call_1',
  started_at: '2026-03-02T10:00:00Z',
  ended_at: '2026-03-02T10:01:37Z',
  duration_seconds: '97',
  caller_number_hash: 'h_1',
  tracking_number: '+1-555-0100',
  campaign_id: 'cmp_a',
  marketing_channel: 'social',
  location_id: 'loc_1',
  answered: 'true',
  outcome: 'booked',
  revenue_usd: '250',
  agent_id: 'agt_1',
  updated_at: '2026-03-03T08:00:00Z',
  ...over,
});

const callsCsv = (rows: Record<string, string>[], columns: readonly string[] = CALL_COLUMNS) =>
  [columns.join(','), ...rows.map((r) => columns.map((c) => r[c] ?? '').join(','))].join('\n') + '\n';

const load = (rows: Record<string, string>[], campaigns = CAMPAIGNS, locations = LOCATIONS) =>
  loadExport({ calls: callsCsv(rows), campaigns, locations });

describe('loadExport', () => {
  test('three rows for one call_id are all kept, in file order', () => {
    const result = load([
      goodRow({ updated_at: '2026-03-03T08:00:00Z' }),
      goodRow({ updated_at: '2026-03-01T08:00:00Z' }),
      goodRow({ updated_at: '2026-03-05T08:00:00Z' }),
    ]);
    expect(result.rows).toHaveLength(3);
    expect(result.rowsRead).toBe(3);
    expect(result.rows.map((r) => (r.ok ? r.call.rowNumber : r.bad.rowNumber))).toEqual([1, 2, 3]);
  });

  test('a bad latest row is kept with its callId and updatedAt', () => {
    const result = load([goodRow(), goodRow({ location_id: 'loc_zzz', updated_at: '2026-03-09T00:00:00Z' })]);
    const last = result.rows[1];
    expect(last?.ok).toBe(false);
    if (last?.ok === false) {
      expect(last.bad.callId).toBe('call_1');
      expect(last.bad.updatedAt).toEqual(new Date('2026-03-09T00:00:00Z'));
    }
  });

  test('badByReason counts every reason per raw row and sums to the bad rows', () => {
    const result = load([
      goodRow(),
      goodRow({ call_id: '' }),
      goodRow({ call_id: 'c2', started_at: 'garbage' }),
      goodRow({ call_id: 'c3', location_id: 'loc_zzz' }),
      goodRow({ call_id: 'c4', location_id: 'loc_bad' }),
      goodRow({ call_id: 'c5', campaign_id: 'cmp_zzz' }),
      goodRow({ call_id: 'c6', answered: 'maybe' }),
      goodRow({ call_id: 'c7', outcome: 'won' }),
      goodRow({ call_id: 'c8', marketing_channel: 'tv' }),
      goodRow({ call_id: 'c9', duration_seconds: '-3' }),
      goodRow({ call_id: 'c10', revenue_usd: 'abc' }),
      goodRow({ call_id: 'c11', answered: 'false' }),
    ]);
    const reasons: BadReason[] = [
      'missing_call_id',
      'bad_timestamp',
      'unknown_location',
      'invalid_timezone',
      'unknown_campaign',
      'bad_boolean',
      'bad_outcome',
      'inconsistent_outcome',
      'bad_channel',
      'bad_duration',
      'bad_revenue',
    ];
    expect(Object.keys(result.badByReason).sort()).toEqual([...reasons].sort());
    for (const reason of reasons) expect(result.badByReason[reason]).toBe(1);
    const badTotal = result.rows.filter((r) => !r.ok).length;
    expect(Object.values(result.badByReason).reduce((a, b) => a + b, 0)).toBe(badTotal);
    expect(result.rowsRead).toBe(12);
  });

  test('unparseable updated_at (any row) and ended_at (valid rows) are counted', () => {
    const result = load([
      goodRow({ call_id: 'c1', updated_at: 'nope' }),
      goodRow({ call_id: 'c2', ended_at: '' }),
      goodRow({ call_id: 'c3', ended_at: 'nope', updated_at: '' }),
      goodRow({ call_id: 'c4', location_id: 'loc_zzz', updated_at: 'nope' }),
      goodRow({ call_id: 'c5' }),
    ]);
    expect(result.unparseableUpdatedAt).toBe(3);
    expect(result.unparseableEndedAt).toBe(2);
  });

  test('a calls file with mixed LF and CRLF endings keeps every row', () => {
    const lines = callsCsv([goodRow({ call_id: 'c1' }), goodRow({ call_id: 'c2' }), goodRow({ call_id: 'c3' })])
      .trimEnd()
      .split('\n');
    const calls = lines.map((line, i) => line + (i % 2 === 0 ? '\r\n' : '\n')).join('');
    const result = loadExport({ calls, campaigns: CAMPAIGNS, locations: LOCATIONS });
    expect(result.rowsRead).toBe(3);
    expect(result.rows.every((r) => r.ok)).toBe(true);
  });

  test('all reasons are present with 0 when nothing is bad', () => {
    const result = load([goodRow()]);
    expect(Object.values(result.badByReason)).toHaveLength(11);
    expect(Object.values(result.badByReason).every((n) => n === 0)).toBe(true);
  });

  test('zero-byte calls.csv gives zero rows and a note', () => {
    const result = loadExport({ calls: '', campaigns: CAMPAIGNS, locations: LOCATIONS });
    expect(result.rows).toEqual([]);
    expect(result.rowsRead).toBe(0);
    expect(result.notes).toContain('calls.csv is empty: starting with zero calls');
  });

  test('header-only calls.csv gives zero rows and a note', () => {
    const result = loadExport({ calls: callsCsv([]), campaigns: CAMPAIGNS, locations: LOCATIONS });
    expect(result.rowsRead).toBe(0);
    expect(result.notes).toContain('calls.csv is empty: starting with zero calls');
  });

  test('zero-byte campaigns.csv: campaign calls are unknown_campaign, unattributed calls stay ok', () => {
    const result = load([goodRow(), goodRow({ call_id: 'c2', campaign_id: '' })], '');
    expect(result.campaigns).toEqual([]);
    expect(result.notes).toContain('campaigns.csv is empty: starting with zero campaigns');
    expect(result.rows[0]?.ok).toBe(false);
    expect(result.rows[1]?.ok).toBe(true);
    expect(result.badByReason.unknown_campaign).toBe(1);
  });

  test('a missing required column in locations.csv throws a LoadError naming the file', () => {
    expect(() => load([goodRow()], CAMPAIGNS, 'location_id,name\nloc_1,One\n')).toThrow(LoadError);
    expect(() => load([goodRow()], CAMPAIGNS, 'location_id,name\nloc_1,One\n')).toThrow(/locations\.csv/);
  });

  test('reordered and extra columns in calls.csv still load', () => {
    const columns = ['extra', ...[...CALL_COLUMNS].reverse()];
    const calls = callsCsv([{ ...goodRow(), extra: 'x' }], columns);
    const result = loadExport({ calls, campaigns: CAMPAIGNS, locations: LOCATIONS });
    expect(result.rows[0]?.ok).toBe(true);
  });

  test('reference issues flow through; calls to a skipped campaign are unknown_campaign', () => {
    const campaigns = 'campaign_id,name,channel,daily_budget_usd\ncmp_a,Alpha,social,10\ncmp_x,Broken,social,abc\n';
    const result = load([goodRow(), goodRow({ call_id: 'c2', campaign_id: 'cmp_x' })], campaigns);
    // One from campaigns.csv (bad budget) and one from the shared LOCATIONS fixture (invalid zone).
    expect(result.referenceIssues).toHaveLength(2);
    expect(result.referenceIssues).toContainEqual(
      expect.objectContaining({ file: 'campaigns.csv', rowNumber: 2, reason: 'bad_budget' }),
    );
    expect(result.referenceIssues).toContainEqual(
      expect.objectContaining({ file: 'locations.csv', rowNumber: 3, reason: 'invalid_timezone' }),
    );
    expect(result.rows[1]?.ok).toBe(false);
    expect(result.badByReason.unknown_campaign).toBe(1);
  });

  test('CRLF line endings and a quoted comma in a campaign name load end to end', () => {
    const campaigns = 'campaign_id,name,channel,daily_budget_usd\r\ncmp_a,"Search, Brand",social,10\r\n';
    const calls = callsCsv([goodRow()]).replace(/\n/g, '\r\n');
    const result = loadExport({ calls, campaigns, locations: LOCATIONS.replace(/\n/g, '\r\n') });
    expect(result.campaigns[0]?.name).toBe('Search, Brand');
    expect(result.locations[0]?.timezone).toBe('America/Phoenix');
    expect(result.rows[0]?.ok).toBe(true);
  });
});
