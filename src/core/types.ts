export const OUTCOMES = ['booked', 'qualified_lead', 'not_qualified', 'missed', 'voicemail'] as const;
export const CHANNELS = ['paid_search', 'social', 'display', 'organic', 'direct', 'referral'] as const;
export type Outcome = (typeof OUTCOMES)[number];
export type Channel = (typeof CHANNELS)[number];

export interface Campaign {
  id: string;
  name: string;
  channel: Channel;
  /** null: blank or unreadable in campaigns.csv. Its calls still count; every budget-based estimate is blank. */
  dailyBudgetUsd: number | null;
}

export interface Location {
  id: string;
  name: string;
  timezone: string;
  /** False when `timezone` is not a valid IANA zone; calls at this office are then bad. */
  timezoneValid: boolean;
}

/** In the order the checks run; the first failing check names the reason. */
export const BAD_REASONS = [
  'missing_call_id',
  'truncated_row',
  'bad_timestamp',
  'unknown_location',
  'invalid_timezone',
  'unknown_campaign',
  'invalid_campaign',
  'bad_boolean',
  'bad_outcome',
  'inconsistent_outcome',
  'bad_channel',
  'bad_duration',
  'bad_revenue',
] as const;
export type BadReason = (typeof BAD_REASONS)[number];

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
  /** Raw rows (valid or bad) whose updated_at could not be parsed; they lose any dedupe (Phase 2 data notes). */
  unparseableUpdatedAt: number;
  /** Valid rows whose ended_at could not be parsed (bad rows don't parse it). */
  unparseableEndedAt: number;
  referenceIssues: ReferenceIssue[];
  /** Human-readable, e.g. "calls.csv is empty: starting with zero calls". */
  notes: string[];
}

/** One call after cleaning: the winning row, localized to its office. */
export interface CleanCall {
  callId: string;
  startedAt: Date;
  durationSeconds: number;
  callerHash: string;
  trackingNumber: string;
  /** null = "Unattributed" (empty campaign_id in the file). */
  campaignId: string | null;
  unattributed: boolean;
  channel: Channel;
  locationId: string;
  answered: boolean;
  outcome: Outcome | null;
  /** outcome === 'booked' */
  booked: boolean;
  /** answered with no outcome yet */
  pending: boolean;
  /** Counted revenue: the file value on a booked call (0 if empty), otherwise 0. */
  revenueUsd: number;
  agentId: string | null;
  /** "YYYY-MM-DD" in the office time zone. */
  localDate: string;
  /** 0-23 in the office time zone. */
  localHour: number;
  /** 0 = Monday ... 6 = Sunday, in the office time zone. */
  localWeekday: number;
}

/** What the cleaning did. Only badRows (the header's "rows skipped") and notes (the start-up message, the empty screen) are shown. */
export interface DataNotes {
  rowsRead: number;
  /** Distinct calls, good or bad. */
  callsAfterDedup: number;
  duplicateRowsCollapsed: number;
  /** Calls whose latest updated_at was shared by two or more rows. */
  tiedCalls: number;
  unattributedCalls: number;
  /** Unattributed calls with an empty tracking_number (left out of the list below). */
  unattributedWithoutTrackingNumber: number;
  /** Calls with an empty caller_number_hash: they count as calls but not toward unique callers. */
  callsWithoutCallerHash: number;
  /** Tracking numbers on unattributed calls, most calls first, ties by number. */
  unattributedTrackingNumbers: { trackingNumber: string; calls: number }[];
  pendingCalls: number;
  /** Per CALL after dedupe. Every reason is present. */
  badCallsByReason: Record<BadReason, number>;
  badCalls: number;
  /** Per RAW row, as Phase 1 counted them; every reason is present. The header "rows skipped" uses badRows. */
  badRowsByReason: Record<BadReason, number>;
  badRows: number;
  /** Campaign or location rows skipped or flagged while loading; they explain some bad calls. */
  referenceIssues: ReferenceIssue[];
  /** Calls with revenue on a non-booked current row (ignored), and the dollars ignored. */
  revenueOnNonBookedCalls: number;
  revenueOnNonBookedUsd: number;
  /** Booked calls whose revenue field is empty (counted as $0). */
  bookedWithoutRevenueCalls: number;
  /** Carried over from LoadedExport. */
  unparseableUpdatedAt: number;
  /** Valid rows whose ended_at could not be parsed. */
  unparseableEndedAt: number;
  notes: string[];
}

export interface CallStore {
  /** File order of each call's first row. */
  calls: CleanCall[];
  campaigns: Campaign[];
  locations: Location[];
  dataNotes: DataNotes;
}
