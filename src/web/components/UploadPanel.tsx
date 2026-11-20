import { useEffect, useReducer, useRef } from 'react';
import { postUpload } from '../api';
import { shouldCloseUpload } from '../models/escapeKey';
import { INITIAL_UPLOAD, uploadModel, uploadReducer } from '../models/uploadModel';
import type { UploadState } from '../models/uploadModel';
import type { UploadCommitResponse } from '../../server/api';

/**
 * What the panel draws for a state. Prints the model; decides nothing.
 * Every piece of text from the file is a React child, so it is escaped.
 */
export function UploadPanelView({
  state,
  resetHref,
  onChoose,
  onConfirm,
  onReset,
  onClose,
}: {
  state: UploadState;
  resetHref: string;
  onChoose(file: File): void;
  onConfirm(): void;
  onReset(): void;
  onClose(): void;
}) {
  const view = uploadModel(state, resetHref);
  return (
    <aside className="notes-panel" role="complementary" aria-label="Upload data">
      <div className="row">
        <h2>{view.title}</h2>
        {/* While the file is being written the panel stays open, so the result is never lost. */}
        <button type="button" className="button" disabled={state.step === 'saving'} onClick={onClose}>
          Close
        </button>
      </div>
      {state.step === 'choose' && (
        <label>
          Choose a calls, campaigns or locations CSV file{' '}
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onChoose(file);
              event.target.value = ''; // so choosing the same file again fires again
            }}
          />
        </label>
      )}
      {view.busy !== null && <p role="status">{view.busy}</p>}
      {view.error !== null && <p role="alert">{view.error}</p>}
      {view.rows.length > 0 && (
        <dl className="notes-items">
          {view.rows.map((row) => (
            <div key={row.label} className="notes-item">
              <dt>{row.label}</dt>
              <dd>
                {row.count}
                {row.examples.length > 0 && (
                  <ul>
                    {row.examples.map((line, index) => (
                      <li key={`${index}-${line}`}>{line}</li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {view.badReasons.length > 0 && (
        <ul>
          {view.badReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {view.hints.length > 0 && (
        <ul>
          {view.hints.map((hint, index) => (
            <li key={`${index}-${hint}`}>{hint}</li>
          ))}
        </ul>
      )}
      {view.emptyMessage !== null && <p role="status">{view.emptyMessage}</p>}
      {view.canConfirm && (
        <button type="button" className="button" onClick={onConfirm}>
          {view.confirmLabel}
        </button>
      )}
      {view.done !== null && (
        <>
          <p role="status">{view.done}</p>
          {/* A plain link: a full page load, so the date span, pickers, views and takeaways are all fetched fresh. */}
          <a href={view.seeNewDataHref}>See the new data</a>
        </>
      )}
      {(state.step === 'preview' || state.step === 'error' || state.step === 'done') && (
        <button type="button" className="button" onClick={onReset}>
          Choose another file
        </button>
      )}
    </aside>
  );
}

/** The panel with its steps: preview a chosen file, then post the same File again to confirm. */
export function UploadPanel({ resetHref, onClose, onWritten }: { resetHref: string; onClose(): void; onWritten(written: number): void }) {
  const [state, dispatch] = useReducer(uploadReducer, INITIAL_UPLOAD);
  const file = useRef<File | null>(null); // the chosen File, kept out of the URL and out of storage
  const previewing = useRef<AbortController | null>(null);

  useEffect(() => () => previewing.current?.abort(), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const targetTag = event.target instanceof Element ? event.target.tagName : '';
      if (shouldCloseUpload({ key: event.key, defaultPrevented: event.defaultPrevented, targetTag, step: state.step })) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [state.step, onClose]);

  const choose = async (chosen: File) => {
    previewing.current?.abort();
    const controller = new AbortController();
    previewing.current = controller;
    file.current = chosen;
    dispatch({ type: 'choose', fileName: chosen.name });
    const result = await postUpload('preview', chosen, controller.signal);
    if (controller.signal.aborted) return;
    if (result.ok) dispatch({ type: 'previewed', preview: result.data.preview });
    else dispatch({ type: 'failed', message: result.error.message });
  };

  const confirm = async () => {
    const chosen = file.current;
    if (!chosen || state.step !== 'preview') return;
    dispatch({ type: 'confirm' });
    const result = await postUpload('commit', chosen);
    if (result.ok) {
      const commit = result.data as UploadCommitResponse;
      onWritten(commit.written); // told even if the panel was closed meanwhile, so the page still reloads
      dispatch({ type: 'committed', preview: commit.preview, written: commit.written, spanEnd: commit.meta.span?.end ?? null });
    }
    else dispatch({ type: 'failed', message: result.error.message });
  };

  const reset = () => {
    previewing.current?.abort();
    file.current = null;
    dispatch({ type: 'reset' });
  };

  return <UploadPanelView state={state} resetHref={resetHref} onChoose={choose} onConfirm={confirm} onReset={reset} onClose={onClose} />;
}
