import type { CleanCall } from '../types';
import type { ViewName } from '../views/facts';

/** A fixed filter over calls. Every list is "any of"; an empty list means no restriction; lists combine with AND. */
export interface AnswerFilter {
  /** Picks the grouping of the answer. */
  view: ViewName;
  /** [] = every office. */
  officeIds: string[];
  /** [] with includeUnattributed false = every campaign and unattributed. */
  campaignIds: string[];
  /** true adds calls with campaignId null to the campaign filter. */
  includeUnattributed: boolean;
  /** 0 = Monday ... 6 = Sunday, in the office's time zone. [] = every day. */
  weekdays: number[];
  /** 0-23, in the office's time zone. [] = every hour. */
  hours: number[];
}

function matchesCampaign(call: CleanCall, filter: AnswerFilter): boolean {
  if (filter.campaignIds.length === 0 && !filter.includeUnattributed) return true;
  if (call.campaignId === null) return filter.includeUnattributed;
  return filter.campaignIds.includes(call.campaignId);
}

export function applyFilter(calls: CleanCall[], filter: AnswerFilter): CleanCall[] {
  return calls.filter(
    (call) =>
      (filter.officeIds.length === 0 || filter.officeIds.includes(call.locationId)) &&
      matchesCampaign(call, filter) &&
      (filter.weekdays.length === 0 || filter.weekdays.includes(call.localWeekday)) &&
      (filter.hours.length === 0 || filter.hours.includes(call.localHour)),
  );
}
