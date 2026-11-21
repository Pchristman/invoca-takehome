import { describe, expect, test } from 'vitest';
import { buildReferences, CALL_COLUMNS, validateCall } from '../../src/core/validate';
import type { BadReason, Campaign, Location } from '../../src/core/types';

const campaigns: Campaign[] = [
  { id: 'cmp_a', name: 'Alpha', channel: 'social', dailyBudgetUsd: 10 },
  { id: 'cmp_b', name: 'Beta', channel: 'direct', dailyBudgetUsd: 0 },
];
const locations: Location[] = [
  { id: 'loc_phx', name: 'Phoenix', timezone: 'America/Phoenix', timezoneValid: true },
  { id: 'loc_den', name: 'Denver', timezone: 'America/Denver', timezoneValid: true },
  { id: 'loc_bad', name: 'Nowhere', timezone: 'Mars/Olympus', timezoneValid: false },
];
const refs = buildReferences(campaigns, locations, new Map([['cmp_bad', 'channel "tv" is not a known marketing channel']]));

const goodRow = (over: Record<string, string> = {}): Record<string, string> => ({
  call_id: 'call_1',
  started_at: '2026-03-02T10:00:00Z',
  ended_at: '2026-03-02T10:01:37Z',
  duration_seconds: '97',
  caller_number_hash: 'h_1',
  tracking_number: '+1-555-0100',
  campaign_id: 'cmp_a',
  marketing_channel: 'social',
  location_id: 'loc_phx',
  answered: 'true',
  outcome: 'booked',
  revenue_usd: '250.00',
  agent_id: 'agt_1',
  updated_at: '2026-03-03T08:00:00Z',
  ...over,
});

describe('CALL_COLUMNS', () => {
  test('lists the 14 columns of the contract', () => {
    expect(CALL_COLUMNS).toHaveLength(14);
    expect(CALL_COLUMNS).toContain('updated_at');
  });
});

describe('validateCall: bad rows', () => {
  const cases: [string, Record<string, string>, BadReason][] = [
    ['empty call_id', { call_id: '' }, 'missing_call_id'],
    ['garbage started_at', { started_at: 'garbage' }, 'bad_timestamp'],
    ['empty started_at', { started_at: '' }, 'bad_timestamp'],
    ['impossible started_at', { started_at: '2026-02-30T10:00:00Z' }, 'bad_timestamp'],
    ['unknown location', { location_id: 'loc_zzz' }, 'unknown_location'],
    ['invalid IANA zone location', { location_id: 'loc_bad' }, 'invalid_timezone'],
    ['unknown non-empty campaign', { campaign_id: 'cmp_zzz' }, 'unknown_campaign'],
    ['campaign whose campaigns.csv row is unusable', { campaign_id: 'cmp_bad' }, 'invalid_campaign'],
    ['bad answered', { answered: 'maybe' }, 'bad_boolean'],
    ['empty answered', { answered: '' }, 'bad_boolean'],
    ['bad outcome enum', { outcome: 'won' }, 'bad_outcome'],
    ['unanswered but booked', { answered: 'false' }, 'inconsistent_outcome'],
    ['unanswered but qualified_lead', { answered: 'false', outcome: 'qualified_lead' }, 'inconsistent_outcome'],
    ['unanswered but not_qualified', { answered: 'false', outcome: 'not_qualified' }, 'inconsistent_outcome'],
    ['answered but missed', { outcome: 'missed' }, 'inconsistent_outcome'],
    ['answered but voicemail', { outcome: 'voicemail' }, 'inconsistent_outcome'],
    ['bad marketing_channel', { marketing_channel: 'tv' }, 'bad_channel'],
    ['empty marketing_channel', { marketing_channel: '' }, 'bad_channel'],
    ['negative duration', { duration_seconds: '-3' }, 'bad_duration'],
    ['empty duration', { duration_seconds: '' }, 'bad_duration'],
    ['fractional duration', { duration_seconds: '1.5' }, 'bad_duration'],
    ['non-numeric revenue', { revenue_usd: 'abc' }, 'bad_revenue'],
    ['negative revenue', { revenue_usd: '-10' }, 'bad_revenue'],
  ];

  test.each(cases)('%s', (_name, over, reason) => {
    const result = validateCall(goodRow(over), 7, refs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.bad.reason).toBe(reason);
    expect(result.bad.rowNumber).toBe(7);
    expect(result.bad.callId).toBe(over.call_id ?? 'call_1');
    expect(result.bad.updatedAt).toEqual(new Date('2026-03-03T08:00:00Z'));
  });

  test('an unknown non-empty campaign is bad, not unattributed', () => {
    const result = validateCall(goodRow({ campaign_id: 'cmp_zzz' }), 1, refs);
    expect(result.ok).toBe(false);
  });

  test('multiple problems report the first failing check in order', () => {
    const result = validateCall(goodRow({ started_at: 'garbage', location_id: 'loc_zzz' }), 1, refs);
    expect(result.ok === false && result.bad.reason).toBe('bad_timestamp');
  });

  test('a bad outcome is reported before an answered/outcome mismatch', () => {
    const result = validateCall(goodRow({ answered: 'false', outcome: 'won' }), 1, refs);
    expect(result.ok === false && result.bad.reason).toBe('bad_outcome');
  });

  test.each(['0001-01-01T00:00:00Z', '1970-01-01T00:00:00Z', '1999-12-31T23:59:59Z', '2101-01-01T00:00:00Z', '9999-12-31T23:59:59Z'])(
    'a started_at of %s is outside the plausible years, so the row is a bad timestamp',
    (startedAt) => {
      const result = validateCall(goodRow({ started_at: startedAt }), 1, refs);
      expect(result.ok === false && result.bad.reason).toBe('bad_timestamp');
      expect(result.ok === false && result.bad.detail).toBe(`started_at "${startedAt}" is outside the years 2000 to 2100, so it is taken as a placeholder date`);
    },
  );

  test.each(['2000-01-01T00:00:00Z', '2100-12-31T23:59:59Z'])('a started_at of %s is inside the plausible years', (startedAt) => {
    expect(validateCall(goodRow({ started_at: startedAt }), 1, refs).ok).toBe(true);
  });

  test('a row with no cell for a column (the line was cut off) is truncated_row, naming the first missing column', () => {
    const { revenue_usd: _r, agent_id: _a, updated_at: _u, ...cut } = goodRow();
    const result = validateCall(cut, 4, refs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.bad).toEqual({
      rowNumber: 4,
      callId: 'call_1',
      updatedAt: null,
      reason: 'truncated_row',
      detail: 'the row ends early: it has no cell for revenue_usd or any column after it',
    });
  });

  test('a row cut off before call_id is still missing_call_id', () => {
    const result = validateCall({}, 1, refs);
    expect(result.ok === false && result.bad.reason).toBe('missing_call_id');
  });

  test('a bad row with an unparseable updated_at carries null', () => {
    const result = validateCall(goodRow({ location_id: 'loc_zzz', updated_at: 'nope' }), 1, refs);
    expect(result.ok === false && result.bad.updatedAt).toBeNull();
  });
});

