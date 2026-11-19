import { addDays, weekStart } from './localDate';
import type { LocalDate } from './localDate';
import type { DateRange } from './ranges';
import type { CleanCall } from './types';

export interface WeekBucket {
  /** The Monday. */
  weekStart: LocalDate;
  /** The Sunday. */
  weekEnd: LocalDate;
  calls: number;
  /** True unless Monday to Sunday lies wholly inside both the range and the data. */
  partial: boolean;
}

/**
 * Calls per Monday-to-Sunday week by local date, for the weeks the range touches. Pass the calls to chart
 * (the caller limits them to one campaign). Weeks with no calls are included with 0, so the chart has no gaps.
 * `span` is the data's first and last date; a week running past either end of the data is partial.
 */
export function callsPerWeek(calls: readonly CleanCall[], range: DateRange, span: DateRange): WeekBucket[] {
  // The part of the range the data actually covers; a week must sit wholly inside it to be complete.
  const coveredStart = range.start > span.start ? range.start : span.start;
  const coveredEnd = range.end < span.end ? range.end : span.end;

  const buckets: WeekBucket[] = [];
  const indexByStart = new Map<LocalDate, WeekBucket>();
  for (let start = weekStart(range.start); start <= range.end; start = addDays(start, 7)) {
    const end = addDays(start, 6);
    const bucket = { weekStart: start, weekEnd: end, calls: 0, partial: start < coveredStart || end > coveredEnd };
    buckets.push(bucket);
    indexByStart.set(start, bucket);
  }

  for (const call of calls) {
    if (call.localDate < range.start || call.localDate > range.end) continue;
    indexByStart.get(weekStart(call.localDate))!.calls += 1;
  }
  return buckets;
}
