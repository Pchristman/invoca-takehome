import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Meta, TakeawayResponse, UploadCommitResponse } from '../server/api';
import type { ViewName } from '../core/views/facts';
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
import { OverviewView } from './components/OverviewView';
import { Header, UPLOAD_BUTTON_ID } from './components/Header';
import { UploadPanel } from './components/UploadPanel';
import { Nav } from './components/Nav';
import { RangeControl } from './components/RangeControl';
import { RequestFrame } from './components/RequestFrame';
import { PrintControls, PrintSummary } from './components/PrintSummary';
import { AnswerView } from './components/AnswerView';
import { AskBox } from './components/AskBox';
import { Takeaway } from './components/Takeaway';
import { canPrint, printModel } from './models/printModel';
import type { PrintTakeaways } from './models/printModel';
import { takeawayModel } from './models/takeawayModel';
import { Reveal, RevealPresence } from './components/Reveal';
import { ViewTransition } from './components/ViewTransition';
import { contentKey } from './models/motionVariants';
import { escapeMayClose, uploadLocked } from './models/escapeKey';
import type { UploadState } from './models/uploadModel';
import { ContentErrorFallback, ErrorBoundary } from './components/ErrorBoundary';
import { displayState } from './models/keepPrevious';
import { screenFor } from './models/screen';
import { useApi } from './useApi';
import { pushUrl, useUrlState } from './useUrlState';
import {
  apiParams,
  appHref,
  defaultsHref,
  printHref,
  printRequests,
  takeawayParams,
  withCampaign,
  withCampaignSort,
  withCompare,
  withHeatmap,
  withLocation,
  withLocationSort,
  withRange,
} from './urlState';
import type { UrlState } from './urlState';

const NO_PARAMS = new URLSearchParams();

