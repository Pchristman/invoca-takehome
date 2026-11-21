import { parseBoolean, parseEnum, parseInteger, parseMoney, parseTimestamp } from './fields';
import {
  CHANNELS,
  OUTCOMES,
  type BadReason,
  type Campaign,
  type Location,
  type RowResult,
} from './types';

/** The calls.csv column contract. All are required. */
export const CALL_COLUMNS = [
  'call_id',
  'started_at',
  'ended_at',
  'duration_seconds',
  'caller_number_hash',
  'tracking_number',
  'campaign_id',
  'marketing_channel',
  'location_id',
  'answered',
  'outcome',
  'revenue_usd',
  'agent_id',
  'updated_at',
] as const;

const UNANSWERED_OUTCOMES: readonly string[] = ['missed', 'voicemail'];

/**
 * A plausibility window for started_at, not the dates of any dataset: a call outside it is taken as a
 * placeholder (0001-01-01, 1970-01-01, 9999-12-31) that would otherwise stretch the date span.
 */
const PLAUSIBLE_CALL_YEARS = { first: 2000, last: 2100 } as const;

export interface References {
  campaignIds: ReadonlySet<string>;
  /** Campaigns whose campaigns.csv row is unusable, by id, with what is wrong. */
  invalidCampaigns: ReadonlyMap<string, string>;
  locations: ReadonlyMap<string, Location>;
}

export function buildReferences(
  campaigns: Campaign[],
  locations: Location[],
  invalidCampaigns: ReadonlyMap<string, string> = new Map(),
): References {
  return {
    campaignIds: new Set(campaigns.map((c) => c.id)),
    invalidCampaigns,
    locations: new Map(locations.map((l) => [l.id, l])),
  };
}

/**
 * Validate one raw calls row. Checks run in a fixed order and the first failure wins,
 * so the reason counts add up to the number of bad rows.
 */
export function validateCall(raw: Record<string, string>, rowNumber: number, refs: References): RowResult {
  const field = (name: string) => (raw[name] ?? '').trim();

  const callId = field('call_id');
  const updatedAt = parseTimestamp(field('updated_at'));
  const bad = (reason: BadReason, detail: string): RowResult => ({
    ok: false,
    bad: { rowNumber, callId, updatedAt, reason, detail },
  });

  if (callId === '') return bad('missing_call_id', 'call_id is empty');

  // The CSV reader leaves out the cells a short row lacks; such a row was cut off, not left blank.
  const missing = CALL_COLUMNS.find((name) => raw[name] === undefined);
  if (missing !== undefined) return bad('truncated_row', `the row ends early: it has no cell for ${missing} or any column after it`);

  const startedAt = parseTimestamp(field('started_at'));
  if (startedAt === null) return bad('bad_timestamp', `started_at "${field('started_at')}" is not an ISO 8601 UTC time`);
  const year = startedAt.getUTCFullYear();
  if (year < PLAUSIBLE_CALL_YEARS.first || year > PLAUSIBLE_CALL_YEARS.last) {
    return bad(
      'bad_timestamp',
      `started_at "${field('started_at')}" is outside the years ${PLAUSIBLE_CALL_YEARS.first} to ${PLAUSIBLE_CALL_YEARS.last}, so it is taken as a placeholder date`,
    );
  }

  const location = refs.locations.get(field('location_id'));
  if (location === undefined) return bad('unknown_location', `location_id "${field('location_id')}" is not in locations`);
  if (!location.timezoneValid) return bad('invalid_timezone', `location "${location.id}" has an invalid time zone`);

  const campaignId = field('campaign_id');
  if (campaignId !== '' && !refs.campaignIds.has(campaignId)) {
    const problem = refs.invalidCampaigns.get(campaignId);
    if (problem !== undefined) {
      return bad('invalid_campaign', `campaign_id "${campaignId}" has an unusable row in campaigns: ${problem}`);
    }
    return bad('unknown_campaign', `campaign_id "${campaignId}" is not in campaigns`);
  }

  const answered = parseBoolean(field('answered'));
  if (answered === null) return bad('bad_boolean', `answered "${field('answered')}" is not true or false`);

  // An empty outcome is allowed (pending); a non-empty one must be in the enum.
  const outcomeText = field('outcome');
  const outcome = parseEnum(outcomeText, OUTCOMES);
  if (outcomeText !== '' && outcome === null) return bad('bad_outcome', `outcome "${outcomeText}" is not a known outcome`);

  // A call can't have been answered with an outcome of missed/voicemail, nor unanswered with a real outcome.
  // An unanswered call may have an empty outcome.
  if (outcome !== null && answered === UNANSWERED_OUTCOMES.includes(outcome)) {
    return bad('inconsistent_outcome', `answered is ${answered} but outcome is "${outcome}"`);
  }

  const channel = parseEnum(field('marketing_channel'), CHANNELS);
  if (channel === null) return bad('bad_channel', `marketing_channel "${field('marketing_channel')}" is not a known channel`);

  const durationSeconds = parseInteger(field('duration_seconds'));
  if (durationSeconds === null || durationSeconds < 0) {
    return bad('bad_duration', `duration_seconds "${field('duration_seconds')}" is not a non-negative integer`);
  }

  // An empty revenue is allowed; anything else must be a non-negative amount.
  const revenueText = field('revenue_usd');
  const revenueUsd = revenueText === '' ? null : parseMoney(revenueText);
  if (revenueText !== '' && (revenueUsd === null || revenueUsd < 0)) {
    return bad('bad_revenue', `revenue_usd "${revenueText}" is not a non-negative amount`);
  }

  return {
    ok: true,
    call: {
      rowNumber,
      callId,
      startedAt,
      endedAt: parseTimestamp(field('ended_at')),
      durationSeconds,
      callerHash: field('caller_number_hash'),
      trackingNumber: field('tracking_number'),
      campaignId: campaignId === '' ? null : campaignId,
      channel,
      locationId: location.id,
      answered,
      outcome,
      revenueUsd,
      agentId: field('agent_id') === '' ? null : field('agent_id'),
      updatedAt,
    },
  };
}
