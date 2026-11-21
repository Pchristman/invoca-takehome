import { readTable, type Table } from './csv';
import { CAMPAIGN_COLUMNS, LOCATION_COLUMNS, parseCampaigns, parseLocations } from './reference';
import { BAD_REASONS, type BadReason, type LoadedExport } from './types';
import { buildReferences, CALL_COLUMNS, validateCall } from './validate';

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

  const { campaigns, invalidCampaigns, issues: campaignIssues, notes: campaignNotes } = parseCampaigns(campaignTable);
  const { locations, issues: locationIssues, notes: locationNotes } = parseLocations(locationTable);
  const refs = buildReferences(campaigns, locations, invalidCampaigns);

  const rows = callTable.rows.map((raw, index) => validateCall(raw, index + 1, refs));

  const badByReason = Object.fromEntries(BAD_REASONS.map((reason) => [reason, 0])) as Record<BadReason, number>;
  let unparseableUpdatedAt = 0;
  let unparseableEndedAt = 0;
  for (const row of rows) {
    if (row.ok) {
      if (row.call.updatedAt === null) unparseableUpdatedAt += 1;
      if (row.call.endedAt === null) unparseableEndedAt += 1;
    } else {
      badByReason[row.bad.reason] += 1;
      if (row.bad.updatedAt === null) unparseableUpdatedAt += 1;
    }
  }

  return {
    campaigns,
    locations,
    rows,
    rowsRead: rows.length,
    badByReason,
    unparseableUpdatedAt,
    unparseableEndedAt,
    // Each file's issues and notes in row order (a row can have both kinds), campaigns first.
    referenceIssues: [
      ...[...campaignIssues, ...campaignNotes].sort((a, b) => a.rowNumber - b.rowNumber),
      ...[...locationIssues, ...locationNotes].sort((a, b) => a.rowNumber - b.rowNumber),
    ],
    notes,
  };
}
