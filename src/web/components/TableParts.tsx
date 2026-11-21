// The pieces the Campaigns and Locations tables share.
import type { ReactNode } from 'react';
import type { Cell } from '../models/campaignsModel';
import type { TableSort } from '../models/sorting';

/** A cell's text; when it is blank for a reason, the reason is a tooltip and is read out to screen readers. */
export function CellText({ cell }: { cell: Cell }) {
  if (cell.note === undefined) return <>{cell.text}</>;
  return (
    <>
      <span title={cell.note}>{cell.text}</span>
      <span className="visually-hidden"> {cell.note}</span>
    </>
  );
}

/** A column header that sorts the table when clicked, and tells screen readers which way it is sorted. */
export function SortHeader<K extends string>({
  columnKey,
  numeric,
  sort,
  onSort,
  children,
}: {
  columnKey: K;
  numeric: boolean;
  sort: TableSort<K>;
  onSort(key: K): void;
  children: ReactNode;
}) {
  return (
    <th
      scope="col"
      className={numeric ? 'num' : undefined}
      aria-sort={sort.key === columnKey ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button type="button" className="sort-button" onClick={() => onSort(columnKey)}>
        {children}
      </button>
    </th>
  );
}
