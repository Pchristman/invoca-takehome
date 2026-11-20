import { useEffect, useRef, useState } from 'react';
import type { DataNotesResponse, Meta, TakeawayResponse } from '../server/api';
import type { DateRange } from '../core/ranges';
import type {
  CampaignsView as CampaignsData,
  LocationsView as LocationsData,
  MissedCallsView as MissedCallsData,
  OverviewView as OverviewData,
} from '../core/views';
import { CampaignsView } from './components/CampaignsView';
import { LocationsView } from './components/LocationsView';
import { MissedCallsView } from './components/MissedCallsView';
import { DataNotesPanel } from './components/DataNotesPanel';
import { OverviewView } from './components/OverviewView';
import { DATA_NOTES_BUTTON_ID, Header } from './components/Header';
import { Nav } from './components/Nav';
import { RangeControl } from './components/RangeControl';
import { RequestFrame } from './components/RequestFrame';
import { Takeaway } from './components/Takeaway';
import { dataNotesModel } from './models/dataNotesModel';
import { takeawayModel } from './models/takeawayModel';
import { shouldCloseDataNotes } from './models/escapeKey';
import { displayState } from './models/keepPrevious';
import { screenFor } from './models/screen';
import { useApi } from './useApi';
import { useUrlState } from './useUrlState';
import { apiParams, defaultsHref, withCampaign, withLocation, withRange } from './urlState';
import type { UrlState } from './urlState';

const NO_PARAMS = new URLSearchParams();

export function App() {
  const { state } = useUrlState();
  const meta = useApi<Meta>('/api/meta', NO_PARAMS);
  const resetHref = defaultsHref(state);
  const screen = screenFor(meta.state);

  return (
    <div className="page">
      {screen.screen === 'empty' && <EmptyScreen notes={screen.notes} />}
      {screen.screen === 'ready' && <ReadyShell state={state} meta={screen.meta} resetHref={resetHref} />}
      {(screen.screen === 'loading' || screen.screen === 'error') && (
        // Prints the loading message or the error; it never has data to show on these two screens.
        <RequestFrame state={meta.state} loadingLabel="Loading the data..." resetHref={resetHref} onRetry={meta.retry}>
          {() => null}
        </RequestFrame>
      )}
    </div>
  );
}

/** The export has no calls at all. */
export function EmptyScreen({ notes }: { notes: string[] }) {
  return (
    <section className="notice" role="status">
      <h1>Inbound call performance</h1>
      <p>This export has no calls</p>
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </section>
  );
}

function ReadyShell({ state, meta, resetHref }: { state: UrlState; meta: Meta; resetHref: string }) {
  const { navigate } = useUrlState();
  const [dataNotesToggled, setDataNotesToggled] = useState(false);
  const dataNotesOpen = state.dev && dataNotesToggled; // without ?dev there is no panel, whatever the state says
  const view = useApi<unknown>(`/api/${state.view}`, apiParams(state, state.view));
  // Its own request, so the view never waits on the takeaway. No data span, no request.
  const takeaway = useApi<TakeawayResponse>(meta.span === null ? null : `/api/takeaway/${state.view}`, apiParams(state, state.view));
  // The last reply that was ready, kept so a change of the chart's campaign does not unmount the screen.
  const lastReady = useRef<{ key: string; data: unknown } | null>(null);
  if (view.state?.status === 'ready') lastReady.current = { key: view.state.key, data: view.state.data };
  else if (view.state?.status === 'failed' || view.state === null) lastReady.current = null;
  const shown = displayState(lastReady.current, view.state);
  const closeDataNotes = () => {
    setDataNotesToggled(false);
    document.getElementById(DATA_NOTES_BUTTON_ID)?.focus();
  };

  useEffect(() => {
    if (!dataNotesOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const targetTag = target instanceof Element ? target.tagName : '';
      if (!shouldCloseDataNotes({ key: event.key, defaultPrevented: event.defaultPrevented, targetTag })) return;
      setDataNotesToggled(false);
      document.getElementById(DATA_NOTES_BUTTON_ID)?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dataNotesOpen]);

  const rangeError = view.state?.status === 'failed' ? view.state.error : null;
  const hasSpan = meta.span !== null;

  return (
    <>
      <Header meta={meta} dev={state.dev} dataNotesOpen={dataNotesOpen} onToggleDataNotes={() => setDataNotesToggled((open) => !open)} />
      {dataNotesOpen && <DataNotes resetHref={resetHref} onClose={closeDataNotes} />}
      <Nav state={state} />
      <RangeControl state={state} meta={meta} error={rangeError} onChange={(range) => navigate(withRange(state, range))} />
      {!hasSpan ? (
        <EmptyScreen notes={meta.notes} />
      ) : (
        <>
        <Takeaway show={takeawayModel(takeaway.state, { dev: state.dev })} />
        <RequestFrame state={shown.state} loadingLabel="Loading this view..." resetHref={resetHref} onRetry={view.retry}>
          {(data) =>
            state.view === 'overview' ? (
              <OverviewView view={data as OverviewData} state={state} span={meta.span as DateRange} />
            ) : state.view === 'campaigns' ? (
              <CampaignsView
                view={data as CampaignsData}
                state={state}
                span={meta.span as DateRange}
                chartBusy={shown.busy}
                onSelectCampaign={(id) => navigate(withCampaign(state, id))}
              />
            ) : state.view === 'locations' ? (
              <LocationsView view={data as LocationsData} state={state} span={meta.span as DateRange} />
            ) : (
              <MissedCallsView
                view={data as MissedCallsData}
                state={state}
                span={meta.span as DateRange}
                offices={meta.locations}
                busy={shown.busy}
                onSelectOffice={(id) => navigate(withLocation(state, id))}
              />
            )
          }
        </RequestFrame>
        </>
      )}
    </>
  );
}

// Mounted only while the panel is open, so /api/data-notes is requested only then (and only with ?dev).
function DataNotes({ resetHref, onClose }: { resetHref: string; onClose(): void }) {
  const notes = useApi<DataNotesResponse>('/api/data-notes', NO_PARAMS);
  const ready = notes.state?.status === 'ready';
  return (
    <>
      {!ready && ( // the ready panel has its own Close button; while loading or failed this one is the way out
        <button type="button" className="button" onClick={onClose}>
          Close data notes
        </button>
      )}
      <RequestFrame state={notes.state} loadingLabel="Loading data notes..." resetHref={resetHref} onRetry={notes.retry}>
        {(data) => <DataNotesPanel sections={dataNotesModel(data)} onClose={onClose} />}
      </RequestFrame>
    </>
  );
}
