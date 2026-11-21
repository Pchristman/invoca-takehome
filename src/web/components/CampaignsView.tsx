import type { DateRange } from '../../core/ranges';
import type { CampaignsView as CampaignsData } from '../../core/views';
import { caveatsFor } from '../models/caveats';
import { comparisonLine } from '../models/comparisonLine';
import { CAMPAIGN_TEXT_KEYS, DEFAULT_SORT, campaignsModel } from '../models/campaignsModel';
import type { CampaignSort } from '../models/campaignsModel';
import { nextSort } from '../models/sorting';
import { weeklyChartModel } from '../models/weeklyChart';
import type { UrlState } from '../urlState';
import { CampaignTable } from './CampaignTable';
import { Caveats } from './Caveats';
import { EstimateNote } from './EstimateNote';
import { WeeklyChart } from './WeeklyChart';

export function CampaignsView({
  view,
  state,
  span,
  chartBusy = false,
  onSelectCampaign,
  onSort,
}: {
  view: CampaignsData;
  state: UrlState;
  span: DateRange;
  chartBusy?: boolean; // the chart's campaign is changing; the rest is the last reply
  onSelectCampaign(id: string): void;
  onSort(sort: CampaignSort): void; // the sort lives in the URL, so it survives a range change
}) {
  const sort = state.campaignSort ?? DEFAULT_SORT;
  const model = campaignsModel(view, sort);
  const chart = weeklyChartModel(view.weekly);
  // caveatsFor shows the previous-period notes only when notes.comparison.available, so true is enough here.
  const caveats = caveatsFor(view.notes, span, { comparing: true, range: view.range, view: 'campaigns' });
  const line = comparisonLine(view.notes, view.range);
  const trackingNumbers = model.unattributed?.trackingNumbers ?? [];

  return (
    <>
      <Caveats items={caveats} />
      {line !== null && <p className="muted small">{line}</p>}
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
          <CampaignTable model={model} sort={sort} onSort={(key) => onSort(nextSort(sort, key, CAMPAIGN_TEXT_KEYS))} />
        )}
        {model.alertsRule !== null && (
          <details className="small">
            <summary>How alerts are decided</summary>
            <p>{model.alertsRule}</p>
          </details>
        )}
      </section>
      <section className="section" aria-busy={chartBusy ? 'true' : undefined}>
        {model.chartChoices.length > 0 && (
          <label className="row small">
            Campaign for the weekly chart
            <select
              className="button"
              value={state.campaign ?? model.selectedCampaignId ?? ''} // the URL first, so a new pick shows before its reply
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
        {chartBusy && (
          <p role="status" className="muted small">
            Updating chart…
          </p>
        )}
        {chart !== null && <WeeklyChart model={chart} />}
      </section>
    </>
  );
}
