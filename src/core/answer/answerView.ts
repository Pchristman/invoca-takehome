import { rate, tally } from '../metrics';
import type { ResolvedRange } from '../ranges';
import type { CallStore, CleanCall } from '../types';
import { formatCount, formatRate, formatUsd } from '../views/format';
import { makeViewContext } from '../views/viewContext';
import type { ViewNotes } from '../views/viewContext';
import { applyFilter } from './filter';
import type { AnswerFilter } from './filter';

export interface AnswerRow {
  /** Office or campaign id; null = Unattributed. */
  id: string | null;
  name: string;
  calls: number;
  answered: number;
  unanswered: number;
  /** null when calls is 0. */
  answerRate: number | null;
  bookings: number;
  bookingRate: number | null;
  revenueUsd: number;
}

export interface AnswerView {
  range: ResolvedRange;
  notes: ViewNotes;
  filter: AnswerFilter;
  groupBy: 'office' | 'campaign' | 'none';
  totals: Omit<AnswerRow, 'id' | 'name'>;
  /** Only groups with at least one matching call. */
  rows: AnswerRow[];
  sentence: string;
}

const CALLS = ['call', 'calls'] as const;
const NO_MATCH = 'No calls match this question in this range.';
const UNATTRIBUTED = 'Unattributed';

function summarize(calls: readonly CleanCall[]): Omit<AnswerRow, 'id' | 'name'> {
  const t = tally(calls);
  return {
    calls: t.calls,
    answered: t.answered,
    unanswered: t.calls - t.answered, // unanswered is !answered (PLAN.md 4.4)
    answerRate: rate(t.answered, t.calls),
    bookings: t.bookings,
    bookingRate: rate(t.bookings, t.calls),
    revenueUsd: t.revenueUsd,
  };
}

function groupKey(view: AnswerFilter['view']): AnswerView['groupBy'] {
  if (view === 'campaigns') return 'campaign';
  if (view === 'locations' || view === 'missed-calls') return 'office';
  return 'none';
}

function buildRows(store: CallStore, calls: readonly CleanCall[], groupBy: AnswerView['groupBy']): AnswerRow[] {
  if (groupBy === 'none') return [];
  const names = new Map(
    (groupBy === 'office' ? store.locations : store.campaigns).map((item) => [item.id, item.name]),
  );
  const groups = new Map<string | null, CleanCall[]>();
  for (const call of calls) {
    const id = groupBy === 'office' ? call.locationId : call.campaignId;
    groups.set(id, [...(groups.get(id) ?? []), call]);
  }
  return [...groups].map(([id, groupCalls]) => ({
    id,
    // An id the store lacks falls back to the id itself; cleaning already drops such calls.
    name: id === null ? UNATTRIBUTED : (names.get(id) ?? id),
    ...summarize(groupCalls),
  }));
}

/** Ties by id, null last. */
function byId(a: AnswerRow, b: AnswerRow): number {
  if (a.id === b.id) return 0;
  if (a.id === null) return 1;
  if (b.id === null) return -1;
  return a.id < b.id ? -1 : 1;
}

function sentenceFor(filter: AnswerFilter, totals: AnswerView['totals'], rows: AnswerRow[]): string {
  if (totals.calls === 0) return NO_MATCH;
  const top = rows[0];
  if (top) {
    if (filter.view === 'missed-calls') {
      if (top.unanswered === 0) return 'No matching call went unanswered.';
      return `${top.name} had the most unanswered calls: ${formatCount(top.unanswered)} of ${formatCount(top.calls)}.`;
    }
    if (filter.view === 'locations') {
      return `${top.name} took the most calls: ${formatCount(top.calls)}, of which ${formatCount(top.answered)} were answered.`;
    }
    if (filter.view === 'campaigns') {
      return `${top.name} had the most calls: ${formatCount(top.calls)}, with ${formatCount(top.bookings, ['booking', 'bookings'])}.`;
    }
  }
  const answerRate = totals.answerRate === null ? '' : formatRate(totals.answerRate);
  return `${formatCount(totals.calls, CALLS)} matched: ${answerRate} answered, ${formatCount(totals.bookings)} booked, ${formatUsd(totals.revenueUsd)} in revenue.`;
}

export function buildAnswer(store: CallStore, range: ResolvedRange, filter: AnswerFilter): AnswerView {
  const ctx = makeViewContext(store, range);
  const matching = applyFilter(ctx.current, filter);
  const groupBy = groupKey(filter.view);
  const rows = buildRows(store, matching, groupBy);
  const sortKey = filter.view === 'missed-calls' ? (row: AnswerRow) => row.unanswered : (row: AnswerRow) => row.calls;
  rows.sort((a, b) => sortKey(b) - sortKey(a) || byId(a, b));
  const totals = summarize(matching);
  return { range, notes: ctx.notes, filter, groupBy, totals, rows, sentence: sentenceFor(filter, totals, rows) };
}
