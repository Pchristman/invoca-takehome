/** The tunable cut-offs from PLAN.md section 4.5. None of them is derived from any dataset. */
export interface Thresholds {
  /** Campaigns need this many bookings in range to be marked best or worst. */
  MIN_BOOKINGS_TO_RANK: number;
  /** A campaign needs this many calls at an office to be that office's best campaign. */
  MIN_CALLS_BEST_CAMPAIGN: number;
  /** An office needs this many calls in range to be tested as an outlier. */
  MIN_CALLS_OUTLIER: number;
  /** An office is flagged when its |z| against all other offices reaches this. */
  OUTLIER_Z: number;
  /** Answered calls with an outcome needed before a campaign's (then channel's) own rates are used. */
  MIN_ANSWERED_FOR_RATE: number;
}

export const THRESHOLDS: Thresholds = {
  MIN_BOOKINGS_TO_RANK: 5,
  MIN_CALLS_BEST_CAMPAIGN: 20,
  MIN_CALLS_OUTLIER: 50,
  OUTLIER_Z: 2.5,
  MIN_ANSWERED_FOR_RATE: 30,
};
