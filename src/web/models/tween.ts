// Tile numbers count from the last value shown to the new one. Display only: at rest the text is the server's own.
import { formatCount, formatRate, formatUsd } from '../../core/views/format';

export type FigureKind = 'count' | 'rate' | 'usd';

/** The one formatter for a tile figure, used for the resting text and for every frame between. */
export function formatFigure(kind: FigureKind, value: number): string {
  if (kind === 'rate') return formatRate(value);
  if (kind === 'usd') return formatUsd(value);
  return formatCount(value);
}

/**
 * Where a tween starts, or null when the number should simply appear.
 * `shown` is the number on screen while a tween runs (a retarget starts there), else null.
 */
export function tweenPlan(input: {
  enabled: boolean;
  to: number | null;
  shown: number | null;
  remembered: number | null;
}): { from: number } | null {
  const { enabled, to, shown, remembered } = input;
  if (!enabled || to === null || !Number.isFinite(to)) return null;
  const from = shown ?? remembered;
  if (from === null || !Number.isFinite(from) || from === to) return null;
  return { from };
}

const remembered = new Map<string, number>();

export function rememberFigure(id: string, value: number): void {
  remembered.set(id, value);
}

export function recallFigure(id: string): number | null {
  return remembered.get(id) ?? null;
}

export function forgetFigures(): void {
  remembered.clear();
}
