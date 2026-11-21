import { rate } from './metrics';
import { compareText } from './text';
import { THRESHOLDS } from './thresholds';

export interface CampaignPerformance {
  campaignId: string;
  calls: number;
  bookings: number;
  estimatedSpendUsd: number;
  revenuePerBudgetDollar: number | null;
}

export interface BestWorst {
  /** How many campaigns could be best, and how many could be worst, so the view can state the rule. */
  eligibleBest: number;
  eligibleWorst: number;
  best: CampaignPerformance | null;
  worst: CampaignPerformance | null;
  /** Why nothing is marked: no two different campaigns qualify, or none qualifying as worst earns less than the best. */
  reason: 'no_pair' | 'no_spread' | null;
}

/** Compared to the cent, so floating-point noise never makes a spread or decides a tie. */
const cents = (row: CampaignPerformance): number => Math.round(row.revenuePerBudgetDollar! * 100);

/**
 * Best and worst campaign by revenue per budget dollar. Rows are real campaigns only (the caller leaves
 * out "Unattributed"). Both need a budget above $0. Best also needs at least `minBookings` bookings, so its
 * figure means something; worst needs at least `minCalls` calls, so a campaign that took budget and calls
 * but booked little or nothing can be worst. Best and worst must be two different campaigns, with worst
 * below best; otherwise nothing is marked.
 */
export function pickBestWorst(
  rows: readonly CampaignPerformance[],
  minBookings: number = THRESHOLDS.MIN_BOOKINGS_TO_RANK,
  minCalls: number = THRESHOLDS.MIN_CALLS_TO_RANK_WORST,
): BestWorst {
  // Highest value first; values equal to the cent by the lower campaign id, so the order never depends on the input order.
  const ranked = rows
    .filter((row) => row.estimatedSpendUsd > 0 && row.revenuePerBudgetDollar !== null && Number.isFinite(row.revenuePerBudgetDollar))
    .sort((a, b) => cents(b) - cents(a) || compareText(a.campaignId, b.campaignId));
  // At least one booking for best, whatever minBookings says: a best with none has nothing to show.
  const bestPool = ranked.filter((row) => row.bookings >= Math.max(minBookings, 1));
  const worstPool = ranked.filter((row) => row.calls >= Math.max(minCalls, 1));
  const counts = { eligibleBest: bestPool.length, eligibleWorst: worstPool.length };

  const best = bestPool[0];
  const others = worstPool.filter((row) => row !== best);
  if (!best || others.length === 0) return { ...counts, best: null, worst: null, reason: 'no_pair' };
  // Ties for worst go to the lower campaign id: the first row at the lowest value in this order.
  const lowest = others[others.length - 1]!;
  const worst = others.find((row) => cents(row) === cents(lowest))!;
  if (cents(worst) >= cents(best)) return { ...counts, best: null, worst: null, reason: 'no_spread' };
  return { ...counts, best, worst, reason: null };
}

export interface CampaignAtOffice {
  campaignId: string;
  calls: number;
  bookings: number;
}

/**
 * The campaign with the highest booking rate at one office, among those with at least `minCalls` calls there.
 * Ties go to more bookings, then the lower campaign id. Rows are real campaigns only.
 */
export function bestCampaignAtOffice(
  rows: readonly CampaignAtOffice[],
  minCalls: number = THRESHOLDS.MIN_CALLS_BEST_CAMPAIGN,
): CampaignAtOffice | null {
  const ranked = rows
    .filter((row) => row.calls > 0 && row.calls >= minCalls)
    .sort(
      (a, b) =>
        b.bookings / b.calls - a.bookings / a.calls || b.bookings - a.bookings || compareText(a.campaignId, b.campaignId),
    );
  return ranked[0] ?? null;
}

export interface ProportionGroup {
  successes: number;
  calls: number;
}

function isValidGroup(group: ProportionGroup): boolean {
  return Number.isFinite(group.successes) && Number.isFinite(group.calls) && group.successes >= 0 && group.successes <= group.calls;
}

/**
 * Two-proportion z-test of `a` against `b`, pooled. Null when a group has no calls, is impossible (more
 * successes than calls, negative or not a number), or the rates have no variance.
 */
export function twoProportionZ(a: ProportionGroup, b: ProportionGroup): number | null {
  if (!isValidGroup(a) || !isValidGroup(b)) return null;
  if (a.calls === 0 || b.calls === 0) return null;
  const pooled = (a.successes + b.successes) / (a.calls + b.calls);
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / a.calls + 1 / b.calls));
  if (standardError === 0) return null;
  return (a.successes / a.calls - b.successes / b.calls) / standardError;
}

export interface OutlierOptions {
  /** Flag when |z| reaches this. Default `THRESHOLDS.OUTLIER_Z`. */
  z?: number;
  /** An office needs this many calls to be tested. Default `THRESHOLDS.MIN_CALLS_OUTLIER`. */
  minCalls?: number;
}

export interface OutlierResult {
  eligible: boolean;
  /** Null when not eligible or the rates have no variance. */
  z: number | null;
  flagged: boolean;
  direction: 'better' | 'worse' | null;
  officeRate: number | null;
  restRate: number | null;
}

/** One office against all other offices pooled (`rest`). A higher rate is better for answer and booking rate. */
export function officeOutlier(office: ProportionGroup, rest: ProportionGroup, options: OutlierOptions = {}): OutlierResult {
  const threshold = options.z ?? THRESHOLDS.OUTLIER_Z;
  const minCalls = options.minCalls ?? THRESHOLDS.MIN_CALLS_OUTLIER;
  const officeRate = rate(office.successes, office.calls);
  const restRate = rate(rest.successes, rest.calls);

  const eligible = office.calls >= minCalls && rest.calls > 0;
  const z = eligible ? twoProportionZ(office, rest) : null;
  const flagged = z !== null && Math.abs(z) >= threshold;
  const direction = flagged ? (z! > 0 ? 'better' : 'worse') : null;
  return { eligible, z, flagged, direction, officeRate, restRate };
}
