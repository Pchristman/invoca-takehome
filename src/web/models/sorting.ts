// The one table-sort comparison and the one header-click rule, shared by Campaigns and Locations.

export type SortValue = string | number | null;

export interface TableSort<K extends string> {
  key: K;
  dir: 'asc' | 'desc';
}

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

/** A header click: the same key flips; a new key starts A to Z if it is a text column, else highest first. */
export function nextSort<K extends string>(current: TableSort<K>, key: K, textKeys: readonly K[]): TableSort<K> {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: textKeys.includes(key) ? 'asc' : 'desc' };
}
