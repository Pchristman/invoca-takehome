import type { ExportTexts, ExtendedConfig } from '../../scripts/generate-extended';
import { DEFAULT_CONFIG } from '../../scripts/generate-extended';

export const CALL_HEADER =
  'call_id,started_at,ended_at,duration_seconds,caller_number_hash,tracking_number,campaign_id,marketing_channel,location_id,answered,outcome,revenue_usd,agent_id,updated_at';

export interface RawCall {
  id: string;
  start: string; // ISO UTC, whole seconds
  dur?: number;
  campaign?: string; // '' = unattributed
  channel?: string;
  tracking?: string;
  loc?: string;
  answered?: boolean;
  outcome?: string; // '' = none
  revenue?: string;
  agent?: string;
  hash?: string; // caller_number_hash; default is unique per call
  /** Seconds after the call ends that the row was last updated. */
  lagSeconds?: number;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** One CSV line (no line ending) from a readable description. */
export const callLine = (c: RawCall): string => {
  const dur = c.dur ?? 60;
  const start = Date.parse(c.start);
  const end = start + dur * 1000;
  const answered = c.answered ?? true;
  const campaign = c.campaign ?? 'camp_a';
  const channel = c.channel ?? (campaign === 'camp_b' ? 'social' : 'paid_search');
  return [
    c.id,
    c.start,
    iso(end),
    dur,
    c.hash ?? `h_${c.id}`,
    c.tracking ?? (campaign === 'camp_b' ? '+1-555-0002' : '+1-555-0001'),
    campaign,
    channel,
    c.loc ?? 'loc_a',
    answered ? 'true' : 'false',
    c.outcome ?? '',
    c.revenue ?? '',
    c.agent ?? (answered ? 'agt_1' : ''),
    iso(end + (c.lagSeconds ?? 10) * 1000),
  ].join(',');
};

/** A calls.csv text with CRLF after every line, like the shipped file. */
export const callsText = (rows: RawCall[], extraLines: string[] = []): string =>
  [CALL_HEADER, ...rows.map(callLine), ...extraLines].join('\r\n') + '\r\n';

export const CAMPAIGNS_TEXT =
  'campaign_id,name,channel,daily_budget_usd\r\ncamp_a,Alpha Search,paid_search,40\r\ncamp_b,Beta Social,social,25\r\n';
export const LOCATIONS_TEXT =
  'location_id,name,timezone\r\nloc_a,Canyon,America/Phoenix\r\nloc_b,Riverside,America/New_York\r\n';

const MISSED = { answered: false, outcome: 'missed' } as const;
const BOOKED = { outcome: 'booked' } as const;

const ROWS: RawCall[] = [
  // camp_a: 3 unanswered, 3 booked, 4 answered not booked
  { id: 'a01', start: '2026-09-20T14:00:00Z', ...MISSED },
  { id: 'a02', start: '2026-09-27T15:30:00Z', loc: 'loc_b', ...MISSED },
  { id: 'a03', start: '2026-10-05T16:00:00Z', answered: false, outcome: 'voicemail' },
  { id: 'a04', start: '2026-10-12T17:10:00Z', ...BOOKED, revenue: '200' },
  { id: 'a05', start: '2026-10-20T18:00:00Z', loc: 'loc_b', ...BOOKED, revenue: '300' },
  { id: 'a06', start: '2026-10-28T19:00:00Z', loc: 'loc_b', outcome: 'qualified_lead' },
  { id: 'a07', start: '2026-11-03T20:00:00Z', outcome: 'not_qualified' },
  { id: 'a08', start: '2026-11-10T21:00:00Z', loc: 'loc_b', outcome: 'qualified_lead' },
  { id: 'a09', start: '2026-11-14T13:00:00Z', ...BOOKED, revenue: '250' },
  { id: 'a10', start: '2026-11-19T22:00:00Z', outcome: 'not_qualified' },
  // camp_b: 3 unanswered, 3 booked, 4 answered not booked
  { id: 'b01', start: '2026-09-20T01:00:00Z', campaign: 'camp_b', loc: 'loc_b', ...MISSED },
  { id: 'b02', start: '2026-09-29T14:00:00Z', campaign: 'camp_b', ...MISSED },
  { id: 'b03', start: '2026-10-07T15:00:00Z', campaign: 'camp_b', loc: 'loc_b', answered: false, outcome: 'voicemail' },
  { id: 'b04', start: '2026-10-14T16:00:00Z', campaign: 'camp_b', ...BOOKED, revenue: '150' },
  { id: 'b05', start: '2026-10-22T17:00:00Z', campaign: 'camp_b', loc: 'loc_b', ...BOOKED, revenue: '175' },
  { id: 'b06', start: '2026-10-30T18:00:00Z', campaign: 'camp_b', outcome: 'qualified_lead' },
  { id: 'b07', start: '2026-11-05T19:00:00Z', campaign: 'camp_b', loc: 'loc_b', outcome: 'not_qualified' },
  { id: 'b08', start: '2026-11-11T20:00:00Z', campaign: 'camp_b', outcome: 'qualified_lead' },
  { id: 'b09', start: '2026-11-16T21:00:00Z', campaign: 'camp_b', loc: 'loc_b', ...BOOKED, revenue: '225' },
  { id: 'b10', start: '2026-11-20T12:00:00Z', campaign: 'camp_b', loc: 'loc_b', outcome: 'not_qualified' },
  // unattributed, pending
  { id: 'u01', start: '2026-10-03T12:00:00Z', campaign: '', channel: 'direct', tracking: '+1-555-0009', ...MISSED },
  { id: 'u02', start: '2026-11-08T12:00:00Z', campaign: '', channel: 'direct', tracking: '+1-555-0009', outcome: 'qualified_lead' },
  { id: 'p01', start: '2026-11-19T10:00:00Z', outcome: '' },
];

// One call seen twice, two days apart: first row has no outcome yet, the later one does.
const DUP_FIRST: RawCall = { id: 'd01', start: '2026-10-25T15:00:00Z', outcome: '', revenue: '' };
const DUP_LATER = (): string => {
  const line = callLine({ id: 'd01', start: '2026-10-25T15:00:00Z', ...BOOKED, revenue: '180', lagSeconds: 2 * 86400 });
  return line;
};

export const FIXTURE: ExportTexts = {
  calls: callsText([...ROWS, DUP_FIRST], [DUP_LATER()]),
  campaigns: CAMPAIGNS_TEXT,
  locations: LOCATIONS_TEXT,
};

export const TINY: ExtendedConfig = {
  ...DEFAULT_CONFIG,
  seed: 7,
  windowDays: 28,
  officeAnswerDrop: { locationId: 'loc_a', weekdays: { from: 0, to: 4 }, hours: { from: 9, to: 11 }, calls: 6, answered: 2 },
  officeLowConversion: { locationId: 'loc_b', calls: 6, unanswered: 1, booked: 1 },
  campaignSurge: { campaignId: 'camp_a', calls: 6, unanswered: 1, booked: 2 },
  campaignFade: { campaignId: 'camp_b', calls: 6, unanswered: 1, booked: 0 },
  plainCalls: 5,
  unattributedCalls: 2,
  pendingCalls: 1,
  duplicatedCalls: 3,
  threeRowCalls: 1,
};

/** TINY with every group switched off, so a test turns on only what it checks. */
export const OFF: ExtendedConfig = {
  ...TINY,
  officeAnswerDrop: { ...TINY.officeAnswerDrop, calls: 0, answered: 0 },
  officeLowConversion: { ...TINY.officeLowConversion, calls: 0, unanswered: 0, booked: 0 },
  campaignSurge: { ...TINY.campaignSurge, calls: 0, unanswered: 0, booked: 0 },
  campaignFade: { ...TINY.campaignFade, calls: 0, unanswered: 0, booked: 0 },
  plainCalls: 0,
  unattributedCalls: 0,
  pendingCalls: 0,
  duplicatedCalls: 0,
  threeRowCalls: 0,
};