export function App() {
  const { state } = useUrlState();
  const meta = useApi<Meta>('/api/meta', NO_PARAMS);
  const resetHref = defaultsHref(state);
  const screen = screenFor(meta.state);

  return (
    <div className="page">
      {screen.screen === 'empty' && <EmptyScreen notes={screen.notes} resetHref={resetHref} />}
      {screen.screen === 'ready' && !state.print && <ReadyShell state={state} meta={screen.meta} resetHref={resetHref} />}
      {screen.screen === 'ready' && state.print && <PrintShell state={state} meta={screen.meta} resetHref={resetHref} />}
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
export function EmptyScreen({ notes, resetHref, reload = reloadTo }: { notes: string[]; resetHref?: string; reload?: (href: string) => void }) {
  // Only the top-level empty screen has no header, so only it gets its own upload control.
  const upload = useUploadPanel(resetHref ?? '/', reload);
  return (
    <section className="notice">
      <h1>Inbound call performance</h1>
      {resetHref !== undefined && (
        <>
          <button
            id={UPLOAD_BUTTON_ID}
            type="button"
            className="button"
            aria-pressed={upload.open}
            disabled={upload.locked}
            onClick={upload.toggle}
          >
            Upload data
          </button>
          {upload.panel}
        </>
      )}
      {/* Only the message is a live region, so changes in the upload panel are not re-announced with it. */}
      <div role="status">
        <p>This export has no calls</p>
        {notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>
    </section>
  );
}

/** A full page load, so every number on the page is fetched fresh. */
function reloadTo(href: string): void {
  window.location.assign(href);
}

/**
 * The upload panel's open state. Closing after a write reloads the default view (the page still shows the old numbers);
 * a write that finishes after the panel was closed reloads when it finishes. While a file is being written
 * (locked) nothing closes the panel: not Close, not Escape, not the header toggle.
 * `meta` is the commit's own meta once rows were written, so "Data as of", the date limits and the pickers update at once.
 * It holds the page's one Escape listener: Escape closes the panel unless a file is being written.
 */
function useUploadPanel(
  resetHref: string,
  reload: (href: string) => void,
): { open: boolean; locked: boolean; toggle(): void; panel: ReactNode; meta: Meta | null } {
  const [open, setOpen] = useState(false); // not in the URL: a half-chosen file is not a screen to link to
  const [step, setStep] = useState<UploadState['step']>('choose');
  const [meta, setMeta] = useState<Meta | null>(null);
  const locked = open && uploadLocked(step);
  const openRef = useRef(false);
  const wrote = useRef(false);
  const close = () => {
    openRef.current = false;
    setOpen(false);
    if (wrote.current) reload(resetHref);
    else document.getElementById(UPLOAD_BUTTON_ID)?.focus();
  };
  const onWritten = (commit: UploadCommitResponse) => {
    if (commit.written === 0) return;
    wrote.current = true;
    setMeta(commit.meta);
    if (!openRef.current) reload(resetHref);
  };
  const toggle = () => {
    if (locked) return;
    if (openRef.current) return close();
    openRef.current = true;
    setOpen(true);
  };
  useEffect(() => {
    // Added again after each render, so it always sees the panel as it is now.
    const onKeyDown = (event: KeyboardEvent) => {
      const targetTag = event.target instanceof Element ? event.target.tagName : '';
      if (open && !locked && escapeMayClose({ key: event.key, defaultPrevented: event.defaultPrevented, targetTag })) close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });
  const panel = (
    <RevealPresence>
      {open && (
        <Reveal key="upload" kind="panel" id="upload">
          <UploadPanel resetHref={resetHref} onClose={close} onWritten={onWritten} onStep={setStep} />
        </Reveal>
      )}
    </RevealPresence>
  );
  return { open, locked, toggle, panel, meta };
}

function ReadyShell({ state, meta: loadedMeta, resetHref }: { state: UrlState; meta: Meta; resetHref: string }) {
  const { navigate } = useUrlState();
  const upload = useUploadPanel(resetHref, reloadTo);
  const meta = upload.meta ?? loadedMeta;
  const answering = state.answer !== null; // the answer page makes its own request, not the view's
  const view = useApi<unknown>(answering ? null : `/api/${state.view}`, apiParams(state, state.view));
  // Its own request, so the view never waits on the takeaway. No data span, no request.
  const takeaway = useApi<TakeawayResponse>(meta.span === null || answering ? null : `/api/takeaway/${state.view}`, takeawayParams(state, state.view));
  // The last reply that was ready, kept so a change of the chart's campaign does not unmount the screen.
  const lastReady = useRef<{ key: string; data: unknown } | null>(null);
  if (view.state?.status === 'ready') lastReady.current = { key: view.state.key, data: view.state.data };
  else if (view.state?.status === 'failed' || view.state === null) lastReady.current = null;
  const shown = displayState(lastReady.current, view.state);
  const rangeError = view.state?.status === 'failed' ? view.state.error : null;
  const hasSpan = meta.span !== null;
  const showAnswer = answering && hasSpan;

  return (
    <>
      <Header
        meta={meta}
        printLink={printHref(state)}
        uploadOpen={upload.open}
        uploadLocked={upload.locked}
        onToggleUpload={upload.toggle}
      />
      {upload.panel}
      <Nav state={state} />
      <AskBox meta={meta} state={state} onNavigate={(href) => pushUrl(href)} />
      {!showAnswer && (
        <RangeControl
          state={state}
          meta={meta}
          error={rangeError}
          onChange={(range) => navigate(withRange(state, range))}
          // Only Overview and Campaigns show a comparison, so only they offer one.
          onCompare={state.view === 'overview' || state.view === 'campaigns' ? (compare) => navigate(withCompare(state, compare)) : null}
        />
      )}
      <ViewTransition id={contentKey(state)}>
        {/* Inside the transition, so its key is the content key: a new view or range tries again. Nav and range control stay usable. */}
        <ErrorBoundary fallback={<ContentErrorFallback resetHref={resetHref} />}>
          {showAnswer ? (
            <AnswerView state={state} span={meta.span as DateRange} resetHref={resetHref} />
          ) : !hasSpan ? (
            <EmptyScreen notes={meta.notes} />
          ) : (
            <>
              <Takeaway show={takeawayModel(takeaway.state)} />
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
                      onSort={(sort) => navigate(withCampaignSort(state, sort))}
                    />
                  ) : state.view === 'locations' ? (
                    <LocationsView
                      view={data as LocationsData}
                      state={state}
                      span={meta.span as DateRange}
                      onSort={(sort) => navigate(withLocationSort(state, sort))}
                    />
                  ) : (
                    <MissedCallsView
                      view={data as MissedCallsData}
                      state={state}
                      span={meta.span as DateRange}
                      offices={meta.locations}
                      busy={shown.busy}
                      onSelectOffice={(id) => navigate(withLocation(state, id))}
                      onHeatmap={(mode) => navigate(withHeatmap(state, mode))}
                    />
                  )
                }
              </RequestFrame>
            </>
          )}
        </ErrorBoundary>
      </ViewTransition>
    </>
  );
}

/**
 * The one-page summary (?print): one overview and four takeaways, company-wide.
 * It has no header, nav or range control. The takeaway requests use each view's own name, never state.view.
 */
function PrintShell({ state, meta, resetHref }: { state: UrlState; meta: Meta; resetHref: string }) {
  const hasSpan = meta.span !== null; // no data span, no requests
  const [ov, tOverview, tCampaigns, tLocations, tMissed] = printRequests(state); // the list is tested in urlState.test.ts
  const overview = useApi<OverviewData>(hasSpan ? ov!.path : null, ov!.params);
  const takeaways: PrintTakeaways = {
    overview: useApi<TakeawayResponse>(hasSpan ? tOverview!.path : null, tOverview!.params).state,
    campaigns: useApi<TakeawayResponse>(hasSpan ? tCampaigns!.path : null, tCampaigns!.params).state,
    locations: useApi<TakeawayResponse>(hasSpan ? tLocations!.path : null, tLocations!.params).state,
    'missed-calls': useApi<TakeawayResponse>(hasSpan ? tMissed!.path : null, tMissed!.params).state,
  };
  const span = meta.span;
  return (
    <>
      <PrintControls canPrint={hasSpan && canPrint(overview.state, takeaways)} backHref={appHref(state)} />
      {span === null ? (
        <EmptyScreen notes={meta.notes} />
      ) : (
        <RequestFrame state={overview.state} loadingLabel="Loading the summary..." resetHref={resetHref} onRetry={overview.retry}>
          {(data) => <PrintSummary model={printModel({ view: data, meta, span, takeaways })} />}
        </RequestFrame>
      )}
    </>
  );
}
