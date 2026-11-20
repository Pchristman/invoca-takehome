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
        {
          ...second!,
          name: '<b>x</b>',
          previousCalls: 100,
          callsChange: { kind: 'percent', value: 60 },
          alert: { direction: 'jump', z: 5 },
        },
        ...rest,
      ],
      alerts: { checked: true, reason: null, flagged: 1, z: 3, minCalls: 20 },
    };
  };

  it('a flagged row shows the word "Calls dropped" and its change', () => {
    const html = render(flagged());
    expect(html).toContain('Calls dropped');
    expect(html).toContain('-60.0% (was 100)');
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
    // The flagged row carries the badge, so the escaped name and "Calls jumped" sit together.
    expect(html).toMatch(/&lt;b&gt;x&lt;\/b&gt;[^]*?Calls jumped/);
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
    // ?dev adds the Data notes button in the header; the Campaigns view must not carry it or its panel.
    const html = render(flagged());
    expect(html).not.toContain('Data notes');
    expect(html).not.toContain('data-notes');
  });
});

describe('Campaigns screen caveats for the comparison period', () => {
  const store = storeOverDates('2026-09-01', '2026-09-30');
  const span = dataSpan(store.calls)!;
  const renderFor = (search: string) =>
    renderToStaticMarkup(
      <CampaignsScreen view={campaignsFor(search, store)} state={parseUrlState('')} span={span} onSelectCampaign={noop} />,
    );

  it("says the comparison period includes the first day when it starts on the data's first day", () => {
    const html = renderFor('start=2026-09-11&end=2026-09-20');
    expect(html).toContain('<li>The comparison period includes the first day in the data, which may be incomplete.</li>');
  });

  it("says the comparison period includes the last day when it ends on the data's last day", () => {
    const html = renderFor('start=2026-09-11&end=2026-09-20&compareStart=2026-09-21&compareEnd=2026-09-30');
    expect(html).toContain('<li>The comparison period includes the last day in the data, which may be incomplete.</li>');
  });

  it('says the comparison period overlaps the selected range', () => {
    const html = renderFor('start=2026-09-11&end=2026-09-20&compareStart=2026-09-16&compareEnd=2026-09-25');
    expect(html).toContain('<li>The comparison period overlaps the selected range.</li>');
  });
});

describe('Campaigns screen in an outage (calls before, none now)', () => {
  const store = storeOverDates('2026-09-01', '2026-09-10');
  const outage = (): ReturnType<typeof campaignsFor> => {
    const view = campaignsFor('range=all', store);
    return {
      ...view,
      rows: view.rows.map((r) => ({
        ...r,
        calls: 0,
        previousCalls: 30,
        callsChange: { kind: 'percent' as const, value: -100 },
        alert: { direction: 'drop' as const, z: -5.5 },
      })),
      unattributed: null,
      alerts: { checked: true, reason: null, flagged: view.rows.length, z: 3, minCalls: 20 },
    };
  };

  it('keeps the table, the drop badge and the rule, and does not say there were no calls', () => {
    const html = renderToStaticMarkup(
      <CampaignsScreen view={outage()} state={parseUrlState('')} span={dataSpan(store.calls)!} onSelectCampaign={noop} />,
    );
    expect(html).not.toContain('No calls in this range.');
    expect(html).toContain('Booking rate');
    expect(html).toContain('Calls dropped');
    expect(html).toContain('How alerts are decided');
  });
});
