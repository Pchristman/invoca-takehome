import { useEffect, useState } from 'react';
import type { DataNotesResponse, Meta } from '../server/api';
import type { DateRange } from '../core/ranges';
import type { CampaignsView as CampaignsData, OverviewView as OverviewData } from '../core/views';
import { CampaignsView } from './components/CampaignsView';
import { ComingSoon } from './components/ComingSoon';
import { DataNotesPanel } from './components/DataNotesPanel';
import { OverviewView } from './components/OverviewView';
import { DATA_NOTES_BUTTON_ID, Header } from './components/Header';
import { Nav, VIEW_LABELS } from './components/Nav';
import { RangeControl } from './components/RangeControl';
import { RequestFrame } from './components/RequestFrame';
import { dataNotesModel } from './models/dataNotesModel';
import { screenFor } from './models/screen';
import { useApi } from './useApi';
import { useUrlState } from './useUrlState';
import { apiParams, defaultsHref, withCampaign, withRange } from './urlState';
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
  const [dataNotesToggled, setDataNotesToggled] = useState(false);
  const dataNotesOpen = state.dev && dataNotesToggled; // without ?dev there is no panel, whatever the state says
  const hasView = state.view === 'overview' || state.view === 'campaigns';
  const view = useApi<unknown>(hasView ? `/api/${state.view}` : null, apiParams(state, state.view));
  const closeDataNotes = () => {
    setDataNotesToggled(false);
    document.getElementById(DATA_NOTES_BUTTON_ID)?.focus();
  };

  useEffect(() => {
    if (!dataNotesOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDataNotesToggled(false);
      document.getElementById(DATA_NOTES_BUTTON_ID)?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dataNotesOpen]);

  const rangeError = view.state?.status === 'failed' ? view.state.error : null;

  return (
    <>
      <Header meta={meta} dev={state.dev} dataNotesOpen={dataNotesOpen} onToggleDataNotes={() => setDataNotesToggled((open) => !open)} />
      {dataNotesOpen && <DataNotes resetHref={resetHref} onClose={closeDataNotes} />}
      <Nav state={state} />
      <RangeControl state={state} meta={meta} error={rangeError} onChange={(range) => navigate(withRange(state, range))} />
      {hasView && meta.span !== null ? (
        <RequestFrame state={view.state} loadingLabel="Loading this view..." resetHref={resetHref} onRetry={view.retry}>
          {(data) =>
            state.view === 'overview' ? (
              <OverviewView view={data as OverviewData} state={state} span={meta.span as DateRange} />
            ) : (
              <CampaignsView
                view={data as CampaignsData}
                state={state}
                span={meta.span as DateRange}
                onSelectCampaign={(id) => navigate(withCampaign(state, id))}
              />
            )
          }
        </RequestFrame>
      ) : (
        <ComingSoon view={VIEW_LABELS[state.view]} />
      )}
    </>
  );
}

// Mounted only while the panel is open, so /api/data-notes is requested only then (and only with ?dev).
function DataNotes({ resetHref, onClose }: { resetHref: string; onClose(): void }) {
  const notes = useApi<DataNotesResponse>('/api/data-notes', NO_PARAMS);
  return (
    <RequestFrame state={notes.state} loadingLabel="Loading data notes..." resetHref={resetHref} onRetry={notes.retry}>
      {(data) => <DataNotesPanel sections={dataNotesModel(data)} onClose={onClose} />}
    </RequestFrame>
  );
}
