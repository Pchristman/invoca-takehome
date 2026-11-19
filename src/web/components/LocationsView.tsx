import { useState } from 'react';
import type { DateRange } from '../../core/ranges';
import type { LocationsView as LocationsData } from '../../core/views';
import { caveatsFor } from '../models/caveats';
import { DEFAULT_LOCATION_SORT, locationsModel, nextLocationSort } from '../models/locationsModel';
import type { LocationRowModel, LocationSort, LocationSortKey, LocationsModel } from '../models/locationsModel';
import type { Cell } from '../models/campaignsModel';
import { actionHref } from '../urlState';
import type { UrlState } from '../urlState';
import { Caveats } from './Caveats';
import { Link } from './Link';

function CellText({ cell }: { cell: Cell }) {
  if (cell.note === undefined) return <>{cell.text}</>;
  return (
    <>
      <span title={cell.note}>{cell.text}</span>
      <span className="visually-hidden"> {cell.note}</span>
    </>
  );
}

function Flags({ row }: { row: LocationRowModel }) {
  if (row.flags.length === 0) return <span className="muted">{row.flagNote}</span>;
  return (
    <ul className="flag-list">
      {row.flags.map((flag) => (
        <li key={flag.metric}>
          <span className={`badge badge-${flag.direction === 'better' ? 'best' : 'worst'}`}>
            {flag.direction === 'better' ? 'Better' : 'Worse'}
          </span>{' '}
          {flag.text}
        </li>
      ))}
    </ul>
  );
}

export function LocationTable({
  model,
  sort,
  onSort,
}: {
  model: LocationsModel;
  sort: LocationSort;
  onSort(key: LocationSortKey): void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <caption className="visually-hidden">Offices in the selected range</caption>
        <thead>
          <tr>
            {model.columns.map((column) =>
              column.key === 'flags' ? (
                <th key={column.key} scope="col">
                  {column.label}
                </th>
              ) : (
                <th
                  key={column.key}
                  scope="col"
                  className={column.numeric ? 'num' : undefined}
                  aria-sort={sort.key === column.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  <button type="button" className="sort-button" onClick={() => onSort(column.key as LocationSortKey)}>
                    {column.label}
                  </button>
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.id}>
              {model.columns.map(({ key, numeric }) =>
                key === 'name' ? (
                  <th scope="row" key={key} title={row.name}>
                    {row.name}
                  </th>
                ) : key === 'flags' ? (
                  <td key={key}>
                    <Flags row={row} />
                  </td>
                ) : (
                  <td key={key} className={numeric ? 'num' : undefined}>
                    <CellText cell={row.cells[key]} />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LocationsView({ view, state, span }: { view: LocationsData; state: UrlState; span: DateRange }) {
  const [sort, setSort] = useState(DEFAULT_LOCATION_SORT);
  const model = locationsModel(view, sort);
  const caveats = caveatsFor(view.notes, span, { comparing: false, range: view.range });

  return (
    <>
      <Caveats items={caveats} />
      <section className="section">
        <h2>Action</h2>
        <p className={model.action.actionable ? undefined : 'muted'}>{model.action.text}</p>
        <p>
          <Link href={actionHref(state, model.action.link)}>{model.action.linkLabel}</Link>
        </p>
      </section>
      <section className="section">
        <h2>Offices</h2>
        {model.empty ? (
          <p role="status">No calls in this range.</p>
        ) : (
          <>
            <LocationTable
              model={model}
              sort={sort}
              onSort={(key) => setSort((current) => nextLocationSort(current, key))}
            />
            <p className="muted small">{model.flagsNote}</p>
          </>
        )}
      </section>
    </>
  );
}
