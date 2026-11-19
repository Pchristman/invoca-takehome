import { useState } from 'react';
import type { Meta } from '../../server/api';
import type { DateRange } from '../../core/ranges';
import type { MissedCallsView as MissedCallsData } from '../../core/views';
import type { MissedCallsModel } from '../models/missedCallsModel';
import { caveatsFor } from '../models/caveats';
import { heatmapModel } from '../models/heatmapModel';
import type { HeatmapMode } from '../models/heatmapModel';
import { pageKey } from '../models/pageKey';
import { missedCallsModel } from '../models/missedCallsModel';
import { csvHref } from '../urlState';
import type { UrlState } from '../urlState';
import { CallbackTable } from './CallbackTable';
import { Caveats } from './Caveats';
import { Heatmap } from './Heatmap';

export function MissedCallsView({
  view,
  state,
  span,
  offices,
  busy = false,
  onSelectOffice,
}: {
  view: MissedCallsData;
  state: UrlState;
  span: DateRange;
  offices: Meta['locations'];
  busy?: boolean; // the office is changing; the rest is the last reply
  onSelectOffice(id: string | null): void;
}) {
  const [mode, setMode] = useState<HeatmapMode>('office');
  // The page is remembered with the range and office it was chosen for: change either and it is page 1 again.
  const key = pageKey(view.range, state);
  const [chosen, setChosen] = useState({ key, page: 1 });
  const page = chosen.key === key ? chosen.page : 1;
  const model = missedCallsModel(view, span, page);
  const caveats = caveatsFor(view.notes, span, { comparing: false, range: view.range });

  return (
    <>
      <Caveats items={caveats} />
      <section className="section">
        <h2>Action</h2>
        <p className={model.action.actionable ? undefined : 'muted'}>{model.action.text}</p>
      </section>
      <section className="section" aria-busy={busy ? 'true' : undefined}>
        <label className="row small">
          Office
          <select
            className="button office-select"
            value={state.location ?? ''}
            onChange={(event) => onSelectOffice(event.target.value || null)}
          >
            <option value="">All offices</option>
            {offices.map((office) => (
              <option key={office.id} value={office.id}>
                {office.name}
              </option>
            ))}
          </select>
        </label>
        {model.filterLabel !== null && <p className="small">{model.filterLabel}</p>}
        {busy && (
          <p role="status" className="muted small">
            Updating…
          </p>
        )}
      </section>
      {model.noMissed !== null ? (
        <section className="section">
          <p role="status">{model.noMissed}</p>
          <p className="muted small">{model.limitNote}</p>
        </section>
      ) : (
        <MissedCallsBody
          view={view}
          state={state}
          model={model}
          busy={busy}
          mode={mode}
          onMode={setMode}
          onPage={(next) => setChosen({ key, page: next })}
        />
      )}
    </>
  );
}

function MissedCallsBody({
  view,
  state,
  model,
  busy,
  mode,
  onMode,
  onPage,
}: {
  view: MissedCallsData;
  state: UrlState;
  model: MissedCallsModel;
  busy: boolean;
  mode: HeatmapMode;
  onMode(mode: HeatmapMode): void;
  onPage(page: number): void;
}) {
  const heat = heatmapModel(view.heatmap, mode);
  const { callbacks, lostValue } = model;

  return (
    <>
      <section className="section">
        <h2>Unanswered calls</h2>
        <p>{model.unanswered}</p>
      </section>
      <section className="section">
        <h2>When calls are missed</h2>
        <p className="muted small">Hours are local to each office.</p>
        {heat.empty ? (
          <p role="status">No missed calls to chart.</p>
        ) : (
          <Heatmap model={heat} mode={mode} onModeChange={onMode} />
        )}
      </section>
      <section className="section">
        <h2>{lostValue.label}</h2>
        <p>
          <strong>{lostValue.value}</strong>
        </p>
        <p className="muted small">{lostValue.note}</p>
        {lostValue.sources.length > 0 && (
          <ul className="small">
            {lostValue.sources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        )}
        <details>
          <summary>How this estimate works</summary>
          <p className="small">{lostValue.formula}</p>
        </details>
      </section>
      <section className="section">
        <h2>Call-back list</h2>
        <p>{callbacks.summary}</p>
        {model.unidentifiedNote !== null && <p className="muted small">{model.unidentifiedNote}</p>}
        {callbacks.emptyNote !== null ? (
          <p role="status">{callbacks.emptyNote}</p>
        ) : (
          <CallbackTable model={callbacks} onPage={onPage} />
        )}
        {callbacks.canDownload && !busy && (
          <p>
            <a className="button" href={csvHref(state)} download>
              Download CSV
            </a>{' '}
            <span className="muted small">{callbacks.downloadNote}</span>
          </p>
        )}
        <p className="muted small">{model.reachNote}</p>
        <p className="muted small">{model.limitNote}</p>
      </section>
    </>
  );
}
