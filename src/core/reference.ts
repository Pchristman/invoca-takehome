import type { Table } from './csv';
import { isValidTimeZone, parseMoney } from './fields';
import type { Campaign, Location, ReferenceIssue } from './types';

export const CAMPAIGN_COLUMNS = ['campaign_id', 'name', 'channel', 'daily_budget_usd'] as const;
export const LOCATION_COLUMNS = ['location_id', 'name', 'timezone'] as const;

/** Skips (and reports) rows with an empty or repeated id or a bad budget. Row numbers are 1-based data rows. */
export function parseCampaigns(table: Table): { campaigns: Campaign[]; issues: ReferenceIssue[] } {
  const campaigns: Campaign[] = [];
  const issues: ReferenceIssue[] = [];
  const seen = new Set<string>();

  table.rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const skip = (reason: string, detail: string) =>
      issues.push({ file: 'campaigns.csv', rowNumber, reason, detail });

    const id = (row.campaign_id ?? '').trim();
    if (id === '') return skip('empty_id', 'campaign_id is empty');
    if (seen.has(id)) return skip('duplicate_id', `campaign_id "${id}" already appeared; kept the first`);

    const budget = parseMoney(row.daily_budget_usd ?? '');
    if (budget === null || budget < 0) {
      return skip('bad_budget', `daily_budget_usd "${row.daily_budget_usd}" is not a non-negative number`);
    }

    seen.add(id);
    campaigns.push({
      id,
      name: (row.name ?? '').trim(),
      channel: (row.channel ?? '').trim(),
      dailyBudgetUsd: budget,
    });
  });

  return { campaigns, issues };
}

/**
 * Skips rows with an empty or repeated id. A location with an invalid time zone is kept
 * (timezoneValid false) so its calls are reported as invalid_timezone, not unknown_location.
 */
export function parseLocations(table: Table): { locations: Location[]; issues: ReferenceIssue[] } {
  const locations: Location[] = [];
  const issues: ReferenceIssue[] = [];
  const seen = new Set<string>();

  table.rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const report = (reason: string, detail: string) =>
      issues.push({ file: 'locations.csv', rowNumber, reason, detail });

    const id = (row.location_id ?? '').trim();
    if (id === '') return report('empty_id', 'location_id is empty');
    if (seen.has(id)) return report('duplicate_id', `location_id "${id}" already appeared; kept the first`);

    const timezone = (row.timezone ?? '').trim();
    const timezoneValid = isValidTimeZone(timezone);
    if (!timezoneValid) {
      report('invalid_timezone', `timezone "${timezone}" is not a valid IANA zone; calls here will be bad`);
    }

    seen.add(id);
    locations.push({ id, name: (row.name ?? '').trim(), timezone, timezoneValid });
  });

  return { locations, issues };
}
