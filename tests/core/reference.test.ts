import { describe, expect, test } from 'vitest';
import { parseCampaigns, parseLocations } from '../../src/core/reference';
import type { Table } from '../../src/core/csv';

const table = (file: string, rows: Record<string, string>[]): Table => ({
  file,
  rows,
  isEmpty: rows.length === 0,
});

const campaign = (id: string, budget: string, name = 'Name') => ({
  campaign_id: id,
  name,
  channel: 'social',
  daily_budget_usd: budget,
});

const location = (id: string, timezone: string) => ({ location_id: id, name: 'Office', timezone });

describe('parseCampaigns', () => {
  test('valid campaigns parse with a numeric budget', () => {
    const { campaigns, issues } = parseCampaigns(table('campaigns.csv', [campaign('c1', '150.00', 'Alpha')]));
    expect(campaigns).toEqual([{ id: 'c1', name: 'Alpha', channel: 'social', dailyBudgetUsd: 150 }]);
    expect(issues).toEqual([]);
  });

  test('zero budget is valid', () => {
    const { campaigns, issues } = parseCampaigns(table('campaigns.csv', [campaign('c1', '0')]));
    expect(campaigns[0]?.dailyBudgetUsd).toBe(0);
    expect(issues).toEqual([]);
  });

  test('duplicate campaign id keeps the first and reports the second', () => {
    const { campaigns, issues } = parseCampaigns(
      table('campaigns.csv', [campaign('c1', '10', 'First'), campaign('c1', '20', 'Second')]),
    );
    expect(campaigns.map((c) => c.name)).toEqual(['First']);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: 'campaigns.csv', rowNumber: 2, reason: 'duplicate_id' });
  });

  test('a duplicate id is still a duplicate when the first copy had a bad budget', () => {
    const { campaigns, issues } = parseCampaigns(
      table('campaigns.csv', [campaign('c1', 'abc'), campaign('c1', '50')]),
    );
    expect(campaigns).toEqual([]);
    expect(issues.map((i) => i.reason)).toEqual(['bad_budget', 'duplicate_id']);
  });

  test('empty campaign id is skipped and reported', () => {
    const { campaigns, issues } = parseCampaigns(table('campaigns.csv', [campaign('', '10')]));
    expect(campaigns).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rowNumber: 1, reason: 'empty_id' });
  });

  test.each(['abc', '-5', ''])('budget %j is skipped and reported', (budget) => {
    const { campaigns, issues } = parseCampaigns(table('campaigns.csv', [campaign('c1', budget)]));
    expect(campaigns).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toBe('bad_budget');
  });

  test.each(['Paid Search', '', 'tv'])('channel %j is skipped and reported', (channel) => {
    const { campaigns, issues } = parseCampaigns(
      table('campaigns.csv', [{ ...campaign('c1', '10'), channel }]),
    );
    expect(campaigns).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: 'campaigns.csv', rowNumber: 1, reason: 'bad_channel' });
  });

  test('ids are trimmed', () => {
    const { campaigns } = parseCampaigns(table('campaigns.csv', [campaign(' c1 ', '10')]));
    expect(campaigns[0]?.id).toBe('c1');
  });
});

describe('parseLocations', () => {
  test('valid locations parse with timezoneValid true', () => {
    const { locations, issues } = parseLocations(table('locations.csv', [location('l1', 'America/Phoenix')]));
    expect(locations).toEqual([{ id: 'l1', name: 'Office', timezone: 'America/Phoenix', timezoneValid: true }]);
    expect(issues).toEqual([]);
  });

  test.each(['Mars/Olympus', '', '+05:00', '-0700'])(
    'timezone %j is kept with timezoneValid false and one issue',
    (tz) => {
      const { locations, issues } = parseLocations(table('locations.csv', [location('l1', tz)]));
      expect(locations).toHaveLength(1);
      expect(locations[0]?.timezoneValid).toBe(false);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ file: 'locations.csv', rowNumber: 1, reason: 'invalid_timezone' });
    },
  );

  test('a valid zone is stored with its canonical spelling', () => {
    const { locations } = parseLocations(table('locations.csv', [location('l1', 'america/phoenix')]));
    expect(locations[0]).toMatchObject({ timezone: 'America/Phoenix', timezoneValid: true });
  });

  test('duplicate and empty location ids are skipped and reported', () => {
    const { locations, issues } = parseLocations(
      table('locations.csv', [location('l1', 'UTC'), location('l1', 'UTC'), location('', 'UTC')]),
    );
    expect(locations.map((l) => l.id)).toEqual(['l1']);
    expect(issues.map((i) => i.rowNumber)).toEqual([2, 3]);
    expect(issues.map((i) => i.reason)).toEqual(['duplicate_id', 'empty_id']);
  });

  test('ids are trimmed', () => {
    const { locations } = parseLocations(table('locations.csv', [location(' l1 ', 'UTC')]));
    expect(locations[0]?.id).toBe('l1');
  });
});
