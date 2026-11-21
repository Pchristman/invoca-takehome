import { describe, expect, test } from 'vitest';
import { bestCampaignAtOffice, officeOutlier, pickBestWorst, twoProportionZ } from '../../src/core/ranking';
import type { CampaignPerformance } from '../../src/core/ranking';

const perf = (
  campaignId: string,
  bookings: number,
  estimatedSpendUsd: number,
  revenuePerBudgetDollar: number | null,
  calls = 40,
): CampaignPerformance => ({
  campaignId,
  calls,
  bookings,
  estimatedSpendUsd,
  revenuePerBudgetDollar,
});

const A = perf('cmp_a', 10, 600, 3);
const B = perf('cmp_b', 12, 600, 9.86);
const C = perf('cmp_c', 8, 300, 1.37);

describe('pickBestWorst', () => {
  test('marks the highest and lowest revenue per budget dollar', () => {
    const result = pickBestWorst([A, B, C]);
    expect(result).toMatchObject({ eligibleBest: 3, eligibleWorst: 3, reason: null });
    expect(result.best?.campaignId).toBe('cmp_b');
    expect(result.worst?.campaignId).toBe('cmp_c');
  });

  test('worst can be a campaign that took budget and calls but booked almost nothing', () => {
    // The reported case: 12 calls and 1 booking sit below 40 calls and 6 bookings, so they are the worst.
    const fewBookings = perf('cmp_r', 1, 600, 0.33, 12);
    const manyBookings = perf('cmp_e', 6, 600, 0.79, 40);
    const result = pickBestWorst([B, manyBookings, fewBookings]);
    expect(result).toMatchObject({ eligibleBest: 2, eligibleWorst: 3, reason: null });
    expect(result.best?.campaignId).toBe('cmp_b');
    expect(result.worst?.campaignId).toBe('cmp_r');
  });

  test('a campaign with no bookings earns $0.00 per budget dollar and can be worst', () => {
    const result = pickBestWorst([A, B, perf('cmp_z', 0, 600, 0, 10)]);
    expect(result.worst?.campaignId).toBe('cmp_z');
    expect(result.worst?.revenuePerBudgetDollar).toBe(0);
  });

  test('worst needs the minimum calls: one below is not judged, exactly the minimum is', () => {
    expect(pickBestWorst([A, B, perf('cmp_z', 0, 600, 0, 9)]).worst?.campaignId).toBe('cmp_a');
    expect(pickBestWorst([A, B, perf('cmp_z', 0, 600, 0, 10)]).worst?.campaignId).toBe('cmp_z');
  });

  test('best still needs the minimum bookings: one below is not best, exactly the minimum is', () => {
    const tooFew = perf('cmp_d', 4, 600, 20);
    const result = pickBestWorst([A, B, C, tooFew]);
    expect(result.eligibleBest).toBe(3);
    expect(result.best?.campaignId).toBe('cmp_b');

    const exactly = perf('cmp_e', 5, 600, 20);
    const withBoundary = pickBestWorst([A, B, C, exactly]);
    expect(withBoundary.eligibleBest).toBe(4);
    expect(withBoundary.best?.campaignId).toBe('cmp_e');
  });

  test('a $0 or unknown budget is never best or worst, whatever its calls', () => {
    // The view passes an unknown budget as $0 spend with no value.
    const unknown = perf('cmp_organic', 50, 0, null, 200);
    const zero = perf('cmp_zero', 0, 0, 0, 200);
    const result = pickBestWorst([A, B, unknown, zero]);
    expect(result).toMatchObject({ eligibleBest: 2, eligibleWorst: 2 });
    expect(result.worst?.campaignId).toBe('cmp_a');
  });

  test('no pair of campaigns marks nothing and says so', () => {
    expect(pickBestWorst([A])).toEqual({ eligibleBest: 1, eligibleWorst: 1, best: null, worst: null, reason: 'no_pair' });
    expect(pickBestWorst([])).toEqual({ eligibleBest: 0, eligibleWorst: 0, best: null, worst: null, reason: 'no_pair' });
    // Plenty of calls to judge, but nobody has the bookings to be best.
    const result = pickBestWorst([perf('cmp_x', 4, 600, 2, 50), perf('cmp_y', 1, 600, 0.5, 50)]);
    expect(result).toEqual({ eligibleBest: 0, eligibleWorst: 2, best: null, worst: null, reason: 'no_pair' });
  });

  test('when the best is the only campaign with enough calls, nothing is marked', () => {
    // cmp_q has 5 bookings but only 9 calls, so it can be best but not worst; cmp_a is the only worst candidate and is best.
    const result = pickBestWorst([perf('cmp_a', 10, 600, 3), perf('cmp_q', 5, 600, 1, 9)]);
    expect(result).toEqual({ eligibleBest: 2, eligibleWorst: 1, best: null, worst: null, reason: 'no_pair' });
  });

  test('worst must be below best: a worst candidate earning more than the best marks nothing', () => {
    // cmp_w has the calls but too few bookings to be best, and earns more than the best.
    const result = pickBestWorst([perf('cmp_a', 10, 600, 3, 9), perf('cmp_w', 2, 600, 5, 30)]);
    expect(result).toEqual({ eligibleBest: 1, eligibleWorst: 1, best: null, worst: null, reason: 'no_spread' });
  });

  test('two eligible campaigns with equal value mark nothing', () => {
    const result = pickBestWorst([perf('cmp_a', 10, 600, 4), perf('cmp_b', 10, 600, 4)]);
    expect(result).toEqual({ eligibleBest: 2, eligibleWorst: 2, best: null, worst: null, reason: 'no_spread' });
  });

  test('ties are broken by campaign id, whatever the input order', () => {
    const rows = [perf('cmp_y', 10, 600, 5), perf('cmp_x', 10, 600, 5), perf('cmp_z', 10, 600, 2)];
    for (const order of [rows, [...rows].reverse()]) {
      const result = pickBestWorst(order);
      expect(result.best?.campaignId).toBe('cmp_x');
      expect(result.worst?.campaignId).toBe('cmp_z');
    }
  });

  test('best and worst both treat values equal to the cent as a tie, broken by campaign id', () => {
    const rows = [perf('cmp_b', 10, 600, 5.004), perf('cmp_a', 10, 600, 5.001), perf('cmp_d', 10, 600, 2.004), perf('cmp_c', 10, 600, 2.001)];
    for (const order of [rows, [...rows].reverse()]) {
      const result = pickBestWorst(order);
      expect(result.best?.campaignId).toBe('cmp_a');
      expect(result.worst?.campaignId).toBe('cmp_c');
    }
  });

  test('ties for worst go to the lower campaign id too, including at $0.00, whatever the input order', () => {
    const rows = [perf('cmp_c', 0, 600, 0, 10), perf('cmp_b', 0, 600, 0, 12), perf('cmp_a', 10, 600, 9)];
    for (const order of [rows, [...rows].reverse()]) {
      const result = pickBestWorst(order);
      expect(result.best?.campaignId).toBe('cmp_a');
      expect(result.worst?.campaignId).toBe('cmp_b');
    }
  });

  test('a campaign whose value is not a finite number is never best or worst', () => {
    const result = pickBestWorst([A, B, C, perf('cmp_n', 10, 600, Number.NaN)]);
    expect(result).toMatchObject({ eligibleBest: 3, eligibleWorst: 3 });
    expect(result.best?.campaignId).toBe('cmp_b');
    expect(result.worst?.campaignId).toBe('cmp_c');
  });

  test('values that differ only by floating-point noise are the same value', () => {
    const result = pickBestWorst([perf('cmp_a', 10, 600, 0.1 + 0.2), perf('cmp_b', 10, 600, 0.3)]);
    expect(result).toMatchObject({ best: null, worst: null, reason: 'no_spread' });
  });

  test('a campaign with no bookings is never best, even if minBookings is 0', () => {
    expect(pickBestWorst([perf('cmp_z', 0, 600, 0)], 0)).toMatchObject({ eligibleBest: 0, best: null });
  });

  test('minBookings and minCalls can be overridden', () => {
    const tooFew = perf('cmp_d', 4, 600, 20);
    expect(pickBestWorst([A, B, C, tooFew], 1).best?.campaignId).toBe('cmp_d');
    expect(pickBestWorst([A, B, perf('cmp_z', 0, 600, 0, 3)], 5, 3).worst?.campaignId).toBe('cmp_z');
  });
});

