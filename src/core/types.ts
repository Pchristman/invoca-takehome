export const OUTCOMES = ['booked', 'qualified_lead', 'not_qualified', 'missed', 'voicemail'] as const;
export const CHANNELS = ['paid_search', 'social', 'display', 'organic', 'direct', 'referral'] as const;
export type Outcome = (typeof OUTCOMES)[number];
export type Channel = (typeof CHANNELS)[number];

export interface Campaign {
  id: string;
  name: string;
  channel: string;
  dailyBudgetUsd: number;
}

export interface Location {
  id: string;
  name: string;
  timezone: string;
  /** False when `timezone` is not a valid IANA zone; calls at this office are then bad. */
  timezoneValid: boolean;
}

export type BadReason =
  | 'missing_call_id'
  | 'bad_timestamp'
  | 'unknown_location'
  | 'invalid_timezone'
  | 'unknown_campaign'
  | 'bad_boolean'
  | 'bad_outcome'
  | 'bad_channel'
  | 'bad_duration'
  | 'bad_revenue';

export interface Call {
  /** 1-based data row in calls.csv, header excluded. */
  rowNumber: number;
  callId: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number;
  callerHash: string;
  trackingNumber: string;
  /** null = empty in the file (becomes "Unattributed" in Phase 2). */
  campaignId: string | null;
  channel: Channel;
  locationId: string;
  answered: boolean;
  outcome: Outcome | null;
  revenueUsd: number | null;
  agentId: string | null;
  /** null = unparseable; it loses any dedupe against a parseable row. */
  updatedAt: Date | null;
}

export interface BadRow {
  rowNumber: number;
  callId: string;
  updatedAt: Date | null;
  reason: BadReason;
  detail: string;
}

export type RowResult = { ok: true; call: Call } | { ok: false; bad: BadRow };

export interface ReferenceIssue {
  file: 'campaigns.csv' | 'locations.csv';
  rowNumber: number;
  reason: string;
  detail: string;
}

export interface LoadedExport {
  campaigns: Campaign[];
  locations: Location[];
  /** One per raw calls row, file order, duplicates kept. */
  rows: RowResult[];
  /** Always equals rows.length. */
  rowsRead: number;
  /** Counted per RAW row. Every reason is present (0 if none). */
  badByReason: Record<BadReason, number>;
  referenceIssues: ReferenceIssue[];
  /** Human-readable, e.g. "calls.csv is empty: starting with zero calls". */
  notes: string[];
}
