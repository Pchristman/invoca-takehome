import { changeInCountPerDay, changeInRate, rate, tally } from '../metrics';
import type { Change } from '../metrics';
import type { DateRange, ResolvedRange } from '../ranges';
import type { CallStore } from '../types';
import { buildCampaigns } from './campaignsView';
import { makeFactSheet } from './facts';
import type { Action, Facts, ViewName } from './facts';
import { buildLocations } from './locationsView';
import { buildMissedCalls } from './missedCallsView';
import { makeViewContext } from './viewContext';
import type { ViewBase } from './viewContext';

/**
 * previous is null and change is none when there is no comparison.
 * current and previous are totals; change is per day when notes.comparison.perDay.
 */
export interface Tile {
  current: number | null;
  previous: number | null;
  change: Change;
}

export interface OverviewView extends ViewBase {
  view: 'overview';
  /** answerRate is a fraction, null with no calls. */
  tiles: { calls: Tile; uniqueCallers: Tile; answerRate: Tile; bookings: Tile; revenueUsd: Tile };
  /**
   * Campaigns, Locations, Missed calls, in that order: each view's first action.
   * When Campaigns has a call-change alert that is not already its first action, it is
   * listed (as Campaigns) right after the Campaigns entry, so there can be four entries.
   */
  topActions: { view: ViewName; action: Action }[];
}

const CALLS = ['call', 'calls'] as const;
const CALLERS = ['caller', 'callers'] as const;
const BOOKINGS = ['booking', 'bookings'] as const;

export function buildOverview(store: CallStore, range: ResolvedRange, previous?: DateRange): OverviewView {
  const ctx = makeViewContext(store, range, previous);
  const now = tally(ctx.current);
  const before = ctx.previous ? tally(ctx.previous) : null; // null unless the comparison is available

  const { perDay, currentDays, previousDays } = ctx.notes.comparison;
  // Totals stay totals; only the change is per day, and equal lengths give the plain change.
  const countTile = (current: number, prior: number | undefined): Tile =>
    prior === undefined || previousDays === null
      ? { current, previous: null, change: { kind: 'none' } }
      : { current, previous: prior, change: changeInCountPerDay(current, currentDays, prior, previousDays) };

  const currentAnswerRate = rate(now.answered, now.calls);
  const previousAnswerRate = before ? rate(before.answered, before.calls) : null;
  const tiles: OverviewView['tiles'] = {
    calls: countTile(now.calls, before?.calls),
    // Distinct callers do not grow with days, so they are not compared across lengths (S2 gap 2).
    uniqueCallers: perDay
      ? { current: now.uniqueCallers, previous: null, change: { kind: 'none' } }
      : countTile(now.uniqueCallers, before?.uniqueCallers),
    answerRate: before
      ? { current: currentAnswerRate, previous: previousAnswerRate, change: changeInRate(currentAnswerRate, previousAnswerRate) }
      : { current: currentAnswerRate, previous: null, change: { kind: 'none' } },
    bookings: countTile(now.bookings, before?.bookings),
    revenueUsd: countTile(now.revenueUsd, before?.revenueUsd),
  };

  const campaigns = buildCampaigns(store, range, previous);
  const campaignsFirst = firstAction(campaigns);
  const callChanges = campaigns.actions.find((a) => a.kind === 'review_call_changes');
  const topActions: OverviewView['topActions'] = [
    { view: 'campaigns', action: campaignsFirst },
    ...(callChanges && callChanges !== campaignsFirst ? [{ view: 'campaigns' as const, action: callChanges }] : []),
    { view: 'locations', action: firstAction(buildLocations(store, range, previous)) },
    { view: 'missed-calls', action: firstAction(buildMissedCalls(store, range, previous)) },
  ];
  const actions = topActions.map((t) => t.action);
  const headline = actions.find((a) => a.actionable) ?? actions[0];

  // Tile facts, then every top action's facts. Keys carry the owner's prefix, so nothing collides.
  const facts: Facts = {
    'overview.calls': { kind: 'count', value: now.calls, noun: CALLS },
    'overview.callers': { kind: 'count', value: now.uniqueCallers, noun: CALLERS },
    'overview.bookings': { kind: 'count', value: now.bookings, noun: BOOKINGS },
    'overview.revenue': { kind: 'usd', value: now.revenueUsd },
  };
  if (currentAnswerRate !== null) facts['overview.answer_rate'] = { kind: 'rate', value: currentAnswerRate };
  // The prompt says "previous period of equal length". A per-day change reads like a total, and a change
  // against a later or the same range reads backwards, so the model gets no change facts for those.
  const { previous: second } = ctx.notes.comparison;
  const earlierEqualLength = !perDay && second !== null && second.end < range.start;
  if (earlierEqualLength) {
    addChangeFact(facts, 'calls', tiles.calls.change);
    addChangeFact(facts, 'callers', tiles.uniqueCallers.change);
    addChangeFact(facts, 'bookings', tiles.bookings.change);
    addChangeFact(facts, 'revenue', tiles.revenueUsd.change);
    addChangeFact(facts, 'answer_rate', tiles.answerRate.change);
  }
  const allFacts: Facts = Object.assign({}, facts, ...actions.map((a) => a.facts));

  return {
    view: 'overview',
    range,
    notes: ctx.notes,
    actions,
    templateSentence: headline?.text ?? '',
    factSheet: makeFactSheet('overview', allFacts),
    tiles,
    topActions,
  };
}

function firstAction(view: ViewBase): Action {
  const action = view.actions[0];
  if (!action) throw new Error(`The ${view.view} view returned no action.`); // ViewBase promises at least one
  return action;
}

/** A percent or points change becomes a fact; new and none do not. */
function addChangeFact(facts: Facts, name: string, change: Change): void {
  if (change.kind === 'percent') facts[`overview.${name}_change`] = { kind: 'percent_change', value: change.value };
  else if (change.kind === 'points') facts[`overview.${name}_change`] = { kind: 'points_change', value: change.value };
}
