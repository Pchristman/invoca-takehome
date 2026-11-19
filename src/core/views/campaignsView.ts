import type { DateRange, ResolvedRange } from '../ranges';
import { costPerBooking, estimatedSpend, rate, revenuePerBudgetDollar, tally } from '../metrics';
import { pickBestWorst } from '../ranking';
import { THRESHOLDS } from '../thresholds';
import type { CallStore, Channel, CleanCall } from '../types';
import { callsPerWeek } from '../weeks';
import type { WeekBucket } from '../weeks';
import { makeAction, makeFactSheet } from './facts';
import type { Action, Facts } from './facts';
import { makeViewContext } from './viewContext';
import type { ViewBase } from './viewContext';

export interface CampaignRow {
  /** Unattributed: null id, name 'Unattributed', null channel. */
  campaignId: string | null;
  name: string;
  channel: Channel | null;
  calls: number;
  bookings: number;
  bookingRate: number | null;
  revenueUsd: number;
  /** null for Unattributed. */
  estimatedSpendUsd: number | null;
  /** null: zero budget, zero bookings, or Unattributed. */
  estimatedCostPerBookingUsd: number | null;
  revenuePerBudgetDollar: number | null;
  isBest: boolean;
  isWorst: boolean;
}

export interface UnattributedRow extends CampaignRow {
  /** Most calls first, ties by number. */
  trackingNumbers: { trackingNumber: string; calls: number }[];
}

export interface CampaignsView extends ViewBase {
  view: 'campaigns';
  /** Every store campaign, calls desc, ties by campaign id. */
  rows: CampaignRow[];
  /** null when no unattributed call is in range. */
  unattributed: UnattributedRow | null;
  /** `reason` is set only when nothing is marked. */
  bestWorst: { eligible: number; reason: string | null };
  weekly: { campaignId: string; name: string; weeks: WeekBucket[] } | null;
}

/** The weekly chart's campaign. */
export interface CampaignsOptions {
  campaignId?: string;
}

const SHIFT_TEMPLATE =
  'Shift budget from {shift.worst.name} (est. {shift.worst.cost_per_booking} per booking) toward {shift.best.name} (est. {shift.best.cost_per_booking} per booking).';
const ATTRIBUTION_TEMPLATE =
  '{attribution.calls} ({attribution.bookings}, {attribution.revenue}) came in on {attribution.numbers} not tied to any campaign. Assign each to a campaign.';
const FEW_ELIGIBLE_TEMPLATE =
  'No budget shift is suggested: fewer than two campaigns have a daily budget and at least {no_shift.min_bookings} in this range.';
const SAME_VALUE_TEMPLATE =
  'No budget shift is suggested: the eligible campaigns earn the same revenue per budget dollar.';

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const BOOKING = ['booking', 'bookings'] as const;

