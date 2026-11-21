import type { Meta } from '../../server/api';
import { formatLongDate, formatSkippedRows } from '../format';

/** The id App focuses when the data notes panel closes. */
export const DATA_NOTES_BUTTON_ID = 'data-notes-button';
/** The id App focuses when the upload panel closes. */
export const UPLOAD_BUTTON_ID = 'upload-button';

export function Header({
  meta,
  dev,
  dataNotesOpen,
  onToggleDataNotes,
  printLink,
  uploadOpen = false,
  uploadLocked = false,
  onToggleUpload,
}: {
  meta: Meta;
  dev: boolean;
  dataNotesOpen: boolean;
  onToggleDataNotes(): void;
  printLink: string;
  uploadOpen?: boolean;
  /** A file is being written: the panel cannot be closed until it is done, from here or anywhere. */
  uploadLocked?: boolean;
  /** Without it there is no upload button. */
  onToggleUpload?: () => void;
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
        {onToggleUpload && (
          <button
            id={UPLOAD_BUTTON_ID}
            type="button"
            className="button"
            aria-pressed={uploadOpen}
            disabled={uploadLocked}
            onClick={onToggleUpload}
          >
            Upload data
          </button>
        )}
        {dev && (
          <button id={DATA_NOTES_BUTTON_ID} type="button" className="button" aria-pressed={dataNotesOpen} onClick={onToggleDataNotes}>
            Data notes
          </button>
        )}
      </div>
    </header>
  );
}
