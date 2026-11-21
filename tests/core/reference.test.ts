import { describe, expect, test } from 'vitest';
import { parseCampaigns, parseLocations } from '../../src/core/reference';
import type { Table } from '../../src/core/csv';

const table = (file: string, rows: Record<string, string>[]): Table => ({
  file,
  rows,
  header: [],
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

  test('a duplicate id is still a duplicate when the first copy had an unreadable budget', () => {
    const { campaigns, issues } = parseCampaigns(
      table('campaigns.csv', [campaign('c1', 'abc'), campaign('c1', '50')]),
    );
    expect(campaigns.map((c) => c.dailyBudgetUsd)).toEqual([null]);
    expect(issues.map((i) => i.reason)).toEqual(['bad_budget', 'duplicate_id']);
  });

  test('empty campaign id is skipped and reported', () => {
    const { campaigns, issues } = parseCampaigns(table('campaigns.csv', [campaign('', '10')]));
    expect(campaigns).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rowNumber: 1, reason: 'empty_id' });
  });

  test('a blank budget keeps the campaign with no budget, and is a note, not an issue', () => {
    const { campaigns, invalidCampaigns, issues, notes } = parseCampaigns(table('campaigns.csv', [campaign('c1', '  ', 'Alpha')]));
    expect(campaigns).toEqual([{ id: 'c1', name: 'Alpha', channel: 'social', dailyBudgetUsd: null }]);
    expect(invalidCampaigns.size).toBe(0);
    expect(issues).toEqual([]);
    expect(notes).toEqual([
      {
        file: 'campaigns.csv',
        rowNumber: 1,
        reason: 'no_budget',
        detail: 'campaign "c1": budget not given: cost estimates are blank for this campaign',
      },
    ]);
  });

  test.each(['abc', '-5', '$150.00', '1,500.00'])('an unreadable budget %j keeps the campaign with no budget and is reported', (budget) => {
    const { campaigns, invalidCampaigns, issues } = parseCampaigns(table('campaigns.csv', [campaign('c1', budget)]));
    expect(campaigns.map((c) => [c.id, c.dailyBudgetUsd])).toEqual([['c1', null]]);
    expect(invalidCampaigns.size).toBe(0);
    expect(issues).toEqual([
      {
        file: 'campaigns.csv',
        rowNumber: 1,
        reason: 'bad_budget',
        detail: `daily_budget_usd "${budget}" is not a plain non-negative number; campaign kept, its cost estimates are blank`,
      },
    ]);
  });

  test.each(['Paid Search', '', 'tv'])('channel %j is skipped and reported', (channel) => {
    const { campaigns, issues } = parseCampaigns(
      table('campaigns.csv', [{ ...campaign('c1', '10'), channel }]),
    );
    expect(campaigns).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: 'campaigns.csv', rowNumber: 1, reason: 'bad_channel' });
  });

  test('a campaign row with a bad channel is kept aside, naming what is wrong; a bad budget alone is not', () => {
    const { campaigns, invalidCampaigns, issues } = parseCampaigns(
      table('campaigns.csv', [
        campaign('c1', 'abc'),
        { ...campaign('c2', '10'), channel: 'tv' },
        { ...campaign('c3', 'abc'), channel: '' },
        campaign('c4', '10'),
      ]),
    );
    expect(campaigns.map((c) => c.id)).toEqual(['c1', 'c4']);
    expect([...invalidCampaigns.keys()]).toEqual(['c2', 'c3']);
    expect(invalidCampaigns.get('c2')).toBe('channel "tv" is not a known marketing channel');
    expect(invalidCampaigns.get('c3')).toBe('channel "" is not a known marketing channel');
    expect(issues.map((i) => [i.rowNumber, i.reason])).toEqual([
      [1, 'bad_budget'],
      [2, 'bad_channel'],
      [3, 'bad_budget'],
      [3, 'bad_channel'],
    ]);
  });

  test('ids are trimmed', () => {
    const { campaigns } = parseCampaigns(table('campaigns.csv', [campaign(' c1 ', '10')]));
    expect(campaigns[0]?.id).toBe('c1');
  });
});

describe('campaign names that make the AI fact sheet ambiguous', () => {
  const nameIssues = (rows: Record<string, string>[]) => parseCampaigns(table('campaigns.csv', rows)).notes;

  test('distinct, non-empty names give no issue', () => {
    expect(nameIssues([campaign('c1', '10', 'Alpha'), campaign('c2', '10', 'Beta')])).toEqual([]);
  });

  test('an empty name is reported', () => {
    expect(nameIssues([campaign('c1', '10', '  ')])).toEqual([
      { file: 'campaigns.csv', rowNumber: 1, reason: 'empty_name', detail: 'campaign "c1" has an empty name' },
    ]);
  });

  test('a repeated name is reported on each later row, ignoring case and spaces', () => {
    const issues = nameIssues([campaign('c1', '10', 'Alpha'), campaign('c2', '10', 'Beta'), campaign('c3', '10', ' alpha ')]);
    expect(issues).toEqual([
      {
        file: 'campaigns.csv',
        rowNumber: 3,
        reason: 'duplicate_name',
        detail: 'campaign "c3" has the same name as campaign "c1" ("Alpha")',
      },
    ]);
  });

  test('a campaign named like the Unattributed label is reported', () => {
    expect(nameIssues([campaign('c1', '10', 'unattributed')])).toEqual([
      {
        file: 'campaigns.csv',
        rowNumber: 1,
        reason: 'reserved_name',
        detail: 'campaign "c1" is named "unattributed", the label used for calls with no campaign',
      },
    ]);
  });

  test('rows already skipped or kept aside are not checked for names', () => {
    expect(nameIssues([campaign('c1', '10', 'Alpha'), campaign('c1', '10', 'Alpha'), { ...campaign('c2', '10', 'Alpha'), channel: 'tv' }])).toEqual([]);
  });

  test('name issues are not mixed into the row issues (an upload treats those as bad rows)', () => {
    expect(parseCampaigns(table('campaigns.csv', [campaign('c1', '10', '')])).issues).toEqual([]);
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

  test('a zone that differs only in letter case gives no note', () => {
    const { notes } = parseLocations(table('locations.csv', [location('l1', 'america/phoenix'), location('l2', 'America/Denver')]));
    expect(notes).toEqual([]);
  });

  test.each([
    ['EST', 'America/Panama'],
    ['US/Pacific', 'America/Los_Angeles'],
  ])('a zone %j read as %j stays valid and gets a note, not an issue', (tz, canonical) => {
    const { locations, issues, notes } = parseLocations(table('locations.csv', [location('l1', tz)]));
    expect(locations[0]).toMatchObject({ timezone: canonical, timezoneValid: true });
    expect(issues).toEqual([]);
    expect(notes).toEqual([
      { file: 'locations.csv', rowNumber: 1, reason: 'timezone_reinterpreted', detail: `time zone "${tz}" was read as ${canonical}` },
    ]);
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
