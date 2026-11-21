// The missed-calls heatmap: which colour step each cell gets and what it prints.
// Counts are the API's, passed through core format functions; the only arithmetic is the colour step.
import type { MissedCallsView } from '../../core/views/missedCallsView';
import { formatCount, formatHour, formatWeekday } from '../../core/views/format';

export type HeatmapMode = 'office' | 'weekday';
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/** Five steps. 0 is only for no calls; the smallest positive count is at least step 1. */
export function heatLevel(count: number, max: number): HeatLevel {
  if (!Number.isFinite(count) || !Number.isFinite(max) || count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as HeatLevel;
}

export interface HeatCell {
  text: string;
  level: HeatLevel;
  label: string;
}
export interface HeatRow {
  key: string;
  label: string;
  cells: HeatCell[];
  total: string;
}
export interface HeatmapModel {
  mode: HeatmapMode;
  hourLabels: string[];
  rows: HeatRow[];
  empty: boolean;
}

interface SourceRow {
  key: string;
  label: string;
  hours: number[];
  total: number;
}

/** The column headings read as clock times: 12am, 1am ... 12pm ... 11pm. */
function hourHeading(hour: number): string {
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${hour < 12 ? 'am' : 'pm'}`;
}

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => hourHeading(h));

export function heatmapModel(heatmap: MissedCallsView['heatmap'], mode: HeatmapMode): HeatmapModel {
  const source: SourceRow[] =
    mode === 'office'
      ? heatmap.byOffice.map((r) => ({ key: r.locationId, label: r.name, hours: r.hours, total: r.total }))
      : heatmap.byWeekday.map((r) => ({
          key: String(r.weekday),
          label: formatWeekday(r.weekday),
          hours: r.hours,
          total: r.total,
        }));

  const max = Math.max(0, ...source.flatMap((r) => r.hours));

  const rows: HeatRow[] = source.map((row) => ({
    key: row.key,
    label: row.label,
    total: formatCount(row.total),
    cells: row.hours.map((count, hour) => ({
      text: count === 0 ? '' : formatCount(count),
      level: heatLevel(count, max),
      label: `${row.label}, ${formatHour(hour)}: ${formatCount(count, ['missed call', 'missed calls'])}`,
    })),
  }));

  return { mode, hourLabels: HOUR_LABELS, rows, empty: max === 0 };
}
