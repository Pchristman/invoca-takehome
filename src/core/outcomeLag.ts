import type { Call, RowResult } from './types';

const MS_PER_DAY = 86_400_000;

/**
 * True when `row` changes what the call counts for: its outcome, or its revenue while booked. Revenue only
 * counts on booked calls, so a revenue edit on any other call changes nothing. Empty revenue counts as 0.
 */
function changesOutcome(row: Call, before: Call): boolean {
  if (row.outcome !== before.outcome) return true;
  return row.outcome === 'booked' && (row.revenueUsd ?? 0) !== (before.revenueUsd ?? 0);
}

/**
 * The longest gap, in whole days (rounded up), between a call starting and the last row that changed its
 * outcome or booked revenue. For each call whose winning row is good, take its good rows that have a
 * parseable updated_at, oldest first; the call's lag runs to the last row that changes the outcome, or the
 * revenue of a booked call, from the row before it. Identical rows, single-row calls and bad rows say nothing
 * about how late outcomes arrive. 0 when no call qualifies. A gap below 0 counts as 0.
 */
export function measureOutcomeLagDays(groups: RowResult[][], winners: RowResult[]): number {
  let longestMs = 0;
  groups.forEach((group, index) => {
    const winner = winners[index];
    if (!winner?.ok) return;
    const rows = group
      .flatMap((row): Call[] => (row.ok && row.call.updatedAt !== null ? [row.call] : []))
      .sort((a, b) => a.updatedAt!.getTime() - b.updatedAt!.getTime()); // stable: ties keep file order
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      if (changesOutcome(row, rows[i - 1]!)) {
        longestMs = Math.max(longestMs, row.updatedAt!.getTime() - winner.call.startedAt.getTime());
      }
    }
  });
  return Math.ceil(longestMs / MS_PER_DAY);
}
