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
