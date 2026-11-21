import { rate, tally } from '../metrics';
import type { ResolvedRange } from '../ranges';
import { compareText, UNATTRIBUTED_NAME } from '../text';
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
    const group = groups.get(id);
    if (group) group.push(call);
    else groups.set(id, [call]);
  }
  return [...groups].map(([id, groupCalls]) => ({
    id,
    // An id the store lacks falls back to the id itself; cleaning already drops such calls.
    name: id === null ? UNATTRIBUTED_NAME : (names.get(id) ?? id),
    ...summarize(groupCalls),
  }));
}

/** Ties by id, null last. */
function byId(a: AnswerRow, b: AnswerRow): number {
  if (a.id === b.id) return 0;
  if (a.id === null) return 1;
  if (b.id === null) return -1;
  return compareText(a.id, b.id);
}

const MAX_NAMED = 3;

/** 'A', 'A and B', 'A, B and C', 'A, B, C and 2 more'. */
function namesText(names: string[]): string {
  if (names.length > MAX_NAMED) return `${names.slice(0, MAX_NAMED).join(', ')} and ${names.length - MAX_NAMED} more`;
  if (names.length === 1) return names[0] as string;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function sentenceFor(filter: AnswerFilter, totals: AnswerView['totals'], rows: AnswerRow[]): string {
  if (totals.calls === 0) return NO_MATCH;
  const top = rows[0];
  if (top) {
    // Rows are sorted by the view's key, so the leaders are the rows that equal the first one on it.
    const value = (row: AnswerRow) => (filter.view === 'missed-calls' ? row.unanswered : row.calls);
    const leaders = rows.filter((row) => value(row) === value(top));
    const tied = leaders.length > 1;
    const who = tied ? `${namesText(leaders.map((row) => row.name))} tied for the most` : `${top.name} had the most`;
    // On a tie only the tied value is stated: the leaders' other numbers can differ.
    if (filter.view === 'missed-calls') {
      if (top.unanswered === 0) return 'No matching call went unanswered.';
      if (tied) return `${who} unanswered calls: ${formatCount(top.unanswered)}.`;
      return `${who} unanswered calls: ${formatCount(top.unanswered)} of ${formatCount(top.calls)}.`;
    }
    if (tied) return `${who} calls: ${formatCount(top.calls)}.`;
    if (filter.view === 'locations') {
      return `${top.name} took the most calls: ${formatCount(top.calls)}, of which ${formatCount(top.answered)} were answered.`;
    }
    if (filter.view === 'campaigns') {
      return `${who} calls: ${formatCount(top.calls)}, with ${formatCount(top.bookings, ['booking', 'bookings'])}.`;
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
