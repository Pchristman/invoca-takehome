// What the Overview screen prints, decided here so the component only draws it.
// No arithmetic on metrics: every value is the API's value passed through a core format function.
import type { Change } from '../../core/metrics';
import { formatCount, formatPercentChange, formatPointsChange, formatRate, formatUsd } from '../../core/views/format';
import type { ActionLink } from '../../core/views/facts';
import type { OverviewView, Tile } from '../../core/views/overviewView';
import { BLANK } from '../format';

export type Tone = 'up' | 'down' | 'flat' | 'new';

export interface TileModel {
  key: 'calls' | 'uniqueCallers' | 'answerRate' | 'bookings' | 'revenueUsd';
  label: string; // Calls, Unique callers, Answer rate, Bookings, Revenue
  value: string; // BLANK when the API value is null
  previous: string | null; // 'was 1,150'; null when there is no usable previous period
  change: { text: string; tone: Tone } | null; // null: no comparison, or both zero
  unavailable: string | null; // the headline of the reason, when the comparison is unavailable
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

const TILES: { key: TileModel['key']; label: string; format: (value: number) => string }[] = [
  { key: 'calls', label: 'Calls', format: formatCount },
  { key: 'uniqueCallers', label: 'Unique callers', format: formatCount },
  { key: 'answerRate', label: 'Answer rate', format: formatRate },
  { key: 'bookings', label: 'Bookings', format: formatCount },
  { key: 'revenueUsd', label: 'Revenue', format: formatUsd },
];

// The tone comes from the sign of the text the format function printed: '+' up, '-' down, else flat.
// So a +0.04 that prints '0.0%' is flat, with no rounding done here.
function toneOfText(text: string): Tone {
  if (text.startsWith('+')) return 'up';
  if (text.startsWith('-')) return 'down';
  return 'flat';
}

function changeModel(change: Change): TileModel['change'] {
  switch (change.kind) {
    case 'percent': {
      const text = formatPercentChange(change.value);
      return { text, tone: toneOfText(text) };
    }
    case 'points': {
      const text = formatPointsChange(change.value);
      return { text, tone: toneOfText(text) };
    }
    case 'new':
      return { text: 'new', tone: 'new' };
    case 'none':
      return null;
  }
}

const VIEW_LABELS: Record<string, string> = {
  overview: 'Overview',
  campaigns: 'Campaigns',
  locations: 'Locations',
  'missed-calls': 'Missed calls',
};

export function overviewModel(view: OverviewView): OverviewModel {
  const { comparison } = view.notes;
  const headline = !comparison.available && comparison.reason !== null ? reasonHeadline(comparison.reason) : null;

  const tiles = TILES.map(({ key, label, format }): TileModel => {
    const tile: Tile = view.tiles[key];
    return {
      key,
      label,
      value: tile.current === null ? BLANK : format(tile.current),
      previous: tile.previous === null ? null : `was ${format(tile.previous)}`,
      change: changeModel(tile.change),
      unavailable: headline,
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
