import { addDays, daysBetween } from './localDate';
import { checkDates } from './ranges';
import type { DateRange, RangeError } from './ranges';

export interface RangeComparison {
  previous: DateRange & { days: number };
  /** True only when every day of `previous` lies inside the data. */
  available: boolean;
  /** One line starting "No full previous period"; null when the comparison is available. */
  unavailableReason: string | null;
  /** False when the two ranges have different numbers of days. */
  sameLength: boolean;
}

export type ComparisonResult = { ok: true; comparison: RangeComparison } | { ok: false; error: RangeError };

export interface IncompleteDays {
  includesFirstDay: boolean;
  includesLastDay: boolean;
}

function lengthOf(range: DateRange): number {
  return daysBetween(range.start, range.end) + 1;
}

function coverageProblem(span: DateRange, previous: DateRange): string | null {
  const period = `${previous.start} to ${previous.end}`;
  if (previous.start < span.start) {
    return `No full previous period: it would start ${previous.start}, but the data starts ${span.start}.`;
  }
  if (previous.end > span.end) {
    return `No full previous period: ${period} runs past the end of the data, ${span.end}.`;
  }
  return null;
}

/**
 * The range to compare `current` with. Left out, it is the same number of days immediately before `current`.
 * A range the data doesn't fully cover is returned with `available: false` and the reason; it is never an error.
 */
export function resolveComparison(span: DateRange, current: DateRange, previous?: DateRange): ComparisonResult {
  const currentDays = lengthOf(current);
  const wanted = previous ?? { start: addDays(current.start, -currentDays), end: addDays(current.start, -1) };

  const problem = checkDates(wanted.start, wanted.end);
  if (problem) return { ok: false, error: problem };

  const days = lengthOf(wanted);
  const unavailableReason = coverageProblem(span, wanted);
  return {
    ok: true,
    comparison: {
      previous: { ...wanted, days },
      available: unavailableReason === null,
      unavailableReason,
      sameLength: days === currentDays,
    },
  };
}

/** Whether the range contains the first or last day of the data, either of which may be incomplete. */
export function incompleteDays(span: DateRange, range: DateRange): IncompleteDays {
  return {
    includesFirstDay: range.start <= span.start && span.start <= range.end,
    includesLastDay: range.start <= span.end && span.end <= range.end,
  };
}

/**
 * Whether recent bookings and revenue in `range` may still rise: the measured outcome lag is above zero
 * and the range ends no more than that many days before the as-of date (the last data day).
 */
export function outcomeLagApplies(span: DateRange, range: DateRange, lagDays: number): boolean {
  return lagDays > 0 && daysBetween(range.end, span.end) <= lagDays;
}
