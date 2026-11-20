// What the print summary shows, decided here so the component only draws it.
// No arithmetic and no clock: every value is the API's value passed through an existing model or format function.
import type { DateRange } from '../../core/ranges';
import type { ViewName } from '../../core/views/facts';
import type { OverviewView } from '../../core/views/overviewView';
import { formatCount } from '../../core/views/format';
import type { Meta, TakeawayResponse } from '../../server/api';
import { formatDateSpan, formatLongDate, formatSkippedRows } from '../format';
import type { RequestState } from '../requestState';
import { caveatsFor } from './caveats';
import type { Caveat } from './caveats';
import { comparisonLine } from './comparisonLine';
import { printEstimateNotes } from './estimates';
import { overviewModel } from './overviewModel';
import type { TileModel } from './overviewModel';
import { takeawayModel } from './takeawayModel';
import type { TakeawayShow } from './takeawayModel';
import { VIEW_LABELS } from './viewLabels';

export interface PrintBlock {
  view: 'campaigns' | 'locations' | 'missed-calls';
  label: string;
  actions: { text: string; actionable: boolean }[]; // this view's topActions entries, API order
  takeaway: TakeawayShow; // always built without dev notes
}

export interface PrintModel {
  rangeLine: string;
  asOf: string;
  skipped: string | null;
  comparisonLine: string | null;
  comparisonReason: string | null; // printed once
  caveats: Caveat[];
  tiles: TileModel[];
  empty: boolean;
  overviewTakeaway: TakeawayShow;
  blocks: PrintBlock[]; // campaigns, locations, missed-calls, in that order
  estimateNotes: string[];
}

export type PrintTakeaways = Record<ViewName, RequestState<TakeawayResponse> | null>;

const BLOCK_VIEWS: PrintBlock['view'][] = ['campaigns', 'locations', 'missed-calls'];

export function printModel(input: { view: OverviewView; meta: Meta; span: DateRange; takeaways: PrintTakeaways }): PrintModel {
  const { view, meta, span, takeaways } = input;
  const overview = overviewModel(view);
  const { range } = view;

  return {
    rangeLine: `${formatDateSpan(range.start, range.end)} (${formatCount(range.days, ['day', 'days'])})`,
    asOf: `Data as of ${formatLongDate(span.end)}`,
    skipped: formatSkippedRows(meta.skippedRows),
    comparisonLine: comparisonLine(view.notes, range),
    comparisonReason: overview.comparisonReason,
    caveats: caveatsFor(view.notes, span, { comparing: true, range, view: 'overview' }),
    tiles: overview.tiles,
    empty: overview.empty,
    overviewTakeaway: takeawayModel(takeaways.overview, { dev: false }),
    blocks: BLOCK_VIEWS.map((blockView) => ({
      view: blockView,
      label: VIEW_LABELS[blockView],
      actions: view.topActions
        .filter((entry) => entry.view === blockView)
        .map(({ action }) => ({ text: action.text, actionable: action.actionable })),
      takeaway: takeawayModel(takeaways[blockView], { dev: false }),
    })),
    estimateNotes: printEstimateNotes(range.days),
  };
}

/** True once the overview is ready and no takeaway is still loading (failed or not requested is settled). */
export function canPrint(overview: RequestState<unknown> | null, takeaways: PrintTakeaways): boolean {
  if (overview === null || overview.status !== 'ready') return false;
  return Object.values(takeaways).every((state) => state === null || state.status !== 'loading');
}
