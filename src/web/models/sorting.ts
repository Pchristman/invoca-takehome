// The one table-sort comparison, shared by Campaigns and Locations.

export type SortValue = string | number | null;

/** Nulls last in both directions; equal values break by id ascending. */
export function compareSortValues(x: SortValue, y: SortValue, dir: 'asc' | 'desc', idA: string, idB: string): number {
  const byId = idA < idB ? -1 : idA > idB ? 1 : 0;
  if (x === null && y === null) return byId;
  if (x === null) return 1;
  if (y === null) return -1;
  const direction = dir === 'asc' ? 1 : -1;
  if (x < y) return -direction;
  if (x > y) return direction;
  return byId;
}