describe('bestCampaignAtOffice', () => {
  const X = { campaignId: 'cmp_x', calls: 30, bookings: 9 }; // 0.30
  const Y = { campaignId: 'cmp_y', calls: 20, bookings: 8 }; // 0.40
  const Z = { campaignId: 'cmp_z', calls: 19, bookings: 10 }; // 0.526, but too few calls

  test('picks the highest booking rate among campaigns with enough calls', () => {
    expect(bestCampaignAtOffice([X, Y, Z])).toEqual(Y);
  });

  test('19 calls is out and exactly 20 is in', () => {
    expect(bestCampaignAtOffice([Z])).toBeNull();
    expect(bestCampaignAtOffice([{ ...Z, calls: 20 }])?.campaignId).toBe('cmp_z');
  });

  test('is null when none qualify', () => {
    expect(bestCampaignAtOffice([])).toBeNull();
    expect(bestCampaignAtOffice([Z, { campaignId: 'cmp_w', calls: 5, bookings: 5 }])).toBeNull();
  });

  test('a rate tie goes to more bookings, then the lower campaign id', () => {
    const fewer = { campaignId: 'cmp_a', calls: 20, bookings: 4 }; // 0.2
    const more = { campaignId: 'cmp_b', calls: 40, bookings: 8 }; // 0.2
    expect(bestCampaignAtOffice([fewer, more])?.campaignId).toBe('cmp_b');

    const sameA = { campaignId: 'cmp_a', calls: 20, bookings: 4 };
    const sameB = { campaignId: 'cmp_b', calls: 20, bookings: 4 };
    expect(bestCampaignAtOffice([sameB, sameA])?.campaignId).toBe('cmp_a');
  });
});

