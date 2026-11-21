import type { Table } from './csv';
import { normalizeTimeZone, parseEnum, parseMoney } from './fields';
import { UNATTRIBUTED_NAME } from './text';
import { CHANNELS, type Campaign, type Location, type ReferenceIssue } from './types';

export const CAMPAIGN_COLUMNS = ['campaign_id', 'name', 'channel', 'daily_budget_usd'] as const;
export const LOCATION_COLUMNS = ['location_id', 'name', 'timezone'] as const;

export interface ParsedCampaigns {
  /** The usable rows. */
  campaigns: Campaign[];
  /**
   * Rows with a bad channel, by id, each with what is wrong. They are not campaigns, but their
   * calls are reported as invalid_campaign rather than unknown_campaign (as an office with a bad time zone is).
   */
  invalidCampaigns: Map<string, string>;
  /**
   * Rows skipped (empty or repeated id), kept aside (bad channel), or kept with no budget because the budget
   * could not be read (bad_budget).
   */
  issues: ReferenceIssue[];
  /**
   * Usable rows with something worth knowing: a blank budget, or a name that is empty, repeated or reads as the
   * Unattributed label. Kept apart from `issues` because the row itself is fine (an upload must not reject it).
   */
  notes: ReferenceIssue[];
}

/** Row numbers are 1-based data rows. */
export function parseCampaigns(table: Table): ParsedCampaigns {
  const campaigns: Campaign[] = [];
  const invalidCampaigns = new Map<string, string>();
  const issues: ReferenceIssue[] = [];
  const notes: ReferenceIssue[] = [];
  const seen = new Set<string>();
  const firstWithName = new Map<string, Campaign>(); // lower-case name -> first campaign with it

  table.rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const report = (list: ReferenceIssue[], reason: string, detail: string) =>
      list.push({ file: 'campaigns.csv', rowNumber, reason, detail });

    const id = (row.campaign_id ?? '').trim();
    if (id === '') return report(issues, 'empty_id', 'campaign_id is empty');
    if (seen.has(id)) return report(issues, 'duplicate_id', `campaign_id "${id}" already appeared; kept the first`);

    // Mark the id as seen even if the rest of the row is bad, so a later row with the same id is a duplicate.
    seen.add(id);

    // A budget that is blank or can't be read leaves the campaign in with an unknown budget (null): its calls
    // still count, only the cost estimates are blank. No attempt is made to read currency formats.
    const budgetText = (row.daily_budget_usd ?? '').trim();
    const parsedBudget = parseMoney(budgetText);
    const budget = parsedBudget !== null && parsedBudget >= 0 ? parsedBudget : null;
    if (budgetText === '') {
      report(notes, 'no_budget', `campaign "${id}": budget not given: cost estimates are blank for this campaign`);
    } else if (budget === null) {
      report(issues, 'bad_budget', `daily_budget_usd "${budgetText}" is not a plain non-negative number; campaign kept, its cost estimates are blank`);
    }
    const channel = parseEnum(row.channel ?? '', CHANNELS);
    if (channel === null) {
      const problem = `channel "${row.channel ?? ''}" is not a known marketing channel`;
      report(issues, 'bad_channel', problem);
      invalidCampaigns.set(id, problem);
      return;
    }

    const campaign: Campaign = { id, name: (row.name ?? '').trim(), channel, dailyBudgetUsd: budget };
    campaigns.push(campaign);

    const key = campaign.name.toLowerCase();
    const first = firstWithName.get(key);
    if (campaign.name === '') {
      report(notes, 'empty_name', `campaign "${id}" has an empty name`);
    } else if (key === UNATTRIBUTED_NAME.toLowerCase()) {
      report(notes, 'reserved_name', `campaign "${id}" is named "${campaign.name}", the label used for calls with no campaign`);
    } else if (first) {
      report(notes, 'duplicate_name', `campaign "${id}" has the same name as campaign "${first.id}" ("${first.name}")`);
    } else {
      firstWithName.set(key, campaign);
    }
  });

  return { campaigns, invalidCampaigns, issues, notes };
}

/**
 * Skips rows with an empty or repeated id. A location with an invalid time zone is kept
 * (timezoneValid false) so its calls are reported as invalid_timezone, not unknown_location.
 * `notes`, like the campaign notes, are about usable rows: a zone name read as a different zone.
 */
export function parseLocations(table: Table): { locations: Location[]; issues: ReferenceIssue[]; notes: ReferenceIssue[] } {
  const locations: Location[] = [];
  const issues: ReferenceIssue[] = [];
  const notes: ReferenceIssue[] = [];
  const seen = new Set<string>();

  table.rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const report = (list: ReferenceIssue[], reason: string, detail: string) =>
      list.push({ file: 'locations.csv', rowNumber, reason, detail });

    const id = (row.location_id ?? '').trim();
    if (id === '') return report(issues, 'empty_id', 'location_id is empty');
    if (seen.has(id)) return report(issues, 'duplicate_id', `location_id "${id}" already appeared; kept the first`);

    const written = (row.timezone ?? '').trim();
    const canonicalZone = normalizeTimeZone(written);
    const timezone = canonicalZone ?? written;
    const timezoneValid = canonicalZone !== null;
    if (!timezoneValid) {
      report(issues, 'invalid_timezone', `timezone "${timezone}" is not a valid IANA zone; calls here will be bad`);
    } else if (timezone.toLowerCase() !== written.toLowerCase()) {
      // An alias such as "EST" or "US/Pacific" is valid but stands for another zone; say which, so a wrong guess shows.
      report(notes, 'timezone_reinterpreted', `time zone "${written}" was read as ${timezone}`);
    }

    seen.add(id);
    locations.push({ id, name: (row.name ?? '').trim(), timezone, timezoneValid });
  });

  return { locations, issues, notes };
}
