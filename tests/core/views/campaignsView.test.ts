import { describe, expect, it } from 'vitest';
import { buildCampaigns } from '../../../src/core/views/campaignsView';
import type { CleanCall } from '../../../src/core/types';
import { makeCall } from '../helpers';
import { campaign, expectAllFinite, makeStore, many, office, range } from './fixtures';

const campaigns = [
  campaign('cmp_a', 'Alpha', 'social', 10),
  campaign('cmp_b', 'Beta', 'display', 20),
  campaign('cmp_c', 'Gamma', 'referral', 0),
  campaign('cmp_d', 'Delta', 'paid_search', 5),
];
const locations = [office('loc_1', 'One')];
const fourteen = range('2026-09-01', '2026-09-14');

/** n calls for a campaign, `booked` of them booked at `revenue`, the rest answered and not booked. */
function campaignCalls(
  campaignId: string,
  n: number,
  booked: number,
  revenue: number,
  over: Partial<CleanCall> = {},
): CleanCall[] {
  return many(n).map((call, i) =>
    makeCall({
      ...call,
      campaignId,
      localDate: '2026-09-05',
      ...(i < booked
        ? { booked: true, outcome: 'booked', revenueUsd: revenue }
        : { booked: false, outcome: 'not_qualified', revenueUsd: 0 }),
      ...over,
    }),
  );
}

const unattributedCalls = (over: Partial<CleanCall> = {}): CleanCall[] => [
  makeCall({ campaignId: null, unattributed: true, trackingNumber: '+1-555-0190', revenueUsd: 100, localDate: '2026-09-05', ...over }),
  makeCall({ campaignId: null, unattributed: true, trackingNumber: '+1-555-0190', revenueUsd: 50, localDate: '2026-09-05', ...over }),
  makeCall({
    campaignId: null, unattributed: true, trackingNumber: '+1-555-0191', booked: false,
    outcome: 'not_qualified', revenueUsd: 0, localDate: '2026-09-05', ...over,
  }),
];

const mainCalls = (): CleanCall[] => [
  ...campaignCalls('cmp_a', 10, 6, 100),
  ...campaignCalls('cmp_b', 10, 5, 50),
  ...campaignCalls('cmp_c', 8, 8, 100),
  ...campaignCalls('cmp_d', 4, 4, 100),
];

const store = (calls: CleanCall[], withAttribution = true) =>
  makeStore(withAttribution ? [...calls, ...unattributedCalls()] : calls, { campaigns, locations });

