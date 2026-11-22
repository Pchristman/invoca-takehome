import { toCents } from '../metrics';
import { buildMissedValueRates, estimateMissedCallValue } from '../missedValue';
import type { DateRange, ResolvedRange } from '../ranges';
import { THRESHOLDS } from '../thresholds';
import type { CallStore } from '../types';
import { buildCallbackList } from './callbacks';
import type { CallbackList } from './callbacks';
import { makeAction, makeFactSheet } from './facts';
import type { Action, ActionLink } from './facts';
import { makeViewContext } from './viewContext';
import type { ViewBase } from './viewContext';

export interface MissedCallsOptions {
  locationId?: string;
}

export interface MissedCallsView extends ViewBase {
  view: 'missed-calls';
  /** The office filter applied; null = all offices. An unknown id gives { locationId, name: null } and an empty view. */
  officeFilter: { locationId: string; name: string | null } | null;
  /** Unanswered calls in range (at the filtered office). */
  unansweredCalls: number;
  /** Same as callbacks.unidentifiedUnanswered. */
  unidentifiedUnanswered: number;
  heatmap: {
    /** hours: 24 entries, zero-filled. Every office with a valid time zone (only the filtered one with a filter). */
    byOffice: { locationId: string; name: string; hours: number[]; total: number }[];
    /** 7 rows, Monday first, zero-filled. */
    byWeekday: { weekday: number; hours: number[]; total: number }[];
  };
  lostValue: {
    /** Every unanswered call in range, each valued in whole cents. */
    estimatedUsd: number;
    /** How many calls each rate source valued. */
    bySource: { campaign: number; channel: number; overall: number };
    formula: string;
  };
  callbacks: CallbackList;
  /** The export carries only a hashed caller number (PLAN.md 4.4). */
  limitNote: string;
}

const CALLERS = ['caller', 'callers'] as const;
const CALLS = ['call', 'calls'] as const;
const zeroHours = (): number[] => Array.from({ length: 24 }, () => 0);

export function buildMissedCalls(
  store: CallStore,
  range: ResolvedRange,
  previous?: DateRange,
  options: MissedCallsOptions = {},
): MissedCallsView {
  const ctx = makeViewContext(store, range, previous);
  const filterId = options.locationId;
  const offices = filterId === undefined ? store.locations : store.locations.filter((l) => l.id === filterId);
  const missed = ctx.current.filter((c) => !c.answered && (filterId === undefined || c.locationId === filterId));

  // Heatmap: a row per office and per weekday, then fill from the calls (local weekday and hour).
  // An office with an invalid time zone has no good calls (they are bad rows in the data notes), so it gets no row.
  const byOffice = offices.filter((l) => l.timezoneValid).map((l) => ({ locationId: l.id, name: l.name, hours: zeroHours(), total: 0 }));
  const byWeekday = Array.from({ length: 7 }, (_, weekday) => ({ weekday, hours: zeroHours(), total: 0 }));
  for (const call of missed) {
    const officeRow = byOffice.find((r) => r.locationId === call.locationId);
    if (officeRow) addMiss(officeRow, call.localHour);
    const dayRow = byWeekday[call.localWeekday];
    if (dayRow) addMiss(dayRow, call.localHour);
  }

  // Lost value: rates from the whole export, so it does not move with the range.
  const rates = buildMissedValueRates(store.calls);
  const bySource = { campaign: 0, channel: 0, overall: 0 };
  let cents = 0;
  for (const call of missed) {
    const value = estimateMissedCallValue(rates, call);
    cents += toCents(value.valueUsd);
    bySource[value.source] += 1;
  }

  const callbacks = buildCallbackList(store, range, rates, options);
  const link: ActionLink = filterId === undefined ? { view: 'missed-calls' } : { view: 'missed-calls', locationId: filterId };
  const action = chooseAction(missed.length, callbacks, link);

  const min = THRESHOLDS.MIN_ANSWERED_FOR_RATE;
  return {
    view: 'missed-calls',
    range,
    notes: ctx.notes,
    actions: [action],
    templateSentence: action.text,
    factSheet: makeFactSheet('missed-calls', action.facts),
    officeFilter: filterId === undefined ? null : { locationId: filterId, name: offices[0]?.name ?? null },
    unansweredCalls: missed.length,
    unidentifiedUnanswered: callbacks.unidentifiedUnanswered,
    heatmap: { byOffice, byWeekday },
    lostValue: {
      estimatedUsd: cents / 100,
      bySource,
      formula:
        `Each missed call is valued at its campaign's booking rate times its average booking value. A campaign with fewer than ${min} answered calls with an outcome uses its channel's rates, ` +
        `and a channel with fewer than ${min} uses the overall rates. Unattributed calls use their channel's rates. ` +
        `Pending calls (answered, no outcome yet) are left out of the rates. Rates come from the whole export, not just this range. ` +
        `This is a model, not a measured loss: nobody knows what an unanswered caller would have booked. ` +
        `It likely overstates the loss: it counts every unanswered call, including repeat calls from one caller and callers who later got through.`,
    },
    callbacks,
    limitNote:
      'The export carries only a hash of the caller number, so callers are identified by that hash. A person who called from a different number cannot be matched. Use the tracking number and time to find the caller in your call platform.',
  };
}

function addMiss(row: { hours: number[]; total: number }, hour: number): void {
  row.hours[hour] = (row.hours[hour] ?? 0) + 1;
  row.total += 1;
}

function chooseAction(unanswered: number, callbacks: CallbackList, link: ActionLink): Action {
  if (unanswered === 0) {
    return makeAction('no_missed_calls', 'No calls went unanswered in this range.', {}, link);
  }
  if (callbacks.rows.length === 0 && callbacks.unidentifiedUnanswered > 0) {
    // Callers exist but the export has no caller hash for them, so there is nobody we can name.
    return makeAction(
      'no_callbacks',
      'No call-back list: {missed.unidentified} went unanswered without a caller number, so those callers cannot be identified.',
      { 'missed.unidentified': { kind: 'count', value: callbacks.unidentifiedUnanswered, noun: CALLS } },
      link,
    );
  }
  if (callbacks.rows.length === 0) {
    return makeAction('no_callbacks', 'There is no one to call back from this range.', {}, link);
  }
  return makeAction(
    'call_back',
    'Call back {callbacks.callers} whose latest call went unanswered.',
    { 'callbacks.callers': { kind: 'count', value: callbacks.rows.length, noun: CALLERS } },
    link,
  );
}
