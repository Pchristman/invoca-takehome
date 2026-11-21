import { describe, expect, it } from 'vitest';
import { createAiFromEnv, knownNamesFrom, parseSpendLimit, snapshotId } from '../../src/ai/fromEnv';
import { CHANNELS, type CallStore, type CleanCall } from '../../src/core/types';
import { ConfigError } from '../../src/server/config';
import { FakeModel } from './fakeModel';

function call(id: string, over: Partial<CleanCall> = {}): CleanCall {
  return {
    callId: id, startedAt: new Date('2025-01-01T10:00:00Z'), durationSeconds: 60, callerHash: 'h', trackingNumber: 't',
    campaignId: 'c1', unattributed: false, channel: 'paid_search', locationId: 'l1', answered: true,
    outcome: 'booked', booked: true, pending: false, revenueUsd: 100, agentId: null,
    localDate: '2025-01-01', localHour: 5, localWeekday: 2, ...over,
  };
}

function store(calls: CleanCall[] = [call('a'), call('b')]): CallStore {
  return {
    calls,
    campaigns: [{ id: 'c1', name: 'Alpha Camp', channel: 'paid_search', dailyBudgetUsd: 10 }],
    locations: [{ id: 'l1', name: 'North Office', timezone: 'America/Chicago', timezoneValid: true }],
    dataNotes: {} as CallStore['dataNotes'],
  };
}

describe('parseSpendLimit', () => {
  it('defaults to 5 when unset or blank', () => {
    expect(parseSpendLimit(undefined)).toBe(5);
    expect(parseSpendLimit('')).toBe(5);
    expect(parseSpendLimit('  ')).toBe(5);
  });
  it('accepts zero and decimals', () => {
    expect(parseSpendLimit('0')).toBe(0);
    expect(parseSpendLimit('2.5')).toBe(2.5);
  });
  it.each(['abc', '-1', 'NaN', 'Infinity'])('rejects %s, naming the variable', (bad) => {
    expect(() => parseSpendLimit(bad)).toThrow(ConfigError);
    expect(() => parseSpendLimit(bad)).toThrow(/AI_SPEND_LIMIT_USD/);
  });
});

describe('snapshotId', () => {
  it('is stable for the same store', () => {
    expect(snapshotId(store())).toBe(snapshotId(store()));
    expect(snapshotId(store())).toMatch(/^[0-9a-f]{64}$/);
  });
  it('changes when outcome, revenue, localized date changes or a call is added', () => {
    const base = snapshotId(store());
    expect(snapshotId(store([call('a', { outcome: 'missed' }), call('b')]))).not.toBe(base);
    expect(snapshotId(store([call('a', { revenueUsd: 101 }), call('b')]))).not.toBe(base);
    expect(snapshotId(store([call('a', { localDate: '2025-01-02' }), call('b')]))).not.toBe(base);
    expect(snapshotId(store([call('a'), call('b'), call('c')]))).not.toBe(base);
  });
  it('changes when only the campaigns or locations change (a reference-only upload), since the question prompt lists their names', () => {
    const base = snapshotId(store());
    const withCampaigns = (campaigns: CallStore['campaigns']) => snapshotId({ ...store(), campaigns });
    const withLocations = (locations: CallStore['locations']) => snapshotId({ ...store(), locations });
    const camp = store().campaigns[0]!;
    const loc = store().locations[0]!;
    expect(withCampaigns([{ ...camp, name: 'Alpha Renamed' }])).not.toBe(base);
    expect(withCampaigns([camp, { ...camp, id: 'c2', name: 'Beta Camp' }])).not.toBe(base);
    expect(withCampaigns([{ ...camp, dailyBudgetUsd: 20 }])).not.toBe(base);
    expect(withLocations([{ ...loc, name: 'South Office' }])).not.toBe(base);
    expect(withLocations([{ ...loc, timezone: 'America/New_York' }])).not.toBe(base);
    expect(withCampaigns([{ ...camp }])).toBe(base);
  });
  it('does not confuse a null outcome with the text "null"-free neighbours', () => {
    expect(snapshotId(store([call('a', { outcome: null })]))).not.toBe(snapshotId(store([call('a', { outcome: 'missed' })])));
  });
});

describe('knownNamesFrom', () => {
  it('lists campaigns, offices and the channels', () => {
    expect(knownNamesFrom(store())).toEqual({ campaigns: ['Alpha Camp'], offices: ['North Office'], channels: CHANNELS });
  });
});

describe('createAiFromEnv', () => {
  const paths = { cachePath: null, logPath: null };
  it.each([[undefined], [''], ['   ']])('is off with key %j', async (key) => {
    const env = key === undefined ? {} : { ANTHROPIC_API_KEY: key };
    const service = createAiFromEnv(store(), env, { ...paths, model: new FakeModel() });
    expect(service.status().status).toBe('off');
    const result = await service.takeaway({ view: 'overview', facts: { 'a.b': 1 } } as never, 'template text');
    expect(result).toEqual({ text: 'template text', source: 'template', reason: 'ai_off' });
  });
  it('is on with a key and an injected model', () => {
    const service = createAiFromEnv(store(), { ANTHROPIC_API_KEY: 'k' }, { ...paths, model: new FakeModel() });
    expect(service.status().status).toBe('on');
  });
  it('rejects a bad spend limit when a key is set', () => {
    expect(() => createAiFromEnv(store(), { ANTHROPIC_API_KEY: 'k', AI_SPEND_LIMIT_USD: 'x' }, { ...paths, model: new FakeModel() }))
      .toThrow(ConfigError);
  });
});

describe('createAiFromEnv with a padded key', () => {
  it('builds an on service from a key with stray spaces, without a network call', () => {
    const service = createAiFromEnv(store(), { ANTHROPIC_API_KEY: '  sk-ant-test-key  ' }, { cachePath: null, logPath: null });
    expect(service.status().status).toBe('on');
  });
});
