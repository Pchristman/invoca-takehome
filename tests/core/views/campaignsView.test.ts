import { describe, expect, it } from 'vitest';
import { buildCampaigns } from '../../../src/core/views/campaignsView';
import { buildOverview } from '../../../src/core/views/overviewView';
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

  it('a campaign with no budget counts its calls and revenue, has every budget column blank, and is never ranked', () => {
    // Alpha alone would be best against Beta; with no budget it must drop out, leaving too few to rank.
    const two = [campaign('cmp_a', 'Alpha', 'social', null), campaign('cmp_b', 'Beta', 'display', 20)];
    const calls = [...campaignCalls('cmp_a', 10, 6, 100), ...campaignCalls('cmp_b', 10, 5, 50)];
    const view = buildCampaigns(makeStore(calls, { campaigns: two, locations }), fourteen);
    const alpha = view.rows.find((r) => r.campaignId === 'cmp_a')!;
    expect(alpha).toMatchObject({ calls: 10, bookings: 6, revenueUsd: 600 });
    expect(alpha.estimatedSpendUsd).toBeNull();
    expect(alpha.estimatedCostPerBookingUsd).toBeNull();
    expect(alpha.revenuePerBudgetDollar).toBeNull();
    expect(view.rows.some((r) => r.isBest || r.isWorst)).toBe(false);
    expect(view.bestWorst).toMatchObject({ eligibleBest: 1, eligibleWorst: 1 });
    expect(view.actions[0]!.kind).toBe('no_budget_shift');
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
    expect(view.bestWorst).toEqual({ eligibleBest: 2, eligibleWorst: 2, reason: null });
  });

  it('the shift sentence quotes the ranking metric even when cost per booking disagrees', () => {
    const two = [campaign('cmp_a', 'Best', 'social', 10), campaign('cmp_b', 'Worst', 'display', 10)];
    const calls = [...campaignCalls('cmp_a', 5, 5, 1000), ...campaignCalls('cmp_b', 10, 10, 50)];
    const view = buildCampaigns(makeStore(calls, { campaigns: two, locations }), fourteen);
    expect(view.rows.find((r) => r.isBest)!.name).toBe('Best');
    expect(view.rows.find((r) => r.isWorst)!.name).toBe('Worst');
    expect(view.actions[0]!.text).toBe(
      'Consider moving budget from Worst (est. $3.57 revenue per budget dollar) toward Best (est. $35.71 revenue per budget dollar). Returns at a higher budget are unknown.',
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
      '2 calls (0 bookings, $0) came in on 2 with no tracking number not tied to any campaign.',
    );
    expect(text(blank(1))).toBe(
      '1 call (0 bookings, $0) came in on 1 with no tracking number not tied to any campaign.',
    );
    expect(text([...blank(1), ...unattributedCalls()])).toBe(
      '4 calls (2 bookings, $150) came in on 2 tracking numbers and 1 with no tracking number not tied to any campaign.',
    );
  });

  it('the shift action names both campaigns with their revenue per budget dollar', () => {
    const view = buildCampaigns(store(mainCalls(), false), fourteen);
    const action = view.actions[0]!;
    expect(action.text).toBe('Consider moving budget from Beta (est. $0.89 revenue per budget dollar) toward Alpha (est. $4.29 revenue per budget dollar). Returns at a higher budget are unknown.');
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
      '3 calls (2 bookings, $150) came in on 2 tracking numbers not tied to any campaign.',
    );
    expect(view.actions[1]!.link).toEqual({ view: 'campaigns' });
  });

  it('a single unattributed call reads in the singular', () => {
    const one = makeCall({ campaignId: null, unattributed: true, trackingNumber: '+1-555-0190', revenueUsd: 100, localDate: '2026-09-05' });
    const view = buildCampaigns(makeStore([one], { campaigns, locations }), fourteen);
    expect(view.actions.find((a) => a.kind === 'fix_attribution')!.text).toBe(
      '1 call (1 booking, $100) came in on 1 tracking number not tied to any campaign.',
    );
  });

  it('no unattributed calls in range means no attribution action', () => {
    const outside = unattributedCalls({ localDate: '2026-08-20' });
    const view = buildCampaigns(makeStore([...mainCalls(), ...outside], { campaigns, locations }), fourteen);
    expect(view.unattributed).toBeNull();
    expect(view.actions.some((a) => a.kind === 'fix_attribution')).toBe(false);
  });

  it('no pair of campaigns marks nothing and says why', () => {
    // Beta has the calls to be judged but Alpha, the only best candidate, is the only other; Beta with 9 calls is not judged.
    const calls = [
      ...campaignCalls('cmp_a', 10, 6, 100),
      ...campaignCalls('cmp_b', 9, 4, 50),
      ...campaignCalls('cmp_c', 8, 8, 100),
      ...campaignCalls('cmp_d', 4, 4, 100),
    ];
    const reason =
      'No two different campaigns qualify: highest needs a daily budget and at least 5 bookings, lowest a daily budget and at least 10 calls in this range.';

    const plain = buildCampaigns(makeStore(calls, { campaigns, locations }), fourteen);
    expect(plain.rows.some((r) => r.isBest || r.isWorst)).toBe(false);
    expect(plain.bestWorst).toEqual({ eligibleBest: 1, eligibleWorst: 1, reason });
    expect(plain.actions).toHaveLength(1);
    expect(plain.actions[0]!).toMatchObject({
      kind: 'no_budget_shift',
      actionable: false,
      text:
        'No budget shift is suggested: no two different campaigns qualify: highest needs a daily budget and at least 5 bookings, lowest a daily budget and at least 10 calls in this range.',
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
    const reason =
      'no campaign with a daily budget and at least 10 calls earns less per budget dollar than the highest of those with at least 5 bookings in this range.';
    expect(view.actions[0]!.text).toBe(`No budget shift is suggested: ${reason}`);
    expect(view.bestWorst).toEqual({ eligibleBest: 2, eligibleWorst: 2, reason: reason.charAt(0).toUpperCase() + reason.slice(1) });
  });

  it('a budgeted campaign with enough calls but few bookings is worst, even below one with more bookings', () => {
    // The reported case. Alpha: 40 calls, 6 bookings, 600 / 140 = $4.29. Beta: 12 calls, 1 booking, 50 / 280 = $0.18.
    // Delta: 5 bookings, 2000 / 70 = $28.57, best. Beta has too few bookings to be best but enough calls to be judged.
    const calls = [...campaignCalls('cmp_a', 40, 6, 100), ...campaignCalls('cmp_b', 12, 1, 50), ...campaignCalls('cmp_d', 5, 5, 400)];
    const view = buildCampaigns(makeStore(calls, { campaigns, locations }), fourteen);
    expect(view.rows.find((r) => r.isBest)!.name).toBe('Delta');
    expect(view.rows.find((r) => r.isWorst)!.name).toBe('Beta');
    expect(view.bestWorst).toEqual({ eligibleBest: 2, eligibleWorst: 2, reason: null });
  });

  it('a campaign with no bookings can be worst, and the sentence quotes $0.00', () => {
    const calls = [...campaignCalls('cmp_a', 10, 6, 100), ...campaignCalls('cmp_b', 10, 0, 0)];
    const view = buildCampaigns(makeStore(calls, { campaigns, locations }), fourteen);
    expect(view.rows.find((r) => r.isWorst)!.name).toBe('Beta');
    expect(view.actions[0]!.text).toBe(
      'Consider moving budget from Beta (est. $0.00 revenue per budget dollar) toward Alpha (est. $4.29 revenue per budget dollar). Returns at a higher budget are unknown.',
    );
    expect(view.factSheet.facts['shift.worst.value']).toMatchObject({ value: 0 });
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

describe('buildCampaigns alerts', () => {
  const now = range('2026-09-08', '2026-09-14');
  const before = range('2026-09-01', '2026-09-07');
  const NOW = '2026-09-10';
  const BEFORE = '2026-09-03';
  const noBudget = (id: string, name = id) => campaign(id, name, 'social', 0);
  const on = (id: string, n: number, localDate: string) => campaignCalls(id, n, 0, 0, { localDate });
  const anchors = () => [...on('cmp_z', 1, '2026-09-01'), ...on('cmp_z', 1, '2026-09-14')];
  const build = (calls: CleanCall[], cs = [noBudget('cmp_a'), noBudget('cmp_b'), noBudget('cmp_c'), noBudget('cmp_z')]) =>
    buildCampaigns(makeStore([...calls, ...anchors()], { campaigns: cs, locations }), now, before);
  const row = (view: ReturnType<typeof build>, id: string) => view.rows.find((r) => r.campaignId === id)!;

  it('flags a jump and a drop and leaves the rest alone', () => {
    const view = build([
      ...on('cmp_a', 60, NOW), ...on('cmp_a', 30, BEFORE),
      ...on('cmp_b', 20, NOW), ...on('cmp_b', 60, BEFORE),
      ...on('cmp_c', 50, NOW), ...on('cmp_c', 50, BEFORE),
    ]);
    const a = row(view, 'cmp_a');
    expect(a.alert!.direction).toBe('jump');
    expect(a.alert!.z).toBeCloseTo(3.162, 3);
    expect(row(view, 'cmp_b').alert!.direction).toBe('drop');
    expect(row(view, 'cmp_c').alert).toBeNull();
    expect(a.previousCalls).toBe(30);
    expect(a.callsChange).toEqual({ kind: 'percent', value: 100 });
    const bChange = row(view, 'cmp_b').callsChange as { value: number };
    expect(bChange.value).toBeCloseTo(-66.67, 2);
    expect(view.alerts).toEqual({ checked: true, reason: null, flagged: 2, z: 3, minCalls: 20 });
  });

  it('no change', () => {
    const view = build([...on('cmp_a', 50, NOW), ...on('cmp_a', 50, BEFORE)]);
    expect(view.rows.every((r) => r.alert === null)).toBe(true);
    expect(view.alerts.flagged).toBe(0);
    expect(view.actions.some((a) => a.kind === 'review_call_changes')).toBe(false);
  });

  it('too small to test', () => {
    const view = build([...on('cmp_a', 10, NOW)]);
    const a = row(view, 'cmp_a');
    expect(a.previousCalls).toBe(0);
    expect(a.callsChange).toEqual({ kind: 'new' });
    expect(a.alert).toBeNull();
  });

  it('zero in one period', () => {
    const view = build([...on('cmp_a', 25, BEFORE), ...on('cmp_b', 25, NOW)]);
    const a = row(view, 'cmp_a');
    expect(a.alert!.direction).toBe('drop');
    expect(a.callsChange).toEqual({ kind: 'percent', value: -100 });
    const b = row(view, 'cmp_b');
    expect(b.alert!.direction).toBe('jump');
    expect(b.callsChange).toEqual({ kind: 'new' });
    expectAllFinite(view);
  });

  it('all-data range has no comparison', () => {
    const all = range('2026-09-01', '2026-09-14');
    const calls = [...on('cmp_a', 60, NOW), ...on('cmp_a', 30, BEFORE), ...anchors()];
    const view = buildCampaigns(makeStore(calls, { campaigns: [noBudget('cmp_a'), noBudget('cmp_z')], locations }), all);
    expect(view.alerts.checked).toBe(false);
    expect(view.alerts.reason).toMatch(/^No full previous period/);
    expect(view.alerts.flagged).toBe(0);
    for (const r of view.rows) {
      expect(r.alert).toBeNull();
      expect(r.previousCalls).toBeNull();
      expect(r.callsChange).toEqual({ kind: 'none' });
    }
    expect(view.actions.some((a) => a.kind === 'review_call_changes')).toBe(false);
  });

  describe('a second range of another length', () => {
    const three = range('2026-09-01', '2026-09-03');
    const THREE_DAYS = '2026-09-02';
    const withThree = (calls: CleanCall[], second = three) =>
      buildCampaigns(
        makeStore([...calls, ...anchors()], { campaigns: [noBudget('cmp_a'), noBudget('cmp_z')], locations }),
        now,
        second,
      );
    const PER_DAY_REASON = 'Call-change alerts need two periods of the same length; these are 7 and 3 days.';

    it('compares per day, not totals', () => {
      const view = withThree([...on('cmp_a', 14, NOW), ...on('cmp_a', 3, THREE_DAYS)]);
      const a = row(view, 'cmp_a');
      expect(a.previousCalls).toBe(3);
      // 14 over 7 days is 2 a day; 3 over 3 days is 1 a day. Totals would say +367%.
      expect(a.callsChange).toEqual({ kind: 'percent', value: 100 });
    });

    it('withholds alerts, because they need equal exposure', () => {
      const view = withThree([...on('cmp_a', 60, NOW), ...on('cmp_a', 30, THREE_DAYS)]);
      expect(view.alerts).toEqual({ checked: false, reason: PER_DAY_REASON, flagged: 0, z: 3, minCalls: 20 });
      expect(view.rows.every((r) => r.alert === null)).toBe(true);
      expect(view.actions.some((a) => a.kind === 'review_call_changes')).toBe(false);
      expect(row(view, 'cmp_a').callsChange.kind).toBe('percent');
    });

    it('shows the per-day reason, not the overlap one, when it also overlaps', () => {
      const view = withThree([...on('cmp_a', 60, NOW)], range('2026-09-10', '2026-09-12'));
      expect(view.notes.comparison.overlaps).toBe(true);
      expect(view.alerts.checked).toBe(false);
      expect(view.alerts.reason).toBe('Call-change alerts need two periods of the same length; these are 7 and 3 days.');
    });

    it('compares unattributed calls per day and never alerts on them', () => {
      const lost = (n: number, localDate: string) =>
        many(n).map((c) => makeCall({ ...c, campaignId: null, unattributed: true, localDate }));
      const view = withThree([...lost(14, NOW), ...lost(3, THREE_DAYS)]);
      expect(view.unattributed!.previousCalls).toBe(3);
      expect(view.unattributed!.callsChange).toEqual({ kind: 'percent', value: 100 });
      expect(view.unattributed!.alert).toBeNull();
    });

    it('shows new, never infinity, when the comparison holds nothing', () => {
      const view = withThree([...on('cmp_a', 10, NOW)]);
      expect(row(view, 'cmp_a').callsChange).toEqual({ kind: 'new' });
      expectAllFinite(view);
    });

    it('outside the data has no previous calls and the coverage reason', () => {
      const view = withThree([...on('cmp_a', 10, NOW)], range('2026-08-01', '2026-08-03'));
      expect(view.rows.every((r) => r.previousCalls === null)).toBe(true);
      expect(view.alerts.checked).toBe(false);
      expect(view.alerts.reason).toMatch(/^No full previous period/);
    });
  });

  it('the selected range as the second range is overlap, changes read 0, no alerts', () => {
    const calls = [...on('cmp_a', 60, NOW), ...on('cmp_b', 25, NOW)];
    const view = buildCampaigns(
      makeStore([...calls, ...anchors()], { campaigns: [noBudget('cmp_a'), noBudget('cmp_b'), noBudget('cmp_z')], locations }),
      now,
      now,
    );
    expect(view.alerts.checked).toBe(false);
    expect(view.alerts.reason).toBe('The comparison period overlaps the selected range, so changes are not tested.');
    for (const id of ['cmp_a', 'cmp_b']) expect(row(view, id).callsChange).toEqual({ kind: 'percent', value: 0 });
    expect(view.rows.every((r) => r.alert === null)).toBe(true);
    expectAllFinite(view);
  });

  it('an overlapping comparison is not tested, because the periods are not independent', () => {
    const calls = [...on('cmp_a', 60, NOW), ...on('cmp_a', 30, BEFORE), ...anchors()];
    const overlapping = range('2026-09-05', '2026-09-11'); // same length as `now`, shares 09-08 to 09-11
    const view = buildCampaigns(
      makeStore(calls, { campaigns: [noBudget('cmp_a'), noBudget('cmp_z')], locations }),
      now,
      overlapping,
    );
    expect(view.notes.comparison.available).toBe(true);
    expect(view.notes.comparison.overlaps).toBe(true);
    expect(view.alerts.checked).toBe(false);
    expect(view.alerts.reason).toBe('The comparison period overlaps the selected range, so changes are not tested.');
    expect(view.alerts.flagged).toBe(0);
    expect(view.rows.every((r) => r.alert === null)).toBe(true);
    expect(view.actions.some((a) => a.kind === 'review_call_changes')).toBe(false);
    // The change column stays informational: the overlapping window holds the 60 calls on NOW.
    expect(row(view, 'cmp_a').previousCalls).toBe(60);
  });

  it('unattributed calls that stopped show a row of zero calls, down 100%, never flagged and with no fix action', () => {
    const lost = (n: number, localDate: string) =>
      many(n).map((c) => makeCall({ ...c, campaignId: null, unattributed: true, localDate }));
    const view = build([...on('cmp_a', 5, NOW), ...lost(30, BEFORE)]);
    expect(view.unattributed).toMatchObject({
      campaignId: null, name: 'Unattributed', calls: 0, bookings: 0, revenueUsd: 0, previousCalls: 30,
      callsChange: { kind: 'percent', value: -100 }, alert: null, trackingNumbers: [],
    });
    expect(view.actions.some((a) => a.kind === 'fix_attribution')).toBe(false);
    expect(view.alerts.flagged).toBe(0);
    expectAllFinite(view);
  });

  it('unattributed never alerts', () => {
    const lost = (n: number, localDate: string) =>
      many(n).map((c) => makeCall({ ...c, campaignId: null, unattributed: true, localDate }));
    const view = build([...lost(60, NOW), ...lost(10, BEFORE)]);
    expect(view.unattributed!.alert).toBeNull();
    expect(view.unattributed!.callsChange).toEqual({ kind: 'percent', value: 500 });
    expect(view.alerts.flagged).toBe(0);
  });

  it('every campaign dropped gives one alert sentence', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `cmp_${String(i).padStart(2, '0')}`);
    const cs = [...ids.map((id) => noBudget(id)), noBudget('cmp_z')];
    const calls = ids.flatMap((id) => [...on(id, 10, NOW), ...on(id, 40, BEFORE)]);
    const view = build(calls, cs);
    expect(view.alerts.flagged).toBe(12);
    const alerts = view.actions.filter((a) => a.kind === 'review_call_changes');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.text.startsWith('12 campaigns changed')).toBe(true);
    expect(view.factSheet.entities).toHaveLength(1);
    expect(view.actions[view.actions.length - 1]).toBe(alerts[0]);
  });

  it('the alert is the headline when nothing else is actionable', () => {
    const view = build([...on('cmp_a', 60, NOW), ...on('cmp_a', 30, BEFORE)]);
    expect(view.actions[0]!.kind).toBe('review_call_changes');
    expect(view.bestWorst.reason).not.toBeNull();
  });

  it('shift, attribution, then the alert', () => {
    const two = [campaign('cmp_a', 'Best', 'social', 10), campaign('cmp_b', 'Worst', 'display', 10), noBudget('cmp_z')];
    const calls = [
      ...campaignCalls('cmp_a', 5, 5, 1000, { localDate: NOW }),
      ...campaignCalls('cmp_b', 10, 10, 50, { localDate: NOW }),
      ...on('cmp_b', 60, BEFORE),
      ...unattributedCalls({ localDate: NOW }),
    ];
    const view = build(calls, two);
    expect(view.actions.map((a) => a.kind)).toEqual(['shift_budget', 'fix_attribution', 'review_call_changes']);
  });

  it('a name that looks like markup or a placeholder stays plain text', () => {
    const name = '{alert.count}<b>x</b>';
    const view = build(
      [...on('cmp_a', 60, NOW), ...on('cmp_a', 30, BEFORE)],
      [noBudget('cmp_a', name), noBudget('cmp_z')],
    );
    expect(view.actions[0]!.text).toContain(`Calls to ${name} jumped`);
    expect(view.actions[0]!.text).not.toContain('1 campaign');
  });
});

describe('buildCampaigns alerts with a second range that is not earlier', () => {
  const early = range('2026-09-01', '2026-09-07');
  const later = { start: '2026-09-08', end: '2026-09-14' };
  const noBudget = (id: string) => campaign(id, id, 'social', 0);
  const on = (id: string, n: number, localDate: string) => campaignCalls(id, n, 0, 0, { localDate });
  const LATER_REASON = 'Call-change alerts need the comparison period to come before the selected range.';
  const build = (calls: CleanCall[], current: ReturnType<typeof range>, second: { start: string; end: string }) =>
    buildCampaigns(
      makeStore([...calls, ...on('cmp_z', 1, '2026-09-01'), ...on('cmp_z', 1, '2026-09-14')], {
        campaigns: [noBudget('cmp_a'), noBudget('cmp_z')],
        locations,
      }),
      current,
      second,
    );

  it('a later equal-length range is not tested: its planted jump gives no alert', () => {
    // Selected 09-01..09-07 has 30 calls; the later second range has 60. Tested, that would read as a drop.
    const view = build([...on('cmp_a', 30, '2026-09-03'), ...on('cmp_a', 60, '2026-09-10')], early, later);
    expect(view.notes.comparison.available).toBe(true);
    expect(view.notes.comparison.overlaps).toBe(false);
    expect(view.notes.comparison.perDay).toBe(false);
    expect(view.alerts).toEqual({ checked: false, reason: LATER_REASON, flagged: 0, z: 3, minCalls: 20 });
    expect(view.rows.every((r) => r.alert === null)).toBe(true);
    expect(view.actions.some((a) => a.kind === 'review_call_changes')).toBe(false);
    expect(view.rows.find((r) => r.campaignId === 'cmp_a')!.callsChange).toEqual({ kind: 'percent', value: -50 });
  });

  it('the Overview does not list a call-change action either', () => {
    const calls = [...on('cmp_a', 30, '2026-09-03'), ...on('cmp_a', 60, '2026-09-10'), ...on('cmp_z', 1, '2026-09-01'), ...on('cmp_z', 1, '2026-09-14')];
    const view = buildOverview(makeStore(calls, { campaigns: [noBudget('cmp_a'), noBudget('cmp_z')], locations }), early, later);
    expect(view.topActions.some((t) => t.action.kind === 'review_call_changes')).toBe(false);
  });

  it('an earlier equal-length range still raises the alert', () => {
    const view = build([...on('cmp_a', 60, '2026-09-10'), ...on('cmp_a', 30, '2026-09-03')], range('2026-09-08', '2026-09-14'), early);
    expect(view.alerts).toMatchObject({ checked: true, reason: null, flagged: 1 });
    expect(view.actions.some((a) => a.kind === 'review_call_changes')).toBe(true);
  });
});
