import type { Meta } from '../../server/api';
import { formatLongDate, formatSkippedRows } from '../format';

export function Header({
  meta,
  dev,
  dataNotesOpen,
  onToggleDataNotes,
}: {
  meta: Meta;
  dev: boolean;
  dataNotesOpen: boolean;
  onToggleDataNotes(): void;
}) {
  const skipped = formatSkippedRows(meta.skippedRows);
  return (
    <header className="app-header">
      <h1>Inbound call performance</h1>
      <div className="row small muted">
        {meta.span && <span>{`Data as of ${formatLongDate(meta.span.end)}`}</span>}
        {skipped !== null && <span>{skipped}</span>}
        {dev && (
          <button type="button" className="button" aria-pressed={dataNotesOpen} onClick={onToggleDataNotes}>
            Data notes
          </button>
        )}
      </div>
    </header>
  );
}
