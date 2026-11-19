import { rate } from './metrics';
import { THRESHOLDS } from './thresholds';

export interface CampaignPerformance {
  campaignId: string;
  bookings: number;
  estimatedSpendUsd: number;
  revenuePerBudgetDollar: number | null;
}

export interface BestWorst {
  /** How many campaigns qualified, so the view can say why nothing is marked. */
  eligible: number;
  best: CampaignPerformance | null;
  worst: CampaignPerformance | null;
}

/** Plain character order, so the result never depends on the machine's locale. */
function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Best and worst campaign by revenue per budget dollar. Rows are real campaigns only (the caller leaves
 * out "Unattributed"). A campaign needs a budget above $0 and at least `minBookings` bookings. Fewer than
 * two qualifying campaigns, or no spread between best and worst, marks nothing.
 */
export function pickBestWorst(
  rows: readonly CampaignPerformance[],
  minBookings: number = THRESHOLDS.MIN_BOOKINGS_TO_RANK,
): BestWorst {
  const eligible = rows
    .filter((row) => row.estimatedSpendUsd > 0 && row.bookings >= minBookings && row.revenuePerBudgetDollar !== null)
    .sort((a, b) => b.revenuePerBudgetDollar! - a.revenuePerBudgetDollar! || byId(a.campaignId, b.campaignId));

  const best = eligible[0];
  const worst = eligible[eligible.length - 1];
  if (eligible.length < 2 || best!.revenuePerBudgetDollar === worst!.revenuePerBudgetDollar) {
    return { eligible: eligible.length, best: null, worst: null };
  }
  return { eligible: eligible.length, best: best!, worst: worst! };
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
        b.bookings / b.calls - a.bookings / a.calls || b.bookings - a.bookings || byId(a.campaignId, b.campaignId),
    );
  return ranked[0] ?? null;
}

export interface ProportionGroup {
  successes: number;
  calls: number;
}

/** Two-proportion z-test of `a` against `b`, pooled. Null when a group has no calls or the rates have no variance. */
export function twoProportionZ(a: ProportionGroup, b: ProportionGroup): number | null {
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