describe('twoProportionZ', () => {
  test('matches the formula', () => {
    expect(twoProportionZ({ successes: 30, calls: 100 }, { successes: 500, calls: 1000 })).toBeCloseTo(-3.82, 1);
    expect(twoProportionZ({ successes: 500, calls: 1000 }, { successes: 30, calls: 100 })).toBeCloseTo(3.82, 1);
  });

  test('is null for impossible groups: more successes than calls, negatives, or NaN', () => {
    expect(twoProportionZ({ successes: 11, calls: 10 }, { successes: 5, calls: 10 })).toBeNull();
    expect(twoProportionZ({ successes: -1, calls: 10 }, { successes: 5, calls: 10 })).toBeNull();
    expect(twoProportionZ({ successes: Number.NaN, calls: 10 }, { successes: 5, calls: 10 })).toBeNull();
  });

  test('is null with no calls or no variance, never NaN', () => {
    expect(twoProportionZ({ successes: 0, calls: 0 }, { successes: 5, calls: 10 })).toBeNull();
    expect(twoProportionZ({ successes: 5, calls: 10 }, { successes: 0, calls: 0 })).toBeNull();
    expect(twoProportionZ({ successes: 50, calls: 50 }, { successes: 100, calls: 100 })).toBeNull();
    expect(twoProportionZ({ successes: 0, calls: 20 }, { successes: 0, calls: 30 })).toBeNull();
  });
});

describe('officeOutlier', () => {
  const rest = { successes: 500, calls: 1000 };

  test('flags a worse office with both rates', () => {
    const result = officeOutlier({ successes: 30, calls: 100 }, rest);
    expect(result).toMatchObject({ eligible: true, flagged: true, direction: 'worse', officeRate: 0.3, restRate: 0.5 });
    expect(result.z).toBeCloseTo(-3.82, 1);
  });

  test('flags a better office', () => {
    const result = officeOutlier({ successes: 70, calls: 100 }, rest);
    expect(result).toMatchObject({ flagged: true, direction: 'better' });
  });

  test('does not flag a difference chance can explain', () => {
    const result = officeOutlier({ successes: 40, calls: 100 }, rest);
    expect(result.eligible).toBe(true);
    expect(result.z).toBeCloseTo(-1.9, 1);
    expect(result.flagged).toBe(false);
    expect(result.direction).toBeNull();
  });

  test('flags at the threshold, not below it', () => {
    const office = { successes: 30, calls: 100 };
    const z = twoProportionZ(office, rest)!;
    expect(officeOutlier(office, rest, { z: Math.abs(z) }).flagged).toBe(true);
    expect(officeOutlier(office, rest, { z: Math.abs(z) + 0.001 }).flagged).toBe(false);
  });

  test('needs MIN_CALLS_OUTLIER calls: 49 is not eligible, 50 is', () => {
    const small = officeOutlier({ successes: 10, calls: 49 }, rest);
    expect(small).toMatchObject({ eligible: false, flagged: false, z: null });

    const enough = officeOutlier({ successes: 10, calls: 50 }, rest);
    expect(enough).toMatchObject({ eligible: true, flagged: true });
    expect(enough.z).toBeCloseTo(-4.1, 0);
  });

  test('a tiny sample is not eligible however extreme', () => {
    const result = officeOutlier({ successes: 0, calls: 5 }, { successes: 900, calls: 1000 });
    expect(result).toMatchObject({ eligible: false, flagged: false, z: null });
  });

  test('no other offices means not eligible', () => {
    const result = officeOutlier({ successes: 30, calls: 100 }, { successes: 0, calls: 0 });
    expect(result).toMatchObject({ eligible: false, flagged: false, z: null });
  });

  test('no variance is eligible but never flagged', () => {
    const result = officeOutlier({ successes: 50, calls: 50 }, { successes: 100, calls: 100 });
    expect(result).toMatchObject({ eligible: true, z: null, flagged: false });
  });

  test('the default threshold sits at 3: z of about -3.05 flags and about -2.86 does not', () => {
    const above = officeOutlier({ successes: 34, calls: 100 }, rest);
    const below = officeOutlier({ successes: 35, calls: 100 }, rest);
    expect(above.z).toBeCloseTo(-3.05, 1);
    expect(below.z).toBeCloseTo(-2.86, 1);
    expect(above.flagged).toBe(true);
    expect(below.flagged).toBe(false);
  });
});
