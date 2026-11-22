// What the Missed calls screen prints, decided here so the components only draw it.
// No metric is computed: counts come from .length and slice, every number is the API's value through a format function.
import type { DateRange } from '../../core/ranges';
import type { ActionKind } from '../../core/views/facts';
import { formatCount, formatUsd } from '../../core/views/format';
import type { MissedCallsView } from '../../core/views/missedCallsView';
import { formatLongDate } from '../format';

export const CALLBACK_PAGE_SIZE = 25;

export interface CallbackRowModel {
  key: string; // callerHash
  cells: string[]; // in column order
}

export interface MissedCallsModel {
  filterLabel: string | null;
  noMissed: string | null; // set when unansweredCalls is 0
  unanswered: string;
  lostValue: { label: string; value: string; note: string; formula: string; sources: string[] };
  callbacks: {
    summary: string;
    columns: { label: string; numeric: boolean; estimate: boolean }[];
    rows: CallbackRowModel[]; // the current page, API order
    pager: { page: number; pages: number; label: string; hasPrevious: boolean; hasNext: boolean } | null;
    emptyNote: string | null;
    canDownload: boolean;
    downloadNote: string;
  };
  unidentifiedNote: string | null;
  reachNote: string;
  limitNote: string;
  action: { kind: ActionKind; text: string; actionable: boolean };
}

const CALLS = ['call', 'calls'] as const;
const UNANSWERED = ['unanswered call', 'unanswered calls'] as const;
const CALLERS = ['caller', 'callers'] as const;

const COLUMNS: MissedCallsModel['callbacks']['columns'] = [
  { label: 'Caller', numeric: false, estimate: false },
  { label: 'Unanswered calls in range', numeric: true, estimate: false },
  { label: 'Last attempt (office local time)', numeric: false, estimate: false },
  { label: 'Office', numeric: false, estimate: false },
  { label: 'Campaign', numeric: false, estimate: false },
  { label: 'Tracking number', numeric: false, estimate: false },
  { label: 'Est. value', numeric: true, estimate: true },
];

// The "model, not a measured loss" sentences live in the formula (the API and the print summary use it too), so it is not repeated here.
const LOST_VALUE_NOTE =
  'The call-back list is smaller: only callers whose latest call went unanswered, each once.';
const EMPTY_NOTE = 'No one to call back from this range.';
const DOWNLOAD_NOTE = 'The file has every caller, one per row.';

/** Out of range, zero, negative and NaN all land on a real page. */
function clampPage(page: number, pages: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.trunc(page), 1), pages);
}

export function missedCallsModel(view: MissedCallsView, span: DateRange, page = 1): MissedCallsModel {
  const filter = view.officeFilter;
  const officeLabel = filter === null ? null : (filter.name ?? `office ${filter.locationId}`);
  const all = view.callbacks.rows;
  const total = all.length;

  const pages = Math.max(1, Math.ceil(total / CALLBACK_PAGE_SIZE));
  const current = clampPage(page, pages);
  const from = (current - 1) * CALLBACK_PAGE_SIZE;
  const shown = all.slice(from, from + CALLBACK_PAGE_SIZE);
  const to = from + shown.length;

  const by = view.lostValue.bySource;
  const sources = [
    { n: by.campaign, text: "valued at their campaign's rates" },
    { n: by.channel, text: "valued at their channel's rates" },
    { n: by.overall, text: 'valued at the overall rates' },
  ]
    .filter((s) => s.n > 0)
    .map((s) => `${formatCount(s.n, CALLS)} ${s.text}`);

  const n = view.unidentifiedUnanswered;
  const action = view.actions[0]!;

  return {
    filterLabel: filter === null ? null : `Showing ${officeLabel} only.`,
    noMissed:
      view.unansweredCalls === 0
        ? `No calls went unanswered${officeLabel === null ? '' : ` at ${officeLabel}`} in this range.`
        : null,
    unanswered: `${formatCount(view.unansweredCalls, UNANSWERED)} (including voicemail)`,
    lostValue: {
      label: 'Est. lost value',
      value: formatUsd(view.lostValue.estimatedUsd),
      note: LOST_VALUE_NOTE,
      formula: view.lostValue.formula,
      sources,
    },
    callbacks: {
      summary: `${formatCount(total, CALLERS)} whose latest call went unanswered.`,
      columns: COLUMNS,
      rows: shown.map((r) => ({
        key: r.callerHash,
        cells: [
          r.callerHash,
          formatCount(r.unansweredAttempts),
          r.lastAttemptLocal,
          r.officeName,
          r.campaignName,
          r.trackingNumber,
          formatUsd(r.estimatedValueUsd),
        ],
      })),
      pager:
        total <= CALLBACK_PAGE_SIZE
          ? null
          : {
              page: current,
              pages,
              label: `Rows ${formatCount(from + 1)}–${formatCount(to)} of ${formatCount(total)}, highest value first. The CSV has all of them.`,
              hasPrevious: current > 1,
              hasNext: current < pages,
            },
      emptyNote: total === 0 ? EMPTY_NOTE : null,
      canDownload: total > 0,
      downloadNote: DOWNLOAD_NOTE,
    },
    unidentifiedNote:
      n > 0
        ? `${formatCount(n, UNANSWERED)} had no caller number, so ${n === 1 ? 'that caller' : 'those callers'} cannot be listed.`
        : null,
    reachNote: `Callers are checked against calls up to ${formatLongDate(span.end)}, the last day in the data. Anyone who got through after that is still listed.`,
    limitNote: view.limitNote,
    action: { kind: action.kind, text: action.text, actionable: action.actionable },
  };
}
