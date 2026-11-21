/** The tunable cut-offs from PLAN.md section 4.5. None of them is derived from any dataset. */
export interface Thresholds {
  /** A campaign needs this many bookings in range to be marked best, so its figure means something. */
  MIN_BOOKINGS_TO_RANK: number;
  /** A campaign needs this many calls in range to be marked worst: it took budget and enough calls to judge, even if it booked nothing. */
  MIN_CALLS_TO_RANK_WORST: number;
  /** A campaign needs this many calls at an office to be that office's best campaign. */
  MIN_CALLS_BEST_CAMPAIGN: number;
  /** An office needs this many calls in range to be tested as an outlier. */
  MIN_CALLS_OUTLIER: number;
  /** An office is flagged when its |z| against all other offices reaches this. About 16 tests per screen (8 offices × 2 rates), so 3 rather than 2.5. */
  OUTLIER_Z: number;
  /** Answered calls with an outcome needed before a campaign's (then channel's) own rates are used. */
  MIN_ANSWERED_FOR_RATE: number;
  /** A campaign's calls are flagged as a jump or drop when |z| against the comparison range reaches this. */
  ALERT_Z: number;
  /** A campaign is tested for a jump or drop when its calls in both periods added together reach this. */
  MIN_CALLS_ALERT: number;
}

export const THRESHOLDS: Thresholds = {
  MIN_BOOKINGS_TO_RANK: 5,
  MIN_CALLS_TO_RANK_WORST: 10,
  MIN_CALLS_BEST_CAMPAIGN: 20,
  MIN_CALLS_OUTLIER: 50,
  OUTLIER_Z: 3,
  MIN_ANSWERED_FOR_RATE: 30,
  ALERT_Z: 3,
  MIN_CALLS_ALERT: 20,
};
