import type { Table } from './csv';
import { normalizeTimeZone, parseEnum, parseMoney } from './fields';
import { CHANNELS, type Campaign, type Location, type ReferenceIssue } from './types';

export const CAMPAIGN_COLUMNS = ['campaign_id', 'name', 'channel', 'daily_budget_usd'] as const;
export const LOCATION_COLUMNS = ['location_id', 'name', 'timezone'] as const;

/** Skips (and reports) rows with an empty or repeated id, a bad budget or an unknown channel. Row numbers are 1-based data rows. */
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

    // Mark the id as seen even if the rest of the row is bad, so a later row with the same id is a duplicate.
    seen.add(id);

    const budget = parseMoney(row.daily_budget_usd ?? '');
    if (budget === null || budget < 0) {
      return skip('bad_budget', `daily_budget_usd "${row.daily_budget_usd}" is not a non-negative number`);
    }

    const channel = parseEnum(row.channel ?? '', CHANNELS);
    if (channel === null) return skip('bad_channel', `channel "${row.channel}" is not a known marketing channel`);

    campaigns.push({ id, name: (row.name ?? '').trim(), channel, dailyBudgetUsd: budget });
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

    const canonicalZone = normalizeTimeZone(row.timezone ?? '');
    const timezone = canonicalZone ?? (row.timezone ?? '').trim();
    const timezoneValid = canonicalZone !== null;
    if (!timezoneValid) {
      report('invalid_timezone', `timezone "${timezone}" is not a valid IANA zone; calls here will be bad`);
    }

    seen.add(id);
    locations.push({ id, name: (row.name ?? '').trim(), timezone, timezoneValid });
  });

  return { locations, issues };
}
