import type { MissedCallsModel } from '../models/missedCallsModel';

type Column = MissedCallsModel['callbacks']['columns'][number];

function cellClass(column: Column): string | undefined {
  return column.numeric ? 'num' : undefined;
}

export function CallbackTable({
  model,
  onPage,
}: {
  model: MissedCallsModel['callbacks'];
  onPage(page: number): void;
}) {
  const { pager } = model;
  return (
    <>
      <div className="table-wrap">
        <table className="callbacks">
          <caption className="visually-hidden">Callers whose latest call went unanswered</caption>
          <thead>
            <tr>
              {model.columns.map((column) => (
                <th key={column.label} scope="col" className={cellClass(column)} title={column.estimate ? 'Estimate: see how it works below' : undefined}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => (
              <tr key={row.key}>
                {row.cells.map((text, i) => (
                  <td key={model.columns[i]!.label} className={cellClass(model.columns[i]!)}>
                    {text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pager !== null && (
        <div className="row pager">
          <button type="button" className="button" disabled={!pager.hasPrevious} onClick={() => onPage(pager.page - 1)}>
            Previous
          </button>
          <button type="button" className="button" disabled={!pager.hasNext} onClick={() => onPage(pager.page + 1)}>
            Next
          </button>
          <span className="small muted">{pager.label}</span>
        </div>
      )}
    </>
  );
}
