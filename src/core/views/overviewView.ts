import { changeInCount, changeInRate, rate, tally } from '../metrics';
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

/** previous is null and change is none when there is no comparison. */
export interface Tile {
  current: number | null;
  previous: number | null;
  change: Change;
}

export interface OverviewView extends ViewBase {
  view: 'overview';
  /** answerRate is a fraction, null with no calls. */
  tiles: { calls: Tile; uniqueCallers: Tile; answerRate: Tile; bookings: Tile; revenueUsd: Tile };
  /** Campaigns, Locations, Missed calls, in that order: each view's first action. */
  topActions: { view: ViewName; action: Action }[];
}

const CALLS = ['call', 'calls'] as const;
const CALLERS = ['caller', 'callers'] as const;
const BOOKINGS = ['booking', 'bookings'] as const;

export function buildOverview(store: CallStore, range: ResolvedRange, previous?: DateRange): OverviewView {
  const ctx = makeViewContext(store, range, previous);
  const now = tally(ctx.current);
  const before = ctx.previous ? tally(ctx.previous) : null; // null unless the comparison is available

  const countTile = (current: number, prior: number | undefined): Tile =>
    prior === undefined
      ? { current, previous: null, change: { kind: 'none' } }
      : { current, previous: prior, change: changeInCount(current, prior) };

  const currentAnswerRate = rate(now.answered, now.calls);
  const previousAnswerRate = before ? rate(before.answered, before.calls) : null;
  const tiles: OverviewView['tiles'] = {
    calls: countTile(now.calls, before?.calls),
    uniqueCallers: countTile(now.uniqueCallers, before?.uniqueCallers),
    answerRate: before
      ? { current: currentAnswerRate, previous: previousAnswerRate, change: changeInRate(currentAnswerRate, previousAnswerRate) }
      : { current: currentAnswerRate, previous: null, change: { kind: 'none' } },
    bookings: countTile(now.bookings, before?.bookings),
    revenueUsd: countTile(now.revenueUsd, before?.revenueUsd),
  };

  const topActions: OverviewView['topActions'] = [
    { view: 'campaigns', action: firstAction(buildCampaigns(store, range, previous)) },
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
  addChangeFact(facts, 'calls', tiles.calls.change);
  addChangeFact(facts, 'callers', tiles.uniqueCallers.change);
  addChangeFact(facts, 'answer_rate', tiles.answerRate.change);
  addChangeFact(facts, 'bookings', tiles.bookings.change);
  addChangeFact(facts, 'revenue', tiles.revenueUsd.change);
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
