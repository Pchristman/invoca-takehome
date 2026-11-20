// Render tests for the Campaigns screen and the weekly chart: the empty-range sentence replaces the table,
// and the partial-week legend shows only when a week is partial. Data comes from the real view builders.
// Recharts draws nothing under Node (no layout), but the legend and the hidden table sit outside the chart.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { dataSpan } from '../../src/core/ranges';
import { CampaignsView as CampaignsScreen } from '../../src/web/components/CampaignsView';
import { WeeklyChart } from '../../src/web/components/WeeklyChart';
import { weeklyChartModel } from '../../src/web/models/weeklyChart';
import { parseUrlState } from '../../src/web/urlState';
import { serverFixture } from '../server/helpers';
import { campaignsFor, emptyRangeStore, storeOverDates } from './fixtures';

const noop = () => undefined;
const LEGEND = 'Hatched bars are partial weeks.';

function chartHtml(search: string, store?: Parameters<typeof campaignsFor>[1]): string {
  const model = weeklyChartModel(campaignsFor(search, store).weekly);
  if (model === null) throw new Error('expected a weekly chart');
  return renderToStaticMarkup(<WeeklyChart model={model} />);
}

describe('WeeklyChart legend', () => {
  it('shows "Hatched bars are partial weeks." when a week is partial', () => {
    const html = chartHtml('range=all'); // serverFixture: first and last week cut by the data
    expect(html).toContain(LEGEND);
    // The hidden table says which weeks, in words, for people who cannot see the hatching.
    expect(html).toContain('<th scope="row">Aug 31 – Sep 6</th>');
    expect(html).toContain('<td>partial week</td>');
  });

  it('leaves the legend out when every week is whole', () => {
    const html = chartHtml('start=2026-09-07&end=2026-09-20', storeOverDates('2026-09-01', '2026-09-30'));
    expect(html).not.toContain(LEGEND);
    expect(html).not.toContain('partial week');
    expect(html).toContain('<th scope="row">Sep 7 – Sep 13</th>');
  });
});

describe('Campaigns screen on an empty range', () => {
  const store = emptyRangeStore();
  const view = campaignsFor('start=2026-09-10&end=2026-09-20', store);
  const span = dataSpan(store.calls)!;
  const html = renderToStaticMarkup(
    <CampaignsScreen view={view} state={parseUrlState('')} span={span} onSelectCampaign={noop} />,
  );

  it('says "No calls in this range." and draws no campaign table', () => {
    expect(view.rows.every((r) => r.calls === 0)).toBe(true);
    expect(html).toContain('No calls in this range.');
    // The campaign table has the Campaign column header; the weekly chart's hidden table has Week.
    expect(html).not.toContain('<th scope="col">Campaign</th>');
    expect(html).not.toContain('Booking rate');
    // What is left is the chart's own hidden table.
    expect(html.match(/<table/g)?.length ?? 0).toBe(1);
    expect(html).toContain('<th scope="col">Week</th>');
  });

  it('draws the campaign table when there are calls', () => {
    const full = campaignsFor('range=all');
    const withCalls = renderToStaticMarkup(
      <CampaignsScreen view={full} state={parseUrlState('')} span={dataSpan(serverFixture().calls)!} onSelectCampaign={noop} />,
    );
    expect(withCalls).not.toContain('No calls in this range.');
    expect(withCalls).toContain('Booking rate');
    expect(withCalls.match(/<table/g)?.length).toBe(2);
  });
});

describe('Campaigns screen alerts', () => {
  const span = dataSpan(serverFixture().calls)!;
  const real = campaignsFor('range=all');
  const render = (view: typeof real) =>
    renderToStaticMarkup(<CampaignsScreen view={view} state={parseUrlState('')} span={span} onSelectCampaign={noop} />);
  /** A hand-built comparison: the first row dropped, the second is named like markup. */
  const flagged = (): typeof real => {
    const [first, second, ...rest] = real.rows;
    return {
      ...real,
      rows: [
        { ...first!, previousCalls: 100, callsChange: { kind: 'percent', value: -60 }, alert: { direction: 'drop', z: -5 } },
        { ...second!, name: '<b>x</b>', previousCalls: 5, callsChange: { kind: 'new' } },
        ...rest,
      ],
      alerts: { checked: true, reason: null, flagged: 1, z: 3, minCalls: 20 },
    };
  };

  it('a flagged row shows the word "Calls dropped" and its change', () => {
    const html = render(flagged());
    expect(html).toContain('Calls dropped');
    expect(html).toContain('-60.0% (was 100)');
    expect(html).not.toContain('Calls jumped');
  });

  it('shows the details block with the rule, and no all-clear note when something is flagged', () => {
    const view = flagged();
    const html = render(view);
    expect(html).toContain('How alerts are decided');
    expect(html).toContain('fewer than 20 calls across both periods');
    expect(html).not.toContain('by more than chance explains.</p>');
  });

  it('a name with markup is escaped in the row and the badge', () => {
    const html = render(flagged());
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });

  it('an unavailable comparison shows a dash, the reason hidden, and the note; no rule', () => {
    expect(real.alerts.checked).toBe(false);
    const html = render(real);
    const reason = real.alerts.reason!;
    expect(html).toContain('<td class="num"><span title=');
    expect(html).toContain(`<span class="visually-hidden"> ${reason.replace(/'/g, '&#x27;')}</span>`);
    expect(html).toContain(`<p class="muted small">${reason.replace(/'/g, '&#x27;')}</p>`);
    expect(html).not.toContain('How alerts are decided');
  });

  it('shows the all-clear when checked and nothing is flagged', () => {
    const html = render({ ...real, alerts: { checked: true, reason: null, flagged: 0, z: 3, minCalls: 20 } });
    expect(html).toContain("No campaign&#x27;s calls changed by more than chance explains.");
  });

  it('has no dev-only content', () => {
    expect(render(flagged())).not.toContain('dev');
  });
});
