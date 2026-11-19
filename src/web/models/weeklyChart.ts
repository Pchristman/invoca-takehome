// What the weekly calls chart draws. Weeks come from the API; this only labels them.

import type { CampaignsView } from '../../core/views';
import { formatShortDate } from '../format';

const EN_DASH = '–';

export interface WeeklyChartModel {
  /** `Calls per week: ${name}`, the name unchanged. */
  title: string;
  /** label 'Sep 7' (the Monday); range 'Sep 7 – Sep 13'. */
  bars: { label: string; range: string; calls: number; partial: boolean }[];
  hasPartial: boolean;
  allZero: boolean;
}

export function weeklyChartModel(weekly: CampaignsView['weekly']): WeeklyChartModel | null {
  if (weekly === null) return null;
  const bars = weekly.weeks.map((week) => ({
    label: formatShortDate(week.weekStart),
    range: `${formatShortDate(week.weekStart)} ${EN_DASH} ${formatShortDate(week.weekEnd)}`,
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
