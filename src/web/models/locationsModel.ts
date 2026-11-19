// What the Locations screen prints, decided here so the components only draw it.
// No arithmetic on metrics: every cell is the API's value passed through a core format function.
import type { ActionKind, ActionLink } from '../../core/views/facts';
import { formatCount, formatRate, formatUsd } from '../../core/views/format';
import type { LocationRow, LocationsView } from '../../core/views/locationsView';
import type { OutlierResult } from '../../core/ranking';
import { BLANK } from '../format';
import type { Cell } from './campaignsModel';
import { compareSortValues } from './sorting';
import type { SortValue } from './sorting';
import { VIEW_LABELS } from './viewLabels';

export type LocationColumnKey = 'name' | 'calls' | 'answerRate' | 'bookings' | 'bookingRate' | 'revenueUsd' | 'bestCampaign';

export interface LocationFlagModel {
  metric: 'answer' | 'booking';
  direction: 'better' | 'worse';
  text: string;
}

export interface LocationRowModel {
  id: string;
  name: string;
  cells: Record<LocationColumnKey, Cell>;
  flags: LocationFlagModel[]; // flagged metrics only, answer first
  flagNote: string | null; // set exactly when flags is empty
}

export interface LocationsModel {
  empty: boolean; // every office has 0 calls (also when there are no offices)
  columns: { key: LocationColumnKey | 'flags'; label: string; numeric: boolean }[];
  rows: LocationRowModel[]; // sorted by `sort`
  action: { kind: ActionKind; text: string; actionable: boolean; link: ActionLink; linkLabel: string };
  flagsNote: string; // fixed explanation under the table
}

export type LocationSortKey = LocationColumnKey;

export interface LocationSort {
  key: LocationSortKey;
  dir: 'asc' | 'desc';
}

export const DEFAULT_LOCATION_SORT: LocationSort = { key: 'calls', dir: 'desc' };

/** The same key flips; name and bestCampaign start ascending, the rest descending. */
export function nextLocationSort(current: LocationSort, key: LocationSortKey): LocationSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'name' || key === 'bestCampaign' ? 'asc' : 'desc' };
}

const COLUMNS: LocationsModel['columns'] = [
  { key: 'name', label: 'Office', numeric: false },
  { key: 'calls', label: 'Calls', numeric: true },
  { key: 'answerRate', label: 'Answer rate', numeric: true },
  { key: 'bookings', label: 'Bookings', numeric: true },
  { key: 'bookingRate', label: 'Booking rate', numeric: true },
  { key: 'revenueUsd', label: 'Revenue', numeric: true },
  { key: 'bestCampaign', label: 'Best campaign there', numeric: false },
  { key: 'flags', label: 'Compared with other offices', numeric: false },
];

const NO_CALLS = 'No calls in this range.';
const NO_BEST = 'No campaign has enough calls at this office to name a best one.';

const FLAGS_NOTE =
  'Each office is compared with all other offices pooled. Only offices with enough calls are tested, and a difference is flagged only when chance does not explain it.';

function rateCell(value: number | null): Cell {
  return value === null ? { text: BLANK, note: NO_CALLS } : { text: formatRate(value) };
}

function bestCampaignCell(row: LocationRow): Cell {
  const best = row.bestCampaign;
  if (best === null) return { text: BLANK, note: row.calls === 0 ? NO_CALLS : NO_BEST };
  return {
    text: `${best.name} (${formatRate(best.bookingRate)} booked, ${formatCount(best.calls, ['call', 'calls'])})`,
  };
}

function flagModel(metric: 'answer' | 'booking', flag: OutlierResult): LocationFlagModel[] {
  if (!flag.flagged || flag.direction === null) return [];
  const label = metric === 'answer' ? 'Answer rate' : 'Booking rate';
  const text = `${label} ${flag.direction}: ${formatRate(flag.officeRate!)} here, ${formatRate(flag.restRate!)} at other offices.`;
  return [{ metric, direction: flag.direction, text }];
}

function flagNoteFor(row: LocationRow): string {
  if (row.calls === 0) return NO_CALLS;
  if (!row.answerFlag.eligible) return 'Too few calls to compare.';
  return 'In line with other offices.';
}

function rowModel(row: LocationRow): LocationRowModel {
  const flags = [...flagModel('answer', row.answerFlag), ...flagModel('booking', row.bookingFlag)];
  return {
    id: row.locationId,
    name: row.name,
    cells: {
      name: { text: row.name },
      calls: { text: formatCount(row.calls) },
      answerRate: rateCell(row.answerRate),
      bookings: { text: formatCount(row.bookings) },
      bookingRate: rateCell(row.bookingRate),
      revenueUsd: { text: formatUsd(row.revenueUsd) },
      bestCampaign: bestCampaignCell(row),
    },
    flags,
    flagNote: flags.length === 0 ? flagNoteFor(row) : null,
  };
}

function sortValue(row: LocationRow, key: LocationSortKey): SortValue {
  if (key === 'name') return row.name.toLowerCase();
  if (key === 'bestCampaign') return row.bestCampaign?.name.toLowerCase() ?? null;
  return row[key];
}

/** Nulls last in both directions; ties by office id ascending. Returns a copy. */
export function sortLocationRows(rows: LocationRow[], sort: LocationSort): LocationRow[] {
  return [...rows].sort((a, b) =>
    compareSortValues(sortValue(a, sort.key), sortValue(b, sort.key), sort.dir, a.locationId, b.locationId),
  );
}

export function locationsModel(view: LocationsView, sort: LocationSort): LocationsModel {
  const action = view.actions[0]!;
  const officeId = action.link.locationId;
  const officeName = officeId === undefined ? null : (view.rows.find((r) => r.locationId === officeId)?.name ?? officeId);
  const linkLabel = `See ${VIEW_LABELS[action.link.view]}${officeName === null ? '' : ` for ${officeName}`}`;
  return {
    empty: view.rows.every((r) => r.calls === 0),
    columns: COLUMNS,
    rows: sortLocationRows(view.rows, sort).map(rowModel),
    action: { kind: action.kind, text: action.text, actionable: action.actionable, link: action.link, linkLabel },
    flagsNote: FLAGS_NOTE,
  };
}
