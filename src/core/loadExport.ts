import { readTable, type Table } from './csv';
import { CAMPAIGN_COLUMNS, LOCATION_COLUMNS, parseCampaigns, parseLocations } from './reference';
import type { BadReason, LoadedExport } from './types';
import { buildReferences, CALL_COLUMNS, validateCall } from './validate';

const ALL_REASONS: readonly BadReason[] = [
  'missing_call_id',
  'bad_timestamp',
  'unknown_location',
  'invalid_timezone',
  'unknown_campaign',
  'bad_boolean',
  'bad_outcome',
  'bad_channel',
  'bad_duration',
  'bad_revenue',
];

/**
 * Turn the text of the three CSVs into typed records and a bad-row report.
 * Every raw calls row is returned (typed or bad, in file order); duplicates are NOT collapsed here.
 */
export function loadExport(texts: { calls: string; campaigns: string; locations: string }): LoadedExport {
  const notes: string[] = [];
  const noteIfEmpty = (table: Table, what: string) => {
    if (table.isEmpty) notes.push(`${table.file} is empty: starting with zero ${what}`);
  };

  const campaignTable = readTable(texts.campaigns, 'campaigns.csv', CAMPAIGN_COLUMNS);
  const locationTable = readTable(texts.locations, 'locations.csv', LOCATION_COLUMNS);
  const callTable = readTable(texts.calls, 'calls.csv', CALL_COLUMNS);
  noteIfEmpty(callTable, 'calls');
  noteIfEmpty(campaignTable, 'campaigns');
  noteIfEmpty(locationTable, 'locations');

  const { campaigns, issues: campaignIssues } = parseCampaigns(campaignTable);
  const { locations, issues: locationIssues } = parseLocations(locationTable);
  const refs = buildReferences(campaigns, locations);

  const rows = callTable.rows.map((raw, index) => validateCall(raw, index + 1, refs));

  const badByReason = Object.fromEntries(ALL_REASONS.map((reason) => [reason, 0])) as Record<BadReason, number>;
  for (const row of rows) {
    if (!row.ok) badByReason[row.bad.reason] += 1;
  }

  return {
    campaigns,
    locations,
    rows,
    rowsRead: rows.length,
    badByReason,
    referenceIssues: [...campaignIssues, ...locationIssues],
    notes,
  };
}
