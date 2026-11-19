import { toCents } from '../metrics';
import { buildMissedValueRates, estimateMissedCallValue } from '../missedValue';
import type { DateRange, ResolvedRange } from '../ranges';
import { THRESHOLDS } from '../thresholds';
import type { CallStore } from '../types';
import { buildCallbackList } from './callbacks';
import type { CallbackList } from './callbacks';
import { makeAction, makeFactSheet } from './facts';
import type { Action, ActionLink, Facts } from './facts';
import { busiestMissedSlot } from './missedSlots';
import type { MissedSlot } from './missedSlots';
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
    /** hours: 24 entries, zero-filled. Every office (only the filtered one with a filter). */
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
  /** Over the unanswered calls above. */
  busiestSlot: (MissedSlot & { officeName: string }) | null;
  /** The export carries only a hashed caller number (PLAN.md 4.4). */
  limitNote: string;
}

const CALLERS = ['caller', 'callers'] as const;
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
  const byOffice = offices.map((l) => ({ locationId: l.id, name: l.name, hours: zeroHours(), total: 0 }));
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
  const slot = busiestMissedSlot(missed);
  const slotOffice = slot ? store.locations.find((l) => l.id === slot.locationId)?.name ?? slot.locationId : null;
  const link: ActionLink = filterId === undefined ? { view: 'missed-calls' } : { view: 'missed-calls', locationId: filterId };
  const action = chooseAction(callbacks, slot, slotOffice, link);

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
        `and a channel with fewer than ${min} uses the overall rates. Rates come from the whole export, not just this range.`,
    },
    callbacks,
    busiestSlot: slot && slotOffice !== null ? { ...slot, officeName: slotOffice } : null,
    limitNote:
      'The export carries only a hash of the caller number, so callers are identified by that hash. A person who called from a different number cannot be matched.',
  };
}

function addMiss(row: { hours: number[]; total: number }, hour: number): void {
  row.hours[hour] = (row.hours[hour] ?? 0) + 1;
  row.total += 1;
}

function chooseAction(callbacks: CallbackList, slot: MissedSlot | null, slotOffice: string | null, link: ActionLink): Action {
  if (slot === null || slotOffice === null) {
    return makeAction('no_missed_calls', 'No calls went unanswered in this range.', {}, link);
  }
  const slotFacts: Facts = {
    'slot.office': { kind: 'name', value: slotOffice },
    'slot.weekday': { kind: 'weekday', value: slot.weekday },
    'slot.hour': { kind: 'hour', value: slot.hour },
  };
  if (callbacks.rows.length === 0) {
    return makeAction(
      'no_callbacks',
      'There is no one to call back from this range. Busiest missed slot: {slot.office} {slot.weekday} {slot.hour}.',
      slotFacts,
      link,
    );
  }
  return makeAction(
    'call_back',
    'Call back {callbacks.callers} who never got through (est. {callbacks.value} in bookings). Busiest missed slot: {slot.office} {slot.weekday} {slot.hour}.',
    {
      'callbacks.callers': { kind: 'count', value: callbacks.rows.length, noun: CALLERS },
      'callbacks.value': { kind: 'usd', value: callbacks.totalValueUsd },
      ...slotFacts,
    },
    link,
  );
}
