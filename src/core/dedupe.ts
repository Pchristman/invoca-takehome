import type { RowResult } from './types';

export interface DedupeResult {
  /** One entry per call, in order of each call's first appearance in the file. */
  winners: RowResult[];
  /** Every raw row for the call, file order; same index as `winners`. */
  groups: RowResult[][];
  rowsRead: number;
  duplicateRowsCollapsed: number;
  /** Calls whose latest updated_at was shared by two or more rows. */
  tiedCalls: number;
}

const callIdOf = (row: RowResult): string => (row.ok ? row.call.callId : row.bad.callId);
const updatedAtOf = (row: RowResult): Date | null => (row.ok ? row.call.updatedAt : row.bad.updatedAt);

/** True when `candidate` should replace `best`: later updated_at, or equal (the later row in the file wins). */
function beats(candidate: RowResult, best: RowResult): boolean {
  const c = updatedAtOf(candidate);
  const b = updatedAtOf(best);
  if (c === null) return b === null; // an unparseable updated_at only beats another unparseable one
  if (b === null) return true;
  return c.getTime() >= b.getTime();
}

/**
 * Keep one row per call_id: the one with the latest updated_at. This runs over good AND bad rows,
 * so a bad latest row makes the call bad instead of falling back to an older good row.
 * Rows with an empty call_id cannot be grouped; each stays its own call.
 */
export function dedupeRows(rows: RowResult[]): DedupeResult {
  const groups: RowResult[][] = [];
  const groupById = new Map<string, RowResult[]>();
  for (const row of rows) {
    const id = callIdOf(row);
    const existing = id === '' ? undefined : groupById.get(id);
    if (existing) {
      existing.push(row);
    } else {
      const group = [row];
      groups.push(group);
      if (id !== '') groupById.set(id, group);
    }
  }

  let tiedCalls = 0;
  const winners = groups.map((group) => {
    let best = group[0]!;
    for (const row of group.slice(1)) if (beats(row, best)) best = row;
    const bestTime = updatedAtOf(best)?.getTime();
    if (bestTime !== undefined && group.filter((r) => updatedAtOf(r)?.getTime() === bestTime).length > 1) {
      tiedCalls += 1;
    }
    return best;
  });

  return {
    winners,
    groups,
    rowsRead: rows.length,
    duplicateRowsCollapsed: rows.length - groups.length,
    tiedCalls,
  };
}