describe('validateCall: good rows', () => {
  const call = (over: Record<string, string> = {}) => {
    const result = validateCall(goodRow(over), 3, refs);
    if (!result.ok) throw new Error(`expected ok, got ${result.bad.reason}`);
    return result.call;
  };

  test('a full row becomes a typed Call', () => {
    expect(call()).toEqual({
      rowNumber: 3,
      callId: 'call_1',
      startedAt: new Date('2026-03-02T10:00:00Z'),
      endedAt: new Date('2026-03-02T10:01:37Z'),
      durationSeconds: 97,
      callerHash: 'h_1',
      trackingNumber: '+1-555-0100',
      campaignId: 'cmp_a',
      channel: 'social',
      locationId: 'loc_phx',
      answered: true,
      outcome: 'booked',
      revenueUsd: 250,
      agentId: 'agt_1',
      updatedAt: new Date('2026-03-03T08:00:00Z'),
    });
  });

  test('empty campaign_id gives campaignId null', () => {
    expect(call({ campaign_id: '' }).campaignId).toBeNull();
  });

  test('empty outcome gives null (a pending answered call)', () => {
    expect(call({ outcome: '' }).outcome).toBeNull();
  });

  test('empty revenue gives null', () => {
    expect(call({ revenue_usd: '' }).revenueUsd).toBeNull();
  });

  test('unanswered call with empty agent_id', () => {
    const c = call({ answered: 'false', outcome: 'missed', revenue_usd: '', agent_id: '' });
    expect(c.agentId).toBeNull();
    expect(c.answered).toBe(false);
  });

  test.each(['', 'missed', 'voicemail'])('an unanswered call with outcome %j is consistent', (outcome) => {
    const c = call({ answered: 'false', outcome, revenue_usd: '', agent_id: '' });
    expect(c.answered).toBe(false);
    expect(c.outcome).toBe(outcome === '' ? null : outcome);
  });

  test('padded values are trimmed', () => {
    const c = call({ answered: ' TRUE ', campaign_id: ' cmp_a ', location_id: ' loc_den ' });
    expect(c.answered).toBe(true);
    expect(c.campaignId).toBe('cmp_a');
    expect(c.locationId).toBe('loc_den');
  });

  test('unparseable updated_at gives null and the row stays ok', () => {
    expect(call({ updated_at: 'nope' }).updatedAt).toBeNull();
  });

  test('unparseable ended_at gives null and the row stays ok', () => {
    expect(call({ ended_at: '' }).endedAt).toBeNull();
  });

  test('revenue on a non-booked row is kept as parsed (ignoring it is Phase 2)', () => {
    const c = call({ outcome: 'not_qualified', revenue_usd: '99' });
    expect(c.revenueUsd).toBe(99);
  });

  test('extra keys in the raw record are ignored', () => {
    expect(call({ surprise: 'x' }).callId).toBe('call_1');
  });
});
