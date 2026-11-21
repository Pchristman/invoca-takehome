// What the weekly calls chart draws. Weeks come from the API; this only labels them.

import type { CampaignsView } from '../../core/views';
import { formatLongDate, formatShortDate } from '../format';

const EN_DASH = '–';

export interface WeeklyChartModel {
  /** `Calls per week: ${name}`, the name unchanged. */
  title: string;
  /** key: the Monday. label 'Sep 7' (the Monday); range 'Sep 7 – Sep 13'. Both carry the year when the weeks span two years. */
  bars: { key: string; label: string; range: string; calls: number; partial: boolean }[];
  hasPartial: boolean;
  allZero: boolean;
}

export function weeklyChartModel(weekly: CampaignsView['weekly']): WeeklyChartModel | null {
  if (weekly === null) return null;
  const first = weekly.weeks[0]?.weekStart ?? '';
  const last = weekly.weeks[weekly.weeks.length - 1]?.weekEnd ?? '';
  const format = first.slice(0, 4) === last.slice(0, 4) ? formatShortDate : formatLongDate;
  const bars = weekly.weeks.map((week) => ({
    key: week.weekStart,
    label: format(week.weekStart),
    range: `${format(week.weekStart)} ${EN_DASH} ${format(week.weekEnd)}`,
    calls: week.calls,
    partial: week.partial,
  }));
  return {
    title: `Calls per week: ${weekly.name}`,
    bars,
    hasPartial: bars.some((bar) => bar.partial),
    allZero: bars.every((bar) => bar.calls === 0),
  };
}
