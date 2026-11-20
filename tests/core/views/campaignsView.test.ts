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

  it('a custom previous range of another length', () => {
    const calls = [...on('cmp_a', 60, NOW), ...on('cmp_a', 30, BEFORE), ...anchors()];
    const view = buildCampaigns(
      makeStore(calls, { campaigns: [noBudget('cmp_a'), noBudget('cmp_z')], locations }),
      now,
      range('2026-09-05', '2026-09-07'),
    );
    expect(view.alerts.checked).toBe(false);
    expect(view.alerts.reason).toMatch(/^No like-for-like comparison/);
    expect(row(view, 'cmp_a').alert).toBeNull();
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

  it('store order does not change the answer', () => {
    const calls = [
      ...on('cmp_a', 60, NOW), ...on('cmp_a', 30, BEFORE),
      ...on('cmp_b', 60, NOW), ...on('cmp_b', 30, BEFORE),
    ];
    const x = build(calls, [noBudget('cmp_a', 'Alpha'), noBudget('cmp_b', 'Beta'), noBudget('cmp_z')]);
    const y = build(calls, [noBudget('cmp_z'), noBudget('cmp_b', 'Beta'), noBudget('cmp_a', 'Alpha')]);
    expect(x.actions[0]!.text).toBe(y.actions[0]!.text);
    expect(x.actions[0]!.text).toContain('Alpha moved most');
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
