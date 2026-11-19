// What the Campaigns screen prints and how its table sorts, decided here so the components only draw it.
// No arithmetic on metrics: every cell is the API's value passed through a core format function.
import type { ActionKind } from '../../core/views/facts';
import type { CampaignRow, CampaignsView, UnattributedRow } from '../../core/views/campaignsView';
import { formatCount, formatRate, formatUsd, formatUsdPerDollar } from '../../core/views/format';
import { BLANK, humanize } from '../format';
import { compareSortValues } from './sorting';
import type { SortValue } from './sorting';

export type SortKey =
  | 'name'
  | 'channel'
  | 'calls'
  | 'bookings'
  | 'bookingRate'
  | 'revenueUsd'
  | 'estimatedSpendUsd'
  | 'estimatedCostPerBookingUsd'
  | 'revenuePerBudgetDollar';

export interface CampaignSort {
  key: SortKey;
  dir: 'asc' | 'desc';
}

export const DEFAULT_SORT: CampaignSort = { key: 'calls', dir: 'desc' };

/** The same key flips; name and channel start ascending, the rest descending. */
export function nextSort(current: CampaignSort, key: SortKey): CampaignSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'name' || key === 'channel' ? 'asc' : 'desc' };
}

export interface Cell {
  text: string;
  note?: string; // why a cell is blank
}

export interface CampaignRowModel {
  id: string | null;
  name: string;
  marks: ('best' | 'worst')[];
  cells: Record<SortKey, Cell>;
}

export interface CampaignsModel {
  empty: boolean; // no calls in range at all, unattributed included
  columns: { key: SortKey; label: string; numeric: boolean; estimate: boolean }[];
  rows: CampaignRowModel[]; // sorted by `sort`; unattributed is NOT in here
  unattributed: (CampaignRowModel & { trackingNumbers: { text: string }[] }) | null; // pinned last, never sorted
  bestWorstNote: string | null; // bestWorst.reason, only when nothing is marked
  actions: { kind: ActionKind; text: string; actionable: boolean }[];
  chartChoices: { id: string; name: string }[]; // every campaign, in the API's order
  selectedCampaignId: string | null; // weekly?.campaignId
}

const COLUMNS: CampaignsModel['columns'] = [
  { key: 'name', label: 'Campaign', numeric: false, estimate: false },
  { key: 'channel', label: 'Channel', numeric: false, estimate: false },
  { key: 'calls', label: 'Calls', numeric: true, estimate: false },
  { key: 'bookings', label: 'Bookings', numeric: true, estimate: false },
  { key: 'bookingRate', label: 'Booking rate', numeric: true, estimate: false },
  { key: 'revenueUsd', label: 'Revenue', numeric: true, estimate: false },
  { key: 'estimatedSpendUsd', label: 'Est. spend', numeric: true, estimate: true },
  { key: 'estimatedCostPerBookingUsd', label: 'Est. cost per booking', numeric: true, estimate: true },
  { key: 'revenuePerBudgetDollar', label: 'Est. revenue per budget $', numeric: true, estimate: true },
];

const NOT_APPLICABLE = 'Not applicable: no campaign, so no budget.';
const ZERO_BUDGET = 'No estimate: this campaign has a $0 budget.';
const NO_BOOKINGS = 'No estimate: no bookings in this range.';
const NO_CALLS = 'No calls in this range.';

/** A number cell, or a blank with the reason when the API value is null. */
function numberCell(value: number | null, format: (n: number) => string, note: string | null): Cell {
  if (value !== null) return { text: format(value) };
  return note === null ? { text: BLANK } : { text: BLANK, note };
}

function cellsFor(row: CampaignRow): Record<SortKey, Cell> {
  const noBudget = row.estimatedSpendUsd === null ? NOT_APPLICABLE : row.estimatedSpendUsd === 0 ? ZERO_BUDGET : null;
  const costNote = noBudget ?? (row.bookings === 0 ? NO_BOOKINGS : null);
  return {
    name: { text: row.name },
    channel: { text: humanize(row.channel) },
    calls: { text: formatCount(row.calls) },
    bookings: { text: formatCount(row.bookings) },
    bookingRate: numberCell(row.bookingRate, formatRate, NO_CALLS),
    revenueUsd: { text: formatUsd(row.revenueUsd) },
    estimatedSpendUsd: numberCell(row.estimatedSpendUsd, formatUsd, NOT_APPLICABLE),
    estimatedCostPerBookingUsd: numberCell(row.estimatedCostPerBookingUsd, formatUsd, costNote),
    revenuePerBudgetDollar: numberCell(row.revenuePerBudgetDollar, formatUsdPerDollar, noBudget),
  };
}

function marksFor(row: CampaignRow): ('best' | 'worst')[] {
  const marks: ('best' | 'worst')[] = [];
  if (row.isBest) marks.push('best');
  if (row.isWorst) marks.push('worst');
  return marks;
}

function rowModel(row: CampaignRow): CampaignRowModel {
  return { id: row.campaignId, name: row.name, marks: marksFor(row), cells: cellsFor(row) };
}

function unattributedModel(row: UnattributedRow): NonNullable<CampaignsModel['unattributed']> {
  return {
    ...rowModel(row),
    trackingNumbers: row.trackingNumbers.map((n) => ({
      text: `${n.trackingNumber} · ${formatCount(n.calls, ['call', 'calls'])}`,
    })),
  };
}

function sortValue(row: CampaignRow, key: SortKey): SortValue {
  if (key === 'name') return row.name.toLowerCase();
  return row[key];
}

/** Nulls last in both directions; ties by campaign id ascending. Returns a copy. */
export function sortCampaignRows(rows: CampaignRow[], sort: CampaignSort): CampaignRow[] {
  return [...rows].sort((a, b) =>
    compareSortValues(sortValue(a, sort.key), sortValue(b, sort.key), sort.dir, a.campaignId ?? '', b.campaignId ?? ''),
  );
}

export function campaignsModel(view: CampaignsView, sort: CampaignSort): CampaignsModel {
  const allRows = view.unattributed ? [...view.rows, view.unattributed] : view.rows;
  const marked = view.rows.some((r) => r.isBest || r.isWorst);
  return {
    empty: allRows.every((r) => r.calls === 0),
    columns: COLUMNS,
    rows: sortCampaignRows(view.rows, sort).map(rowModel),
    unattributed: view.unattributed ? unattributedModel(view.unattributed) : null,
    bestWorstNote: marked ? null : view.bestWorst.reason,
    actions: view.actions.map((a) => ({ kind: a.kind, text: a.text, actionable: a.actionable })),
    chartChoices: view.rows.map((r) => ({ id: r.campaignId ?? '', name: r.name })),
    selectedCampaignId: view.weekly?.campaignId ?? null,
  };
}
