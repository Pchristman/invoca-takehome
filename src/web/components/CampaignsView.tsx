import { useState } from 'react';
import type { DateRange } from '../../core/ranges';
import type { CampaignsView as CampaignsData } from '../../core/views';
import { caveatsFor } from '../models/caveats';
import { DEFAULT_SORT, campaignsModel, nextSort } from '../models/campaignsModel';
import { weeklyChartModel } from '../models/weeklyChart';
import type { UrlState } from '../urlState';
import { CampaignTable } from './CampaignTable';
import { Caveats } from './Caveats';
import { EstimateNote } from './EstimateNote';
import { WeeklyChart } from './WeeklyChart';

export function CampaignsView({
  view,
  span,
  onSelectCampaign,
}: {
  view: CampaignsData;
  state: UrlState;
  span: DateRange;
  onSelectCampaign(id: string): void;
}) {
  const [sort, setSort] = useState(DEFAULT_SORT);
  const model = campaignsModel(view, sort);
  const chart = weeklyChartModel(view.weekly);
  const caveats = caveatsFor(view.notes, span, { comparing: false, range: view.range });
  const trackingNumbers = model.unattributed?.trackingNumbers ?? [];

  return (
    <>
      <Caveats items={caveats} />
      <section className="section">
        <h2>Actions</h2>
        <ul>
          {model.actions.map((action) => (
            <li key={`${action.kind}-${action.text}`} className={action.actionable ? undefined : 'muted'}>
              {action.text}
              {action.kind === 'fix_attribution' && trackingNumbers.length > 0 && (
                <ul className="small">
                  {trackingNumbers.map((n) => (
                    <li key={n.text}>{n.text}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>
      <EstimateNote days={view.range.days} />
      <section className="section">
        <h2>Campaigns</h2>
        {model.empty ? (
          <p role="status">No calls in this range.</p>
        ) : (
          <CampaignTable model={model} sort={sort} onSort={(key) => setSort((current) => nextSort(current, key))} />
        )}
      </section>
      <section className="section">
        {model.chartChoices.length > 0 && (
          <label className="row small">
            Campaign for the weekly chart
            <select
              className="button"
              value={model.selectedCampaignId ?? ''}
              onChange={(event) => onSelectCampaign(event.target.value)}
            >
              {model.chartChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {chart !== null && <WeeklyChart model={chart} />}
      </section>
    </>
  );
}
