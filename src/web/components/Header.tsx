import type { Meta } from '../../server/api';
import { formatLongDate, formatSkippedRows } from '../format';

/** The id App focuses when the data notes panel closes. */
export const DATA_NOTES_BUTTON_ID = 'data-notes-button';

export function Header({
  meta,
  dev,
  dataNotesOpen,
  onToggleDataNotes,
  printLink,
}: {
  meta: Meta;
  dev: boolean;
  dataNotesOpen: boolean;
  onToggleDataNotes(): void;
  printLink: string;
}) {
  const skipped = formatSkippedRows(meta.skippedRows);
  return (
    <header className="app-header">
      <h1>Inbound call performance</h1>
      <div className="row small muted">
        {meta.span && <span>{`Data as of ${formatLongDate(meta.span.end)}`}</span>}
        {skipped !== null && <span>{skipped}</span>}
        {/* A plain link, not the in-app Link: it opens the print page in a new tab and the app stays open here. */}
        <a href={printLink} target="_blank" rel="noopener">
          Print summary
        </a>
        {dev && (
          <button id={DATA_NOTES_BUTTON_ID} type="button" className="button" aria-pressed={dataNotesOpen} onClick={onToggleDataNotes}>
            Data notes
          </button>
        )}
      </div>
    </header>
  );
}
