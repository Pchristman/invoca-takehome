// What the Overview screen prints, decided here so the component only draws it.
// No arithmetic on metrics: every value is the API's value passed through a core format function.
import { formatCount } from '../../core/views/format';
import type { ActionLink } from '../../core/views/facts';
import type { OverviewView, Tile } from '../../core/views/overviewView';
import { BLANK } from '../format';
import { formatFigure } from './tween';
import type { FigureKind } from './tween';
import { changeModel } from './changeModel';
import type { Tone } from './changeModel';
import { VIEW_LABELS } from './viewLabels';

export type { Tone };

export interface TileModel {
  key: 'calls' | 'uniqueCallers' | 'answerRate' | 'bookings' | 'revenueUsd';
  label: string; // Calls, Unique caller numbers, Answer rate, Bookings, Revenue
  value: string; // BLANK when the API value is null
  previous: string | null; // 'was 1,150'; null when there is no usable previous period
  change: { text: string; tone: Tone } | null; // null: no comparison, or both zero
  unavailable: string | null; // the headline of the reason, when the comparison is unavailable
  figure: { value: number; kind: FigureKind } | null; // the number behind value, for the count-up; null when the API value is null
}

export interface OverviewModel {
  empty: boolean; // calls.current === 0
  tiles: TileModel[]; // fixed order above
  comparisonReason: string | null; // the full sentence, shown once
  topActions: { viewLabel: string; text: string; actionable: boolean; link: ActionLink }[]; // API order
}

/** The text before the first ':'; the whole text when there is none. */
export function reasonHeadline(reason: string): string {
  const colon = reason.indexOf(':');
  return colon === -1 ? reason : reason.slice(0, colon);
}

const UNIQUE_CALLERS_PER_DAY = 'Not compared across different lengths';

const TILES: { key: TileModel['key']; label: string; kind: FigureKind }[] = [
  { key: 'calls', label: 'Calls', kind: 'count' },
  { key: 'uniqueCallers', label: 'Unique caller numbers', kind: 'count' },
  { key: 'answerRate', label: 'Answer rate', kind: 'rate' },
  { key: 'bookings', label: 'Bookings', kind: 'count' },
  { key: 'revenueUsd', label: 'Revenue', kind: 'usd' },
];

export function overviewModel(view: OverviewView): OverviewModel {
  const { comparison } = view.notes;
  const { perDay, previousDays } = comparison;
  const headline = !comparison.available && comparison.reason !== null ? reasonHeadline(comparison.reason) : null;

  const tiles = TILES.map(({ key, label, kind }): TileModel => {
    const tile: Tile = view.tiles[key];
    // Calls, bookings and revenue change per day across lengths; the answer rate is a rate and never does.
    const days = perDay && key !== 'answerRate' ? previousDays : null; // null: not per day, or no length to name
    const countsPerDay = days !== null;
    const change = changeModel(tile.change);
    return {
      key,
      label,
      value: tile.current === null ? BLANK : formatFigure(kind, tile.current),
      previous:
        tile.previous === null
          ? null
          : countsPerDay
            ? `was ${formatFigure(kind, tile.previous)} in ${formatCount(days, ['day', 'days'])}`
            : `was ${formatFigure(kind, tile.previous)}`,
      // 'new' and 'none' have no rate to name, so only a percentage gets the suffix.
      change: change !== null && countsPerDay && tile.change.kind === 'percent' ? { ...change, text: `${change.text} per day` } : change,
      unavailable: headline ?? (perDay && key === 'uniqueCallers' ? UNIQUE_CALLERS_PER_DAY : null),
      figure: tile.current === null ? null : { value: tile.current, kind },
    };
  });

  return {
    empty: view.tiles.calls.current === 0,
    tiles,
    comparisonReason: comparison.available ? null : comparison.reason,
    topActions: view.topActions.map(({ view: target, action }) => ({
      viewLabel: VIEW_LABELS[target] ?? target,
      text: action.text,
      actionable: action.actionable,
      link: action.link,
    })),
  };
}
