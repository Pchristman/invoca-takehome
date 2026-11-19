import { loadExport } from '../../src/core/loadExport';
import { CALL_COLUMNS } from '../../src/core/validate';
import type { CleanCall, LoadedExport } from '../../src/core/types';

export const CAMPAIGNS = 'campaign_id,name,channel,daily_budget_usd\ncmp_a,Alpha,social,10\ncmp_b,Beta,direct,0\n';
export const LOCATIONS =
  'location_id,name,timezone\nloc_1,One,America/Phoenix\nloc_2,Two,America/Denver\nloc_bad,Bad,Mars/Olympus\n';

/** A valid raw calls row with every column filled; override any column by name. */
export const goodRow = (over: Record<string, string> = {}): Record<string, string> => ({
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

export const callsCsv = (rows: Record<string, string>[], columns: readonly string[] = CALL_COLUMNS) =>
  [columns.join(','), ...rows.map((r) => columns.map((c) => r[c] ?? '').join(','))].join('\n') + '\n';

/** Run raw rows through the Phase 1 loader. */
export const loadFixture = (
  rows: Record<string, string>[],
  campaigns = CAMPAIGNS,
  locations = LOCATIONS,
): LoadedExport => loadExport({ calls: callsCsv(rows), campaigns, locations });

let callCounter = 0;

/** A booked, answered, cleaned call with every field filled; override any field by name. */
export const makeCall = (over: Partial<CleanCall> = {}): CleanCall => {
  callCounter += 1;
  return {
    callId: `call_${callCounter}`,
    startedAt: new Date('2026-09-10T16:00:00Z'),
    durationSeconds: 97,
    callerHash: `h_${callCounter}`,
    trackingNumber: '+1-555-0100',
    campaignId: 'cmp_a',
    unattributed: false,
    channel: 'social',
    locationId: 'loc_1',
    answered: true,
    outcome: 'booked',
    booked: true,
    pending: false,
    revenueUsd: 100,
    agentId: 'agt_1',
    localDate: '2026-09-10',
    localHour: 10,
    localWeekday: 3,
    ...over,
  };
};
