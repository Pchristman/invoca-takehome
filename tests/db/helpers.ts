import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/db/database';

const CALL_COLUMNS = [
  'call_id', 'started_at', 'ended_at', 'duration_seconds', 'caller_number_hash', 'tracking_number', 'campaign_id',
  'marketing_channel', 'location_id', 'answered', 'outcome', 'revenue_usd', 'agent_id', 'updated_at',
] as const;
type CallColumn = (typeof CALL_COLUMNS)[number];

const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
const line = (values: string[]) => values.map(cell).join(',');

/** One calls.csv data line: a valid, unanswered, missed call for cmp_a at loc_a unless overridden. */
export function callLine(overrides: Partial<Record<CallColumn, string>> = {}): string {
  const base: Record<CallColumn, string> = {
    call_id: 'c_1',
    started_at: '2026-09-01T16:00:00Z',
    ended_at: '2026-09-01T16:01:00Z',
    duration_seconds: '60',
    caller_number_hash: 'h_1',
    tracking_number: '+1-555-0100',
    campaign_id: 'cmp_a',
    marketing_channel: 'social',
    location_id: 'loc_a',
    answered: 'false',
    outcome: 'missed',
    revenue_usd: '',
    agent_id: '',
    updated_at: '2026-09-01T16:02:00Z',
  };
  return line(CALL_COLUMNS.map((c) => overrides[c] ?? base[c]));
}

export const campaignLine = (id: string, name: string, channel: string, budget: string) => line([id, name, channel, budget]);
export const locationLine = (id: string, name: string, timezone: string) => line([id, name, timezone]);

/** The three CSV texts. Lines are data rows without the header; campaigns and locations default to two of each. */
export function csvTexts(parts: { calls?: string[]; campaigns?: string[]; locations?: string[] } = {}) {
  const campaigns = parts.campaigns ?? [campaignLine('cmp_a', 'Alpha', 'social', '100'), campaignLine('cmp_b', 'Beta', 'display', '50')];
  const locations = parts.locations ?? [locationLine('loc_a', 'Office A', 'America/Phoenix'), locationLine('loc_b', 'Office B', 'America/Denver')];
  const table = (header: string, rows: string[]) => [header, ...rows].join('\n') + '\n';
  return {
    calls: table(CALL_COLUMNS.join(','), parts.calls ?? []),
    campaigns: table('campaign_id,name,channel,daily_budget_usd', campaigns),
    locations: table('location_id,name,timezone', locations),
  };
}

export const memoryDb = (): DatabaseSync => openDatabase(':memory:');

export const count = (db: DatabaseSync, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

export const noSource = { label: 'test', hashes: { calls: '', campaigns: '', locations: '' } };

/** A small export that exercises every cleaning rule at once. Shared by the read and cleaned_calls tests. */
export function messyTexts() {
  const calls = [
    // c_multi: three rows arriving out of order; the 10:30 one is the latest
    callLine({ call_id: 'c_multi', updated_at: '2026-09-01T10:30:00Z', answered: 'true', outcome: 'booked', revenue_usd: '200' }),
    callLine({ call_id: 'c_multi', updated_at: '2026-09-01T10:00:00Z', answered: 'true', outcome: '' }),
    callLine({ call_id: 'c_multi', updated_at: '2026-09-01T10:10:00Z', answered: 'true', outcome: 'qualified_lead' }),
    // c_tie: two rows share the latest updated_at; the later row in the file wins
    callLine({ call_id: 'c_tie', updated_at: '2026-09-01T12:00:00Z', outcome: 'missed' }),
    callLine({ call_id: 'c_tie', updated_at: '2026-09-01T12:00:00Z', answered: 'true', outcome: 'not_qualified' }),
    // c_badlatest: a good older row, then a bad newer one: the call is bad
    callLine({ call_id: 'c_badlatest', updated_at: '2026-09-01T10:00:00Z' }),
    callLine({ call_id: 'c_badlatest', updated_at: '2026-09-01T11:00:00Z', location_id: 'loc_nope' }),
    // no campaign, revenue on a call that did not book, a booked call with no revenue, a booked call with 0, a pending call
    callLine({ call_id: 'c_unattr', campaign_id: '', tracking_number: '' }),
    callLine({ call_id: 'c_revnb', answered: 'true', outcome: 'qualified_lead', revenue_usd: '40' }),
    callLine({ call_id: 'c_bookempty', answered: 'true', outcome: 'booked', revenue_usd: '' }),
    callLine({ call_id: 'c_bookzero', answered: 'true', outcome: 'booked', revenue_usd: '0' }),
    callLine({ call_id: 'c_pending', answered: 'true', outcome: '', caller_number_hash: '' }),
    // 02:00 UTC is the evening before in Phoenix (UTC-7) and Denver
    callLine({ call_id: 'c_late', started_at: '2026-09-02T02:00:00Z', location_id: 'loc_a' }),
    callLine({ call_id: 'c_denver', started_at: '2026-09-02T02:00:00Z', location_id: 'loc_b', campaign_id: 'cmp_b', marketing_channel: 'display' }),
    // bad rows and unparseable dates
    callLine({ call_id: 'c_unknownloc', location_id: 'loc_nope' }),
    callLine({ call_id: 'c_badtime', started_at: 'not a time' }),
    callLine({ call_id: 'c_baddates', ended_at: 'garbage', updated_at: 'garbage' }),
  ];
  return csvTexts({
    calls,
    campaigns: [
      campaignLine('cmp_a', `O'Brien; DROP TABLE x -- "Café, Ltd"`, 'social', '100'),
      campaignLine('cmp_b', 'Beta', 'display', '0'),
    ],
  });
}
