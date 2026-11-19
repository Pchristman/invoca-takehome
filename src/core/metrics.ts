import type { DateRange } from './ranges';
import type { CleanCall } from './types';

export interface Tally {
  calls: number;
  uniqueCallers: number;
  /** Includes answered calls whose outcome is still pending. */
  answered: number;
  bookings: number;
  revenueUsd: number;
}

/** How a value changed. Both numbers are ready to display: 25 is +25%, and 5 is +5 percentage points. */
export type Change =
  | { kind: 'none' }
  | { kind: 'new' }
  | { kind: 'percent'; value: number }
  | { kind: 'points'; value: number };

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
    callers.add(call.callerHash);
    if (call.answered) answered += 1;
    if (call.booked) bookings += 1;
    revenueCents += Math.round(call.revenueUsd * 100);
  }
  return { calls: calls.length, uniqueCallers: callers.size, answered, bookings, revenueUsd: revenueCents / 100 };
}

/** A share between 0 and 1, or null when there is nothing to divide by. */
export function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** Change in a count or an amount of money: a percentage, "new" from zero, or nothing when both are zero. */
export function changeInCount(current: number, previous: number): Change {
  if (previous === 0) return current === 0 ? { kind: 'none' } : { kind: 'new' };
  return { kind: 'percent', value: ((current - previous) / previous) * 100 };
}

/** Change in a rate, in percentage points. Nothing when either rate is missing or both are zero. */
export function changeInRate(current: number | null, previous: number | null): Change {
  if (current === null || previous === null) return { kind: 'none' };
  if (current === 0 && previous === 0) return { kind: 'none' };
  return { kind: 'points', value: (current - previous) * 100 };
}

/** The daily budget over the days in the range. Always an estimate: the data holds budgets, not spend. */
export function estimatedSpend(dailyBudgetUsd: number, days: number): number {
  return dailyBudgetUsd * days;
}

/** Blank (null) when nothing was spent or nothing was booked. */
export function costPerBooking(estimatedSpendUsd: number, bookings: number): number | null {
  return estimatedSpendUsd === 0 || bookings === 0 ? null : estimatedSpendUsd / bookings;
}

/** Blank (null) when nothing was spent. */
export function revenuePerBudgetDollar(revenueUsd: number, estimatedSpendUsd: number): number | null {
  return estimatedSpendUsd === 0 ? null : revenueUsd / estimatedSpendUsd;
}
