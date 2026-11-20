import type { Cell, Mark, CampaignRowModel, CampaignSort, CampaignsModel, SortKey } from '../models/campaignsModel';

const MARK_LABELS: Record<Mark, string> = { best: 'Best', worst: 'Worst', jump: 'Calls jumped', drop: 'Calls dropped' };

function CellText({ cell }: { cell: Cell }) {
  if (cell.note === undefined) return <>{cell.text}</>;
  return (
    <>
      <span title={cell.note}>{cell.text}</span>
      <span className="visually-hidden"> {cell.note}</span>
    </>
  );
}

function cellClass(key: SortKey): string | undefined {
  return key === 'name' || key === 'channel' ? undefined : 'num';
}

function Row({
  row,
  columns,
  trackingNumbers,
}: {
  row: CampaignRowModel;
  columns: CampaignsModel['columns'];
  trackingNumbers?: { text: string }[];
}) {
  return (
    <tr className={trackingNumbers ? 'row-unattributed' : undefined}>
      {columns.map(({ key }) =>
        key === 'name' ? (
          <th scope="row" key={key} title={row.name}>
            {row.name}
            {row.marks.map((mark) => (
              <span key={mark}>
                {' '}
                <span className={`badge badge-${mark}`}>{MARK_LABELS[mark]}</span>
              </span>
            ))}
            {trackingNumbers && trackingNumbers.length > 0 && (
              <ul className="small muted">
                {trackingNumbers.map((n) => (
                  <li key={n.text}>{n.text}</li>
                ))}
              </ul>
            )}
          </th>
        ) : (
          <td key={key} className={cellClass(key)}>
            <CellText cell={row.cells[key]} />
          </td>
        ),
      )}
    </tr>
  );
}

export function CampaignTable({
  model,
  sort,
  onSort,
}: {
  model: CampaignsModel;
  sort: CampaignSort;
  onSort(key: SortKey): void;
}) {
  return (
    <>
      {model.bestWorstNote !== null && <p className="muted small">No best or worst marked: {model.bestWorstNote}</p>}
      {model.bestWorstRule !== null && <p className="muted small">{model.bestWorstRule}</p>}
      <div className="table-wrap">
        <table>
          <caption className="visually-hidden">Campaigns in the selected range</caption>
          <thead>
            <tr>
              {model.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={column.numeric ? 'num' : undefined}
                  aria-sort={sort.key === column.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  <button type="button" className="sort-button" onClick={() => onSort(column.key)}>
                    {column.label}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => (
              <Row key={row.id ?? row.name} row={row} columns={model.columns} />
            ))}
            {model.unattributed && <Row row={model.unattributed} columns={model.columns} trackingNumbers={model.unattributed.trackingNumbers} />}
          </tbody>
        </table>
      </div>
      {model.alertsNote !== null && <p className="muted small">{model.alertsNote}</p>}
    </>
  );
}
