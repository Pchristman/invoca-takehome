import { useState } from 'react';
import type { Meta } from '../server/api';
import { ComingSoon } from './components/ComingSoon';
import { Header } from './components/Header';
import { Nav, VIEW_LABELS } from './components/Nav';
import { RangeControl } from './components/RangeControl';
import { RequestFrame } from './components/RequestFrame';
import { screenFor } from './models/screen';
import { useApi } from './useApi';
import { useUrlState } from './useUrlState';
import { apiParams, defaultsHref, withRange } from './urlState';
import type { UrlState } from './urlState';

const NO_PARAMS = new URLSearchParams();

export function App() {
  const { state } = useUrlState();
  const meta = useApi<Meta>('/api/meta', NO_PARAMS);
  const resetHref = defaultsHref(state);

  return (
    <div className="page">
      <RequestFrame state={meta.state} loadingLabel="Loading the data..." resetHref={resetHref} onRetry={meta.retry}>
        {(data) => <Shell state={state} meta={data} resetHref={resetHref} />}
      </RequestFrame>
    </div>
  );
}

// Everything after /api/meta has arrived.
function Shell({ state, meta, resetHref }: { state: UrlState; meta: Meta; resetHref: string }) {
  const screen = screenFor({ status: 'ready', key: '', data: meta });
  if (screen.screen === 'empty') {
    return (
      <section className="notice" role="status">
        <h1>Inbound call performance</h1>
        <p>There is no call data to show.</p>
        {screen.notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </section>
    );
  }
  if (screen.screen !== 'ready') return null; // loading and error are handled by the frame above
  return <ReadyShell state={state} meta={screen.meta} resetHref={resetHref} />;
}

function ReadyShell({ state, meta, resetHref }: { state: UrlState; meta: Meta; resetHref: string }) {
  const { navigate } = useUrlState();
  const [dataNotesOpen, setDataNotesOpen] = useState(false);
  const hasView = state.view === 'overview' || state.view === 'campaigns';
  const view = useApi<unknown>(hasView ? `/api/${state.view}` : null, apiParams(state, state.view));
  const rangeError = view.state?.status === 'failed' ? view.state.error : null;

  return (
    <>
      <Header meta={meta} dev={state.dev} dataNotesOpen={dataNotesOpen} onToggleDataNotes={() => setDataNotesOpen((open) => !open)} />
      <Nav state={state} />
      <RangeControl state={state} meta={meta} error={rangeError} onChange={(range) => navigate(withRange(state, range))} />
      {hasView ? (
        <RequestFrame state={view.state} loadingLabel="Loading this view..." resetHref={resetHref} onRetry={view.retry}>
          {() => <p className="muted section">View arrives in Task 9.</p>}
        </RequestFrame>
      ) : (
        <ComingSoon view={VIEW_LABELS[state.view]} />
      )}
    </>
  );
}