describe('buildCampaigns', () => {
  it('rows are every campaign, ranked by calls, ties by id, whatever order the store lists them', () => {
    const scrambled = [campaigns[3]!, campaigns[2]!, campaigns[0]!, campaign('cmp_e', 'Epsilon', 'social', 5), campaigns[1]!];
    const view = buildCampaigns(makeStore(mainCalls(), { campaigns: scrambled, locations }), fourteen);
    expect(view.rows.map((r) => r.campaignId)).toEqual(['cmp_a', 'cmp_b', 'cmp_c', 'cmp_d', 'cmp_e']);
    expect(view.weekly!.campaignId).toBe('cmp_a');
    const last = view.rows[4]!;
    expect(last.calls).toBe(0);
    expect(last.bookingRate).toBeNull();
    expect(last.estimatedCostPerBookingUsd).toBeNull();
  });

  it('numbers', () => {
    const view = buildCampaigns(store(mainCalls()), fourteen);
    const alpha = view.rows[0]!;
    expect(alpha).toMatchObject({ calls: 10, bookings: 6, bookingRate: 0.6, revenueUsd: 600, estimatedSpendUsd: 140 });
    expect(alpha.estimatedCostPerBookingUsd).toBeCloseTo(23.33, 2);
    expect(alpha.revenuePerBudgetDollar).toBeCloseTo(4.2857, 4);
    const beta = view.rows[1]!;
    expect(beta.estimatedSpendUsd).toBe(280);
    expect(beta.estimatedCostPerBookingUsd).toBe(56);
  });

  it('spend uses the days in the range', () => {
    const view = buildCampaigns(store(mainCalls()), range('2026-09-05', '2026-09-05'));
    expect(view.rows[0]!.estimatedSpendUsd).toBe(10);
  });

  it('a zero budget has blank cost per booking and revenue per budget dollar, never infinity', () => {
    const view = buildCampaigns(store(mainCalls()), fourteen);
    const gamma = view.rows.find((r) => r.campaignId === 'cmp_c')!;
    expect(gamma.estimatedSpendUsd).toBe(0);
    expect(gamma.estimatedCostPerBookingUsd).toBeNull();
    expect(gamma.revenuePerBudgetDollar).toBeNull();
    expectAllFinite(view);
  });

  it('best and worst are marked among eligible campaigns only', () => {
    const view = buildCampaigns(store(mainCalls()), fourteen);
    const byId = Object.fromEntries(view.rows.map((r) => [r.campaignId, r]));
    expect(byId.cmp_a!.isBest).toBe(true);
    expect(byId.cmp_b!.isWorst).toBe(true);
    for (const id of ['cmp_c', 'cmp_d']) {
      expect(byId[id]!.isBest).toBe(false);
      expect(byId[id]!.isWorst).toBe(false);
    }
    expect(view.bestWorst).toEqual({ eligible: 2, reason: null });
  });

  it('the shift sentence quotes the ranking metric even when cost per booking disagrees', () => {
    const two = [campaign('cmp_a', 'Best', 'social', 10), campaign('cmp_b', 'Worst', 'display', 10)];
    const calls = [...campaignCalls('cmp_a', 5, 5, 1000), ...campaignCalls('cmp_b', 10, 10, 50)];
    const view = buildCampaigns(makeStore(calls, { campaigns: two, locations }), fourteen);
    expect(view.rows.find((r) => r.isBest)!.name).toBe('Best');
    expect(view.rows.find((r) => r.isWorst)!.name).toBe('Worst');
    expect(view.actions[0]!.text).toBe(
      'Shift budget from Worst (est. $3.57 revenue per budget dollar) toward Best (est. $35.71 revenue per budget dollar).',
    );
  });

  it('calls with a blank tracking number are counted on their own, never as 0 numbers', () => {
    const blank = (n: number) =>
      Array.from({ length: n }, () =>
        makeCall({ campaignId: null, unattributed: true, trackingNumber: '', revenueUsd: 0, booked: false, outcome: 'not_qualified', localDate: '2026-09-05' }),
      );
    const text = (calls: CleanCall[]) =>
      buildCampaigns(makeStore(calls, { campaigns, locations }), fourteen).actions.find((a) => a.kind === 'fix_attribution')!.text;
    expect(text(blank(2))).toBe(
      '2 calls (0 bookings, $0) came in on 2 with no tracking number not tied to any campaign. Assign each to a campaign.',
    );
    expect(text(blank(1))).toBe(
      '1 call (0 bookings, $0) came in on 1 with no tracking number not tied to any campaign. Assign each to a campaign.',
    );
    expect(text([...blank(1), ...unattributedCalls()])).toBe(
      '4 calls (2 bookings, $150) came in on 2 tracking numbers and 1 with no tracking number not tied to any campaign. Assign each to a campaign.',
    );
  });

  it('the shift action names both campaigns with their revenue per budget dollar', () => {
    const view = buildCampaigns(store(mainCalls(), false), fourteen);
    const action = view.actions[0]!;
    expect(action.text).toBe('Shift budget from Beta (est. $0.89 revenue per budget dollar) toward Alpha (est. $4.29 revenue per budget dollar).');
    expect(action.kind).toBe('shift_budget');
    expect(action.actionable).toBe(true);
    expect(action.link).toEqual({ view: 'campaigns' });
    expect(view.templateSentence).toBe(action.text);
    expect(view.view).toBe('campaigns');
    expect(view.factSheet.entities).toEqual(['Alpha', 'Beta']);
  });

  it('unattributed is its own row after the ranked ones, with blank spend columns', () => {
    const view = buildCampaigns(store(mainCalls()), fourteen);
    expect(view.unattributed).toMatchObject({
      campaignId: null, name: 'Unattributed', calls: 3, bookings: 2, revenueUsd: 150,
      estimatedSpendUsd: null, estimatedCostPerBookingUsd: null, revenuePerBudgetDollar: null,
      trackingNumbers: [
        { trackingNumber: '+1-555-0190', calls: 2 },
        { trackingNumber: '+1-555-0191', calls: 1 },
      ],
    });
    expect(view.rows.some((r) => r.campaignId === null)).toBe(false);
  });

  it('the attribution action follows the shift action', () => {
    const view = buildCampaigns(store(mainCalls()), fourteen);
    expect(view.actions.map((a) => a.kind)).toEqual(['shift_budget', 'fix_attribution']);
    expect(view.actions[1]!.text).toBe(
      '3 calls (2 bookings, $150) came in on 2 tracking numbers not tied to any campaign. Assign each to a campaign.',
    );
    expect(view.actions[1]!.link).toEqual({ view: 'campaigns' });
  });

  it('a single unattributed call reads in the singular', () => {
    const one = makeCall({ campaignId: null, unattributed: true, trackingNumber: '+1-555-0190', revenueUsd: 100, localDate: '2026-09-05' });
    const view = buildCampaigns(makeStore([one], { campaigns, locations }), fourteen);
    expect(view.actions.find((a) => a.kind === 'fix_attribution')!.text).toBe(
      '1 call (1 booking, $100) came in on 1 tracking number not tied to any campaign. Assign each to a campaign.',
    );
  });

  it('no unattributed calls in range means no attribution action', () => {
    const outside = unattributedCalls({ localDate: '2026-08-20' });
    const view = buildCampaigns(makeStore([...mainCalls(), ...outside], { campaigns, locations }), fourteen);
    expect(view.unattributed).toBeNull();
    expect(view.actions.some((a) => a.kind === 'fix_attribution')).toBe(false);
  });

  it('fewer than two eligible campaigns marks nothing and says why', () => {
    const calls = [
      ...campaignCalls('cmp_a', 10, 6, 100),
      ...campaignCalls('cmp_b', 10, 4, 50),
      ...campaignCalls('cmp_c', 8, 8, 100),
      ...campaignCalls('cmp_d', 4, 4, 100),
    ];
    const reason = 'Fewer than two campaigns have a daily budget and at least 5 bookings in this range.';

    const plain = buildCampaigns(makeStore(calls, { campaigns, locations }), fourteen);
    expect(plain.rows.some((r) => r.isBest || r.isWorst)).toBe(false);
    expect(plain.bestWorst).toEqual({ eligible: 1, reason });
    expect(plain.actions).toHaveLength(1);
    expect(plain.actions[0]!).toMatchObject({
      kind: 'no_budget_shift',
      actionable: false,
      text: 'No budget shift is suggested: fewer than two campaigns have a daily budget and at least 5 bookings in this range.',
    });

    const withAttribution = buildCampaigns(store(calls), fourteen);
    expect(withAttribution.actions[0]!.kind).toBe('fix_attribution');
    expect(withAttribution.bestWorst.reason).toBe(reason);
  });

  it('two eligible campaigns with equal value mark nothing', () => {
    // Alpha: 600 / 140. Beta at 20/day over 14 days spends 280, so it needs 1200 revenue: 5 bookings at 240.
    const calls = [...campaignCalls('cmp_a', 10, 6, 100), ...campaignCalls('cmp_b', 10, 5, 240)];
    const view = buildCampaigns(makeStore(calls, { campaigns, locations }), fourteen);
    expect(view.rows.some((r) => r.isBest || r.isWorst)).toBe(false);
    expect(view.actions).toHaveLength(1);
    expect(view.actions[0]!.kind).toBe('no_budget_shift');
    expect(view.actions[0]!.text).toBe(
      'No budget shift is suggested: the eligible campaigns earn the same revenue per budget dollar.',
    );
    expect(view.bestWorst).toEqual({ eligible: 2, reason: 'The eligible campaigns earn the same revenue per budget dollar.' });
  });

  it('the weekly chart defaults to the campaign with most calls', () => {
    // Delta calls on the first and last day make the data cover the whole range, so only the end weeks are partial.
    const edges = [
      ...campaignCalls('cmp_d', 1, 0, 0, { localDate: '2026-09-01' }),
      ...campaignCalls('cmp_d', 1, 0, 0, { localDate: '2026-09-14' }),
    ];
    const s = store([...mainCalls(), ...edges]);
    const view = buildCampaigns(s, fourteen);
    expect(view.weekly!.campaignId).toBe('cmp_a');
    expect(view.weekly!.name).toBe('Alpha');
    expect(view.weekly!.weeks).toHaveLength(3);
    expect(view.weekly!.weeks.map((w) => w.partial)).toEqual([true, false, true]);

    const beta = buildCampaigns(s, fourteen, undefined, { campaignId: 'cmp_b' });
    expect(beta.weekly!.campaignId).toBe('cmp_b');
    expect(beta.weekly!.weeks.reduce((sum, w) => sum + w.calls, 0)).toBe(10);

    expect(buildCampaigns(s, fourteen, undefined, { campaignId: 'cmp_zzz' }).weekly).toBeNull();
  });

  it('an empty range builds', () => {
    const view = buildCampaigns(store(mainCalls()), range('2026-10-01', '2026-10-07'));
    expect(view.rows.every((r) => r.calls === 0)).toBe(true);
    expect(view.unattributed).toBeNull();
    expect(view.weekly!.weeks.length).toBeGreaterThan(0);
    expect(view.weekly!.weeks.every((w) => w.calls === 0)).toBe(true);
    expect(view.actions.map((a) => a.kind)).toEqual(['no_budget_shift']);
    expectAllFinite(view);

    const nothing = buildCampaigns(makeStore([]), fourteen);
    expect(nothing.rows).toEqual([]);
    expect(nothing.weekly).toBeNull();
    expect(nothing.actions.map((a) => a.kind)).toEqual(['no_budget_shift']);
    expectAllFinite(nothing);
  });
});