export function buildCampaigns(
  store: CallStore,
  range: ResolvedRange,
  previous?: DateRange,
  options: CampaignsOptions = {},
): CampaignsView {
  const context = makeViewContext(store, range, previous);

  // One row per store campaign, from that campaign's calls in range.
  const rows: CampaignRow[] = store.campaigns.map((c) => {
    const t = tally(context.current.filter((call) => call.campaignId === c.id));
    const spend = estimatedSpend(c.dailyBudgetUsd, range.days);
    return {
      campaignId: c.id,
      name: c.name,
      channel: c.channel,
      calls: t.calls,
      bookings: t.bookings,
      bookingRate: rate(t.bookings, t.calls),
      revenueUsd: t.revenueUsd,
      estimatedSpendUsd: spend,
      estimatedCostPerBookingUsd: costPerBooking(spend, t.bookings),
      revenuePerBudgetDollar: revenuePerBudgetDollar(t.revenueUsd, spend),
      isBest: false,
      isWorst: false,
    };
  });
  rows.sort((a, b) => b.calls - a.calls || byText(a.campaignId!, b.campaignId!));

  const picked = pickBestWorst(
    rows.map((r) => ({
      campaignId: r.campaignId!,
      bookings: r.bookings,
      estimatedSpendUsd: r.estimatedSpendUsd!,
      revenuePerBudgetDollar: r.revenuePerBudgetDollar,
    })),
  );
  const best = rows.find((r) => r.campaignId === picked.best?.campaignId);
  const worst = rows.find((r) => r.campaignId === picked.worst?.campaignId);
  if (best) best.isBest = true;
  if (worst) worst.isWorst = true;

  const unattributed = buildUnattributed(context.current);

  // Actions, in order. The "no shift" sentence is built whenever nothing is marked, because its text is the reason.
  let shift: Action | null = null;
  let noShift: Action | null = null;
  if (best && worst) {
    shift = makeAction(
      'shift_budget',
      SHIFT_TEMPLATE,
      {
        'shift.worst.name': { kind: 'name', value: worst.name },
        'shift.worst.cost_per_booking': { kind: 'usd', value: worst.estimatedCostPerBookingUsd! },
        'shift.best.name': { kind: 'name', value: best.name },
        'shift.best.cost_per_booking': { kind: 'usd', value: best.estimatedCostPerBookingUsd! },
      },
      { view: 'campaigns' },
    );
  } else if (picked.eligible < 2) {
    noShift = makeAction(
      'no_budget_shift',
      FEW_ELIGIBLE_TEMPLATE,
      { 'no_shift.min_bookings': { kind: 'count', value: THRESHOLDS.MIN_BOOKINGS_TO_RANK, noun: BOOKING } },
      { view: 'campaigns' },
    );
  } else {
    noShift = makeAction('no_budget_shift', SAME_VALUE_TEMPLATE, {}, { view: 'campaigns' });
  }

  let fixAttribution: Action | null = null;
  if (unattributed) {
    fixAttribution = makeAction(
      'fix_attribution',
      ATTRIBUTION_TEMPLATE,
      {
        'attribution.calls': { kind: 'count', value: unattributed.calls, noun: ['call', 'calls'] },
        'attribution.bookings': { kind: 'count', value: unattributed.bookings, noun: BOOKING },
        'attribution.numbers': {
          kind: 'count',
          value: unattributed.trackingNumbers.length,
          noun: ['tracking number', 'tracking numbers'],
        },
        'attribution.revenue': { kind: 'usd', value: unattributed.revenueUsd },
      },
      { view: 'campaigns' },
    );
  }

  const actions: Action[] = [];
  if (shift) actions.push(shift);
  if (fixAttribution) actions.push(fixAttribution);
  if (actions.length === 0) actions.push(noShift!); // never empty

  // The reason is the sentence after the colon, capitalised.
  let reason: string | null = null;
  if (noShift) {
    const afterColon = noShift.text.slice(noShift.text.indexOf(': ') + 2);
    reason = afterColon.charAt(0).toUpperCase() + afterColon.slice(1);
  }

  const facts: Facts = Object.assign({}, ...actions.map((a) => a.facts));

  // Weekly chart: the chosen campaign, else the one with the most calls.
  const chosen = options.campaignId === undefined ? rows[0] : rows.find((r) => r.campaignId === options.campaignId);
  const weekly = chosen
    ? {
        campaignId: chosen.campaignId!,
        name: chosen.name,
        weeks: callsPerWeek(
          store.calls.filter((call) => call.campaignId === chosen.campaignId),
          range,
          context.span,
        ),
      }
    : null;

  return {
    view: 'campaigns',
    range,
    notes: context.notes,
    actions,
    templateSentence: actions[0]!.text,
    factSheet: makeFactSheet('campaigns', facts),
    rows,
    unattributed,
    bestWorst: { eligible: picked.eligible, reason },
    weekly,
  };
}

/** The calls with no campaign, as one row; null when there are none. */
function buildUnattributed(calls: readonly CleanCall[]): UnattributedRow | null {
  const lost = calls.filter((call) => call.campaignId === null);
  if (lost.length === 0) return null;

  const t = tally(lost);
  const perNumber = new Map<string, number>();
  for (const call of lost) {
    if (call.trackingNumber === '') continue;
    perNumber.set(call.trackingNumber, (perNumber.get(call.trackingNumber) ?? 0) + 1);
  }
  const trackingNumbers = [...perNumber]
    .map(([trackingNumber, count]) => ({ trackingNumber, calls: count }))
    .sort((a, b) => b.calls - a.calls || byText(a.trackingNumber, b.trackingNumber));

  return {
    campaignId: null,
    name: 'Unattributed',
    channel: null,
    calls: t.calls,
    bookings: t.bookings,
    bookingRate: rate(t.bookings, t.calls),
    revenueUsd: t.revenueUsd,
    estimatedSpendUsd: null,
    estimatedCostPerBookingUsd: null,
    revenuePerBudgetDollar: null,
    isBest: false,
    isWorst: false,
    trackingNumbers,
  };
}
