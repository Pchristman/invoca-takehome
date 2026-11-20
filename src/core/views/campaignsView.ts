import type { DateRange, ResolvedRange } from '../ranges';
import { countAlert } from '../alerts';
import { changeInCount, costPerBooking, estimatedSpend, rate, revenuePerBudgetDollar, tally } from '../metrics';
import type { Change } from '../metrics';
import { pickBestWorst } from '../ranking';
import { THRESHOLDS } from '../thresholds';
import type { CallStore, Channel, CleanCall } from '../types';
import { callsPerWeek } from '../weeks';
import type { WeekBucket } from '../weeks';
import { alertAction, byText } from './campaignAlerts';
import type { FlaggedCampaign } from './campaignAlerts';
import { fillPlaceholders, makeAction, makeFactSheet } from './facts';
import type { Action, Facts } from './facts';
import { makeViewContext } from './viewContext';
import type { ViewBase } from './viewContext';

export interface CampaignAlert {
  direction: 'jump' | 'drop';
  z: number;
}

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
  /** Calls in the previous period; null when there is no comparison. */
  previousCalls: number | null;
  callsChange: Change;
  /** Set only when calls changed by more than chance explains. Never set for Unattributed. */
  alert: CampaignAlert | null;
}

export interface UnattributedRow extends CampaignRow {
  /** Most calls first, ties by number. */
  trackingNumbers: { trackingNumber: string; calls: number }[];
}

export interface CampaignsView extends ViewBase {
  view: 'campaigns';
  /** Every store campaign, calls desc, ties by campaign id. */
  rows: CampaignRow[];
  /** null when no unattributed call is in range or in the previous period; a row of 0 calls shows a drop to none. */
  unattributed: UnattributedRow | null;
  /** `reason` is set only when nothing is marked. */
  bestWorst: { eligible: number; reason: string | null };
  weekly: { campaignId: string; name: string; weeks: WeekBucket[] } | null;
  /** `checked` is false when there is no like-for-like comparison; `reason` says why. */
  alerts: { checked: boolean; reason: string | null; flagged: number; z: number; minCalls: number };
}

/** The weekly chart's campaign. */
export interface CampaignsOptions {
  campaignId?: string;
}

const SHIFT_TEMPLATE =
  'Shift budget from {shift.worst.name} (est. {shift.worst.value} revenue per budget dollar) toward {shift.best.name} (est. {shift.best.value} revenue per budget dollar).';
const ATTRIBUTION_START = '{attribution.calls} ({attribution.bookings}, {attribution.revenue}) came in on ';
const ATTRIBUTION_END = ' not tied to any campaign. Assign each to a campaign.';
const FEW_ELIGIBLE_REASON =
  'fewer than two campaigns have a daily budget and at least {no_shift.min_bookings} in this range.';
const SAME_VALUE_REASON = 'the eligible campaigns earn the same revenue per budget dollar.';
const NO_SHIFT_PREFIX = 'No budget shift is suggested: ';

const BOOKING = ['booking', 'bookings'] as const;
const BLANK_NUMBER = ['with no tracking number', 'with no tracking number'] as const;

const OVERLAP_REASON = 'The comparison period overlaps the selected range, so changes are not tested.';
const NOT_TESTED = { flagged: false, direction: null, z: null } as const;

/** Calls with this campaign id (null: no campaign); null when there is no previous period. */
function countIn(calls: readonly CleanCall[] | null, campaignId: string | null): number | null {
  return calls === null ? null : calls.filter((call) => call.campaignId === campaignId).length;
}

