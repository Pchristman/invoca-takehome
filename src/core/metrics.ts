import type { DateRange } from './ranges';
import type { CleanCall } from './types';

export interface Tally {
  calls: number;
  /** Distinct caller hashes. Calls with no hash can't be told apart, so they add to `calls` but not here. */
  uniqueCallers: number;
  /** Includes answered calls whose outcome is still pending. */
  answered: number;
  bookings: number;
  revenueUsd: number;
}

/**
 * How a value changed. `value` is not rounded (25.000000000000004 is possible): the UI rounds when it
 * formats. 25 means +25%, and 5 means +5 percentage points.
 */
export type Change =
  | { kind: 'none' }
  | { kind: 'new' }
  | { kind: 'percent'; value: number }
  | { kind: 'points'; value: number };

/** Whole cents for an amount of dollars. A value that isn't a finite number counts as $0. */
export function toCents(usd: number): number {
  return Number.isFinite(usd) ? Math.round(usd * 100) : 0;
}

/** The calls whose local date falls in the range, inclusive at both ends. */
export function callsInRange(calls: readonly CleanCall[], range: DateRange): CleanCall[] {
  return calls.filter((call) => call.localDate >= range.start && call.localDate <= range.end);
}

export function tally(calls: readonly CleanCall[]): Tally {
  const callers = new Set<string>();
  let answered = 0;
  let bookings = 0;
  let revenueCents = 0; // whole cents, so float sums can't drift
  for (const call of calls) {
    if (call.callerHash !== '') callers.add(call.callerHash);
    if (call.answered) answered += 1;
    if (call.booked) {
      bookings += 1;
      revenueCents += toCents(call.revenueUsd); // revenue counts on booked calls only (rule 6)
    }
  }
  return { calls: calls.length, uniqueCallers: callers.size, answered, bookings, revenueUsd: revenueCents / 100 };
}

/** A share between 0 and 1, or null when there is nothing to divide by or an input isn't a finite number. */
export function rate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

/** Change in a count or an amount of money: a percentage, "new" from zero, or nothing when both are zero. */
export function changeInCount(current: number, previous: number): Change {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { kind: 'none' };
  if (previous === 0) return current === 0 ? { kind: 'none' } : { kind: 'new' };
  return { kind: 'percent', value: ((current - previous) / previous) * 100 };
}

/**
 * Change in a count or an amount of money between ranges of different lengths, compared per day. Nothing
 * when either day count isn't a positive whole number. Equal lengths give exactly `changeInCount`.
 */
export function changeInCountPerDay(current: number, currentDays: number, previous: number, previousDays: number): Change {
  const usable = (days: number) => Number.isInteger(days) && days > 0;
  if (!usable(currentDays) || !usable(previousDays)) return { kind: 'none' };
  if (currentDays === previousDays) return changeInCount(current, previous);
  return changeInCount(current / currentDays, previous / previousDays);
}

/** Change in a rate, in percentage points. Nothing when either rate is missing or both are zero. */
export function changeInRate(current: number | null, previous: number | null): Change {
  if (current === null || previous === null) return { kind: 'none' };
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { kind: 'none' };
  if (current === 0 && previous === 0) return { kind: 'none' };
  return { kind: 'points', value: (current - previous) * 100 };
}

/**
 * The daily budget over the days in the range, to whole cents. Always an estimate: the data holds budgets,
 * not spend. A budget or day count that isn't a finite number gives $0, which leaves cost per booking blank.
 */
export function estimatedSpend(dailyBudgetUsd: number, days: number): number {
  if (!Number.isFinite(dailyBudgetUsd) || !Number.isFinite(days)) return 0;
  return toCents(dailyBudgetUsd * days) / 100;
}

/** Blank (null) when nothing was spent, nothing was booked, or an input isn't a finite number. */
export function costPerBooking(estimatedSpendUsd: number, bookings: number): number | null {
  if (!Number.isFinite(estimatedSpendUsd) || !Number.isFinite(bookings)) return null;
  return estimatedSpendUsd === 0 || bookings === 0 ? null : estimatedSpendUsd / bookings;
}

/** Blank (null) when nothing was spent or an input isn't a finite number. */
export function revenuePerBudgetDollar(revenueUsd: number, estimatedSpendUsd: number): number | null {
  if (!Number.isFinite(revenueUsd) || !Number.isFinite(estimatedSpendUsd)) return null;
  return estimatedSpendUsd === 0 ? null : revenueUsd / estimatedSpendUsd;
}
