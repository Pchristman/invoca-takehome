import { addDays, daysBetween, inclusiveDays } from './localDate';
import { checkDates } from './ranges';
import type { DateRange, RangeError } from './ranges';

export interface RangeComparison {
  previous: DateRange & { days: number };
  /** True when every day of `previous` lies inside the data. The two ranges may differ in length (see `perDay`). */
  available: boolean;
  /** One line starting "No full previous period"; null when available. */
  unavailableReason: string | null;
  /** False when the two ranges have different numbers of days. */
  sameLength: boolean;
  /** True exactly when `available` and the two ranges differ in length: counts and money compare per day. */
  perDay: boolean;
  /** True when the two ranges share at least one day. */
  overlaps: boolean;
}

export type ComparisonResult = { ok: true; comparison: RangeComparison } | { ok: false; error: RangeError };

export interface IncompleteDays {
  includesFirstDay: boolean;
}

function coverageProblem(span: DateRange, previous: DateRange): string | null {
  if (previous.start < span.start) {
    return `No full previous period: it would start ${previous.start}, but the data starts ${span.start}.`;
  }
  if (previous.end > span.end) {
    return `No full previous period: ${previous.start} to ${previous.end} runs past the end of the data, ${span.end}.`;
  }
  return null;
}

/**
 * The range to compare `current` with. Left out, it is the same number of days immediately before `current`.
 * A range the data doesn't fully cover comes back with `available: false` and the reason; that is not an
 * error. A range of a different length is available and flagged `perDay`: counts compare per day.
 */
export function resolveComparison(span: DateRange, current: DateRange, previous?: DateRange): ComparisonResult {
  // `current` normally comes from resolveRange, but this function must not throw or blame the wrong dates.
  const currentProblem = checkDates(current.start, current.end);
  if (currentProblem) return { ok: false, error: currentProblem };

  const currentDays = inclusiveDays(current.start, current.end);
  const wanted = previous ?? { start: addDays(current.start, -currentDays), end: addDays(current.start, -1) };

  const problem = checkDates(wanted.start, wanted.end);
  if (problem) return { ok: false, error: problem };

  const days = inclusiveDays(wanted.start, wanted.end);
  const sameLength = days === currentDays;
  const unavailableReason = coverageProblem(span, wanted);
  return {
    ok: true,
    comparison: {
      previous: { ...wanted, days },
      available: unavailableReason === null,
      unavailableReason,
      sameLength,
      perDay: unavailableReason === null && !sameLength,
      overlaps: wanted.start <= current.end && current.start <= wanted.end,
    },
  };
}

/** Whether the range contains the first day of the data, which may be incomplete. */
export function incompleteDays(span: DateRange, range: DateRange): IncompleteDays {
  return {
    includesFirstDay: range.start <= span.start && span.start <= range.end,
  };
}

/**
 * Whether recent bookings and revenue in `range` may still rise: the measured outcome lag is above zero
 * and the range ends no more than that many days before the as-of date (the last data day).
 */
export function outcomeLagApplies(span: DateRange, range: DateRange, lagDays: number): boolean {
  return lagDays > 0 && daysBetween(range.end, span.end) <= lagDays;
}