export function buildCampaigns(
  store: CallStore,
  range: ResolvedRange,
  previous?: DateRange,
  options: CampaignsOptions = {},
): CampaignsView {
  const context = makeViewContext(store, range, previous);
  // The z-test assumes independent periods; a comparison that shares days with the range is shown, not tested.
  const overlaps = context.notes.comparison.overlaps;

  // One row per store campaign, from that campaign's calls in range.
  const rows: CampaignRow[] = store.campaigns.map((c) => {
    const t = tally(context.current.filter((call) => call.campaignId === c.id));
    const spend = estimatedSpend(c.dailyBudgetUsd, range.days);
    const previousCalls = countIn(context.previous, c.id);
    // Both periods have equal length here: context.previous exists only for a like-for-like comparison.
    const test = previousCalls === null || overlaps ? NOT_TESTED : countAlert(t.calls, previousCalls);
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
      previousCalls,
      callsChange: previousCalls === null ? { kind: 'none' } : changeInCount(t.calls, previousCalls),
      alert: test.direction !== null && test.z !== null ? { direction: test.direction, z: test.z } : null,
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

  const unattributed = buildUnattributed(context.current, countIn(context.previous, null));

  // Actions, in order. The "no shift" sentence is built whenever nothing is marked, because its text is the reason.
  let shift: Action | null = null;
  let noShift: Action | null = null;
  let noShiftReason: string | null = null;
  if (best && worst) {
    shift = makeAction(
      'shift_budget',
      SHIFT_TEMPLATE,
      {
        'shift.worst.name': { kind: 'name', value: worst.name },
        'shift.worst.value': { kind: 'usd_per_dollar', value: worst.revenuePerBudgetDollar! },
        'shift.best.name': { kind: 'name', value: best.name },
        'shift.best.value': { kind: 'usd_per_dollar', value: best.revenuePerBudgetDollar! },
      },
      { view: 'campaigns' },
    );
  } else if (picked.eligible < 2) {
    noShiftReason = FEW_ELIGIBLE_REASON;
    noShift = makeAction(
      'no_budget_shift',
      NO_SHIFT_PREFIX + FEW_ELIGIBLE_REASON,
      { 'no_shift.min_bookings': { kind: 'count', value: THRESHOLDS.MIN_BOOKINGS_TO_RANK, noun: BOOKING } },
      { view: 'campaigns' },
    );
  } else {
    noShiftReason = SAME_VALUE_REASON;
    noShift = makeAction('no_budget_shift', NO_SHIFT_PREFIX + SAME_VALUE_REASON, {}, { view: 'campaigns' });
  }

  let fixAttribution: Action | null = null;
  if (unattributed && unattributed.calls > 0) {
    // Calls with a blank tracking number are their own clause, so the count of numbers never reads as 0.
    const named = unattributed.trackingNumbers.length;
    const blank = unattributed.calls - unattributed.trackingNumbers.reduce((sum, n) => sum + n.calls, 0);
    const clauses = [
      ...(named > 0 || blank === 0 ? ['{attribution.numbers}'] : []),
      ...(blank > 0 ? ['{attribution.blank}'] : []),
    ];
    const facts: Facts = {};
    if (named > 0 || blank === 0) {
      facts['attribution.numbers'] = { kind: 'count', value: named, noun: ['tracking number', 'tracking numbers'] };
    }
    if (blank > 0) facts['attribution.blank'] = { kind: 'count', value: blank, noun: BLANK_NUMBER };
    fixAttribution = makeAction(
      'fix_attribution',
      ATTRIBUTION_START + clauses.join(' and ') + ATTRIBUTION_END,
      {
        ...facts,
        'attribution.calls': { kind: 'count', value: unattributed.calls, noun: ['call', 'calls'] },
        'attribution.bookings': { kind: 'count', value: unattributed.bookings, noun: BOOKING },
        'attribution.revenue': { kind: 'usd', value: unattributed.revenueUsd },
      },
      { view: 'campaigns' },
    );
  }

  const flagged: FlaggedCampaign[] = rows.flatMap((r) =>
    r.alert && r.campaignId !== null && r.previousCalls !== null
      ? [{ campaignId: r.campaignId, name: r.name, direction: r.alert.direction, z: r.alert.z, current: r.calls, previous: r.previousCalls }]
      : [],
  );
  const callChanges = alertAction(flagged);

  const actions: Action[] = [];
  if (shift) actions.push(shift);
  if (fixAttribution) actions.push(fixAttribution);
  if (callChanges) actions.push(callChanges);
  if (actions.length === 0) actions.push(noShift!); // never empty

  // The reason is the same constant the sentence is built from, capitalised.
  let reason: string | null = null;
  if (noShift && noShiftReason) {
    const filled = fillPlaceholders(noShiftReason, noShift.facts);
    reason = filled.charAt(0).toUpperCase() + filled.slice(1);
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
    alerts: {
      checked: context.notes.comparison.available && !overlaps,
      reason: !context.notes.comparison.available
        ? context.notes.comparison.reason
        : overlaps
          ? OVERLAP_REASON
          : null,
      flagged: flagged.length,
      z: THRESHOLDS.ALERT_Z,
      minCalls: THRESHOLDS.MIN_CALLS_ALERT,
    },
  };
}

/** The calls with no campaign, as one row; null when there are none now or in the previous period. */
function buildUnattributed(calls: readonly CleanCall[], previousCalls: number | null): UnattributedRow | null {
  const lost = calls.filter((call) => call.campaignId === null);
  if (lost.length === 0 && !previousCalls) return null; // nothing now and nothing before: no row

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
    previousCalls,
    callsChange: previousCalls === null ? { kind: 'none' } : changeInCount(t.calls, previousCalls),
    alert: null, // a bucket, not a campaign: "Fix attribution" already covers it
    trackingNumbers,
  };
}
