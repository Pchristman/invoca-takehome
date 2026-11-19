import type { Call, RowResult } from './types';

const MS_PER_DAY = 86_400_000;

const goodCalls = (group: RowResult[]): Call[] => group.flatMap((row) => (row.ok ? [row.call] : []));

/**
 * The longest gap, in whole days (rounded up), between a call starting and a later row changing its
 * outcome or revenue. A call qualifies when its winning row is good, it has two or more good rows with a
 * parseable updated_at, and the winner's outcome or revenue differs from the earliest row's.
 * Pure duplicates and single-row calls say nothing about how late outcomes arrive. 0 when none qualify.
 */
export function measureOutcomeLagDays(groups: RowResult[][], winners: RowResult[]): number {
  let longestMs = 0;
  groups.forEach((group, index) => {
    const winner = winners[index];
    if (!winner?.ok) return;
    const rows = goodCalls(group).filter((c) => c.updatedAt !== null);
    if (rows.length < 2) return;
    const earliest = rows.reduce((a, b) => (b.updatedAt!.getTime() < a.updatedAt!.getTime() ? b : a));
    const changed = winner.call.outcome !== earliest.outcome || winner.call.revenueUsd !== earliest.revenueUsd;
    if (!changed || winner.call.updatedAt === null) return;
    longestMs = Math.max(longestMs, winner.call.updatedAt.getTime() - winner.call.startedAt.getTime());
  });
  return Math.ceil(longestMs / MS_PER_DAY);
}
