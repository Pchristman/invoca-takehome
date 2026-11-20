// Render the dumb components to a string (no browser, no DOM) and assert on the markup.
// Covers what a model test cannot: that the component prints the model, and that dev-only things are absent.
// Data comes from the real view builders (tests/web/fixtures.ts). Where a fixture lacks a case, the test says
// how it builds it: another store, or a hand-edited copy of real JSON view data.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  CampaignsView,
  LocationsView as LocationsData,
  MissedCallsView as MissedCallsData,
  OverviewView as OverviewData,
} from '../../src/core/views';
import { dataSpan } from '../../src/core/ranges';
import type { DateRange } from '../../src/core/ranges';
import type { Meta } from '../../src/server/api';
import type { ClientError } from '../../src/web/api';
import { EmptyScreen } from '../../src/web/App';
import { CampaignTable } from '../../src/web/components/CampaignTable';
import { CampaignsView as CampaignsScreen } from '../../src/web/components/CampaignsView';
import { Caveats } from '../../src/web/components/Caveats';
import { DataNotesPanel } from '../../src/web/components/DataNotesPanel';
import { EstimateNote } from '../../src/web/components/EstimateNote';
import { CallbackTable } from '../../src/web/components/CallbackTable';
import { Header } from '../../src/web/components/Header';
import { Heatmap } from '../../src/web/components/Heatmap';
import { LocationTable, LocationsView as LocationsScreen } from '../../src/web/components/LocationsView';
import { MissedCallsView as MissedCallsScreen } from '../../src/web/components/MissedCallsView';
import { Nav } from '../../src/web/components/Nav';
import { OverviewView } from '../../src/web/components/OverviewView';
import { ErrorBoundary, ErrorFallback } from '../../src/web/components/ErrorBoundary';
import { RangeControl } from '../../src/web/components/RangeControl';
import { RequestFrame } from '../../src/web/components/RequestFrame';
import { WeeklyChart } from '../../src/web/components/WeeklyChart';
import { BLANK } from '../../src/web/format';
import { DEFAULT_SORT, campaignsModel } from '../../src/web/models/campaignsModel';
import type { CampaignSort } from '../../src/web/models/campaignsModel';
import { caveatsFor } from '../../src/web/models/caveats';
import { heatmapModel } from '../../src/web/models/heatmapModel';
import type { HeatmapMode } from '../../src/web/models/heatmapModel';
import { DEFAULT_LOCATION_SORT, locationsModel } from '../../src/web/models/locationsModel';
import type { LocationSort } from '../../src/web/models/locationsModel';
import { missedCallsModel } from '../../src/web/models/missedCallsModel';
import { weeklyChartModel } from '../../src/web/models/weeklyChart';
import { estimateFormulas } from '../../src/web/models/estimates';
import type { RequestState } from '../../src/web/requestState';
import { actionHref, csvHref, parseUrlState } from '../../src/web/urlState';
import {
  campaignsFor,
  idleOfficeStore,
  locationsFor,
  metaFor,
  missedCallsFor,
  overviewFor,
  plantedStore,
  storeWithNames,
  storeWithZeroBudget,
} from './fixtures';
import { serverFixture } from '../server/helpers';

const noop = () => undefined;

/** What React writes for text and attribute values, so expected strings can be searched for in markup. */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Every <tr>...</tr> in the markup, in order. */
function rowsOf(html: string): string[] {
  return html.match(/<tr[ >].*?<\/tr>/g) ?? [];
}

const fixtureStore = serverFixture();
const meta: Meta = metaFor(fixtureStore);
const span: DateRange = dataSpan(fixtureStore.calls)!;
const plainState = parseUrlState('');

describe('Header', () => {
  const render = (m: Meta, dev: boolean) =>
    renderToStaticMarkup(<Header meta={m} dev={dev} dataNotesOpen={false} onToggleDataNotes={noop} />);
  // Hand-edited copy of real meta: a span ending 2026-10-29.
  const october: Meta = { ...meta, span: { start: '2026-10-01', end: '2026-10-29' } };

  it('without dev has no data notes entry, with dev has the button', () => {
    const off = render(meta, false);
    expect(off).not.toContain('Data notes');
    expect(off).not.toContain('<button');
    const on = render(meta, true);
    expect(on).toContain('<button');
    expect(on).toContain('Data notes');
  });

  it('prints the as-of date from the end of the span', () => {
    expect(render(october, false)).toContain('Data as of Oct 29, 2026');
  });

  it('says how many rows were skipped, and nothing when none', () => {
    expect(render({ ...october, skippedRows: 12 }, false)).toContain('12 rows skipped');
    expect(render({ ...october, skippedRows: 0 }, false)).not.toMatch(/skipped/i);
  });
});

describe('Nav', () => {
  const links = (html: string) => [...html.matchAll(/<a href="([^"]*)"([^>]*)>([^<]*)<\/a>/g)];

  it('has four links in order and marks only the current view', () => {
    const found = links(renderToStaticMarkup(<Nav state={parseUrlState('?view=campaigns')} />));
    expect(found.map((m) => m[3])).toEqual(['Overview', 'Campaigns', 'Locations', 'Missed calls']);
    expect(found.map((m) => (m[2] ?? '').includes('aria-current="page"'))).toEqual([false, true, false, false]);
  });

  it('keeps dev on every link', () => {
    const found = links(renderToStaticMarkup(<Nav state={parseUrlState('?view=campaigns&dev')} />));
    expect(found).toHaveLength(4);
    for (const m of found) expect((m[1] ?? '').endsWith('&amp;dev') || m[1] === '/?dev').toBe(true);
  });

  it('does not carry dev when dev is off', () => {
    const html = renderToStaticMarkup(<Nav state={plainState} />);
    expect(html).not.toContain('dev');
  });
});

describe('RequestFrame', () => {
  const frame = (state: RequestState<string> | null) =>
    renderToStaticMarkup(
      <RequestFrame state={state} loadingLabel="Loading things" resetHref="/?reset" onRetry={noop}>
        {(data) => <p>{`ready: ${data}`}</p>}
      </RequestFrame>,
    );
  const failed = (error: ClientError): RequestState<string> => ({ status: 'failed', key: 'k', error });

  it('null and loading show a status with the label', () => {
    for (const state of [null, { status: 'loading', key: 'k' } as const]) {
      const html = frame(state);
      expect(html).toContain('role="status"');
      expect(html).toContain('Loading things');
    }
  });

  it('a 400 shows the server message and Reset, with no Try again', () => {
    const html = frame(failed({ code: 'bad_date', message: 'Start date is not a date.', field: 'start', status: 400 }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Start date is not a date.');
    expect(html).toContain('href="/?reset"');
    expect(html).toContain('Reset to defaults');
    expect(html).not.toContain('Try again');
  });

  it('a network failure shows Try again and no Reset', () => {
    const html = frame(failed({ code: 'network', message: 'Could not reach the API.' }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Try again');
    expect(html).not.toContain('Reset to defaults');
    expect(html).not.toContain('href=');
  });

  it('ready renders the children output only', () => {
    const html = frame({ status: 'ready', key: 'k', data: 'abc' });
    expect(html).toBe('<p>ready: abc</p>');
  });
});

describe('RangeControl', () => {
  const render = (search: string, error: ClientError | null = null, m: Meta = meta) =>
    renderToStaticMarkup(<RangeControl state={parseUrlState(search)} meta={m} error={error} onChange={noop} onCompare={noop} />);

  it('marks the default preset pressed and the others not', () => {
    const html = render('');
    expect(meta.defaultPreset).toBe('last28');
    expect(html).toMatch(/aria-pressed="true">Last 28 days</);
    expect(html).toMatch(/aria-pressed="false">Last 7 days</);
    expect(html).toMatch(/aria-pressed="false">All data</);
    expect(count(html, 'aria-pressed="true"')).toBe(1);
  });

  it('marks the preset from the URL', () => {
    const html = render('?range=last7');
    expect(html).toMatch(/aria-pressed="true">Last 7 days</);
    expect(count(html, 'aria-pressed="true"')).toBe(1);
  });

  it('carries min and max from the data span on every date input', () => {
    const inputs = render('').match(/<input[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(4);
    for (const input of inputs) {
      expect(input).toContain(`min="${meta.span!.start}"`);
      expect(input).toContain(`max="${meta.span!.end}"`);
    }
  });

  it('disables Apply with blank dates and enables it with both dates', () => {
    expect(render('')).toMatch(/<button[^>]*disabled=""[^>]*>Apply</);
    const custom = render('?start=2026-09-01&end=2026-09-05');
    expect(custom).toMatch(/<button(?![^>]*disabled)[^>]*>Apply</);
    expect(custom).toContain('value="2026-09-01"');
  });

  it('shows a range error as plain text (the frame owns the alert) only for a range field', () => {
    const html = render('?start=2026-09-01&end=2026-09-05', { code: 'bad_date', message: 'Start date is not a date.', field: 'start' });
    expect(html).toMatch(/<p class="range-error">Start date is not a date\.<\/p>/);
    expect(html).not.toContain('role="alert"');
    const other = render('', { code: 'unknown_campaign', message: 'No such campaign.', field: 'campaign' });
    expect(other).not.toContain('range-error');
    expect(render('')).not.toContain('range-error');
  });

  it('a URL date that is not a date never seeds the inputs and keeps Apply disabled', () => {
    const html = render('?start=nope&end=2026-09-05');
    expect(html).not.toContain('nope');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Apply</);
    expect(render('?start=2026-02-30&end=2026-09-05')).toMatch(/<button[^>]*disabled=""[^>]*>Apply</);
  });
});

describe('RangeControl comparison range', () => {
  const render = (search: string, error: ClientError | null = null) =>
    renderToStaticMarkup(<RangeControl state={parseUrlState(search)} meta={meta} error={error} onChange={noop} onCompare={noop} />);
  const COMPARE = '?start=2026-09-08&end=2026-09-14&compareStart=2026-09-01&compareEnd=2026-09-07';
  const groupOf = (html: string) => html.slice(html.indexOf('aria-label="Comparison range"'));

  it('has the group label, both labelled inputs with min and max from the span, and the Compare button', () => {
    const html = render('');
    expect(html).toContain('aria-label="Comparison range"');
    expect(html).toContain('Compare start date');
    expect(html).toContain('Compare end date');
    expect(html).toMatch(/<button[^>]*>Compare</);
    const inputs = groupOf(html).match(/<input[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input).toContain(`min="${meta.span!.start}"`);
      expect(input).toContain(`max="${meta.span!.end}"`);
    }
  });

  it('shows Use previous period only when a second range is set', () => {
    expect(render('')).not.toContain('Use previous period');
    expect(render(COMPARE)).toMatch(/<button[^>]*>Use previous period</);
  });

  it('fills the inputs from the URL', () => {
    const inputs = groupOf(render(COMPARE));
    expect(inputs).toContain('value="2026-09-01"');
    expect(inputs).toContain('value="2026-09-07"');
  });

  it('a garbage second range shows blank inputs and never the raw text', () => {
    const html = render('?compareStart=banana');
    expect(html).not.toContain('banana');
    expect(groupOf(html)).not.toContain('value="2');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Compare</);
  });

  it('disables Compare until both inputs hold real dates', () => {
    expect(render('')).toMatch(/<button[^>]*disabled=""[^>]*>Compare</);
    expect(render(COMPARE)).toMatch(/<button(?![^>]*disabled)[^>]*>Compare</);
  });

  it('shows the server message once for a compare field, not for another field', () => {
    const message = 'Comparison range: the start date is after the end date.';
    const html = render(COMPARE, { code: 'bad_date', message, field: 'compareEnd' });
    expect(count(html, message)).toBe(1);
    const other = render(COMPARE, { code: 'unknown_campaign', message, field: 'campaign' });
    expect(other).not.toContain(message);
  });

  it('has no dev-only content', () => {
    expect(render(`${COMPARE}&dev`)).toBe(render(COMPARE));
  });
});

describe('ErrorBoundary', () => {
  it('the fallback is a plain sentence with a Reload button', () => {
    const html = renderToStaticMarkup(<ErrorFallback />);
    expect(html).toContain('Something went wrong showing this page. Reload to try again.');
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/<button[^>]*>Reload</);
  });

  it('a render error moves it to the failed state', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
  });
});

describe('RequestFrame with an unknown error code', () => {
  it('shows generic copy and the server message, with Try again', () => {
    const html = renderToStaticMarkup(
      <RequestFrame
        state={{ status: 'failed', key: 'k', error: { code: 'rate_limited' as never, message: 'Slow down.', status: 429 } }}
        loadingLabel="x"
        resetHref="/"
        onRetry={noop}
      >
        {() => null}
      </RequestFrame>,
    );
    expect(html).toContain('Something went wrong');
    expect(html).toContain('Slow down.');
    expect(html).toContain('Try again');
  });
});

describe('Caveats', () => {
  it('prints each item and nothing for none', () => {
    const html = renderToStaticMarkup(
      <Caveats items={[{ id: 'first_day', text: 'First note.' }, { id: 'last_day', text: 'Second note.' }]} />,
    );
    expect(html).toContain('First note.');
    expect(html).toContain('Second note.');
    expect(count(html, '<li')).toBe(2);
    expect(renderToStaticMarkup(<Caveats items={[]} />)).toBe('');
  });
});

describe('EstimateNote', () => {
  it('is a details with all three formulas and the day count', () => {
    const html = renderToStaticMarkup(<EstimateNote days={14} />);
    expect(html).toMatch(/^<details/);
    const formulas = estimateFormulas(14);
    expect(formulas).toHaveLength(3);
    expect(count(html, '<li')).toBe(3);
    for (const f of formulas) expect(html).toContain(esc(f.formula));
    expect(html).toContain('14 days');
  });
});

describe('OverviewView comparison line and per-day caveat', () => {
  const render = (search: string) =>
    renderToStaticMarkup(<OverviewView view={overviewFor(search)} state={plainState} span={span} />);
  const PER_DAY = 'compare per day.';

  it('names both ranges and shows the per-day caveat once when the lengths differ', () => {
    const html = render('start=2026-09-08&end=2026-09-10&compareStart=2026-09-01&compareEnd=2026-09-02');
    expect(count(html, 'Comparing Sep 8 – Sep 10, 2026 with Sep 1 – Sep 2, 2026.')).toBe(1);
    expect(count(html, PER_DAY)).toBe(1);
    expect(html).toContain('was 4 in 2 days');
    expect(html).toContain('Not compared across different lengths');
    expect(html).not.toMatch(/undefined|NaN/);
  });

  it('shows the line but not the caveat for the default equal-length comparison', () => {
    const html = render('range=last7');
    expect(count(html, 'Comparing Sep 8 – Sep 14, 2026 with Sep 1 – Sep 7, 2026.')).toBe(1);
    expect(html).not.toContain(PER_DAY);
    expect(html).not.toMatch(/undefined|NaN/);
  });
});

describe('OverviewView', () => {
  const render = (view: OverviewData, state = plainState) =>
    renderToStaticMarkup(<OverviewView view={view} state={state} span={span} />);
  // Only the tile grid, so the reason sentence after it is not counted as part of the last tile.
  const tilesOf = (html: string) => html.split('</section>')[0]!.split('<div class="tile">').slice(1);

  it('shows five tiles', () => {
    expect(tilesOf(render(overviewFor('range=last7')))).toHaveLength(5);
  });

  it('with range=all each tile says no full previous period once, and the full reason shows once', () => {
    const view = overviewFor('range=all');
    const html = render(view);
    const tiles = tilesOf(html);
    expect(tiles).toHaveLength(5);
    for (const tile of tiles) expect(count(tile, 'No full previous period')).toBe(1);
    const reason = view.notes.comparison.reason!;
    expect(count(html, esc(reason))).toBe(1);
  });

  it('prints no change element on a tile whose change is none (hand-edited copy of real data)', () => {
    const real = overviewFor('range=last7');
    const view: OverviewData = { ...real, tiles: { ...real.tiles, calls: { ...real.tiles.calls, change: { kind: 'none' } } } };
    const [callsTile] = tilesOf(render(view));
    expect(callsTile).toContain('>Calls<');
    expect(callsTile).not.toContain('tone-');
    expect(callsTile).not.toContain('NaN');
  });

  it('a new change reads new (hand-edited copy of real data)', () => {
    const real = overviewFor('range=last7');
    const view: OverviewData = { ...real, tiles: { ...real.tiles, calls: { ...real.tiles.calls, change: { kind: 'new' } } } };
    const [callsTile] = tilesOf(render(view));
    expect(callsTile).toContain('tone-new');
    expect(callsTile).toContain('new (new)');
  });

  it('an empty range says there are no calls', () => {
    // A range with no calls in it, from the same store as the rest.
    const view = overviewFor('start=2026-09-01&end=2026-09-14');
    const empty: OverviewData = {
      ...view,
      tiles: { ...view.tiles, calls: { ...view.tiles.calls, current: 0 } },
    };
    expect(render(empty)).toContain('No calls in this range.');
    expect(render(view)).not.toContain('No calls in this range.');
  });

  it('lists the top actions in order, with hrefs from actionHref, muting the non-actionable', () => {
    const real = overviewFor('range=last7');
    expect(real.topActions).toHaveLength(3);
    // Hand edit: make the middle action non-actionable and the others actionable.
    const view: OverviewData = {
      ...real,
      topActions: real.topActions.map((item, i) => ({ ...item, action: { ...item.action, actionable: i !== 1 } })),
    };
    const state = parseUrlState('?range=last7&dev');
    const html = render(view, state);
    const section = html.slice(html.indexOf('<h2>Top actions</h2>'));
    const items = section.match(/<li[ >].*?<\/li>/g) ?? [];
    expect(items).toHaveLength(3);
    view.topActions.forEach((item, i) => {
      expect(items[i]).toContain(esc(item.action.text));
      expect(items[i]).toContain(`href="${esc(actionHref(state, item.action.link))}"`);
    });
    expect(items[0]).not.toContain('class="muted"');
    expect(items[1]).toMatch(/^<li class="muted"/);
    expect(items[2]).not.toContain('class="muted"');
  });
});

describe('CampaignTable', () => {
  const table = (view: CampaignsView, sort: CampaignSort = DEFAULT_SORT) =>
    renderToStaticMarkup(<CampaignTable model={campaignsModel(view, sort)} sort={sort} onSort={noop} />);
  // storeWithZeroBudget: a $0-budget campaign, a campaign with no bookings, and unattributed calls.
  const zeroBudget = campaignsFor('range=all', storeWithZeroBudget());
  const tbodyRows = (html: string) => rowsOf(html.slice(html.indexOf('<tbody>')));

  it('renders a blank cost cell as a dash with its note', () => {
    const html = table(zeroBudget);
    const free = tbodyRows(html).find((row) => row.includes('title="Free"'))!;
    expect(free).toBeDefined();
    const note = 'No estimate: this campaign has a $0 budget.';
    expect(free).toContain(`<span title="${note}">${BLANK}</span>`);
    expect(free).toContain(note); // the same words for a screen reader, not only the hover title
    const idle = tbodyRows(html).find((row) => row.includes('title="Idle"'))!;
    expect(idle).toContain('No estimate: no bookings in this range.');
  });

  it('pins the Unattributed row as the last tr of tbody whatever the sort', () => {
    for (const sort of [DEFAULT_SORT, { key: 'name', dir: 'desc' } as const, { key: 'calls', dir: 'asc' } as const]) {
      const rows = tbodyRows(table(zeroBudget, sort));
      expect(rows).toHaveLength(zeroBudget.rows.length + 1);
      expect(rows[rows.length - 1]).toContain('row-unattributed');
      expect(count(rows.join(''), 'row-unattributed')).toBe(1);
    }
  });

  it('shows the Unattributed row blanks as dashes, never infinity', () => {
    const rows = tbodyRows(table(zeroBudget));
    const last = rows[rows.length - 1];
    expect(last).toContain('Not applicable: no campaign, so no budget.');
    expect(last).toContain(BLANK);
  });

  it('puts aria-sort descending on the default sorted header and nowhere else', () => {
    const html = table(zeroBudget);
    expect(count(html, 'aria-sort=')).toBe(1);
    expect(html).toMatch(/<th[^>]*aria-sort="descending"[^>]*><button[^>]*>Calls<\/button>/);
    const byName = table(zeroBudget, { key: 'name', dir: 'asc' });
    expect(count(byName, 'aria-sort=')).toBe(1);
    expect(byName).toMatch(/<th[^>]*aria-sort="ascending"[^>]*><button[^>]*>Campaign<\/button>/);
  });

  it('shows Best and Worst as text and no note when something is marked (hand-edited copy)', () => {
    const rows = zeroBudget.rows.map((row, i) => ({
      ...row,
      isBest: i === 0,
      isWorst: i === zeroBudget.rows.length - 1,
    }));
    const html = table({ ...zeroBudget, rows, bestWorst: { eligible: 3, reason: null } });
    expect(html).toContain('>Best</span>');
    expect(html).toContain('>Worst</span>');
    expect(count(html, 'badge-best')).toBe(1);
    expect(count(html, 'badge-worst')).toBe(1);
    expect(html).not.toContain('No best or worst marked');
  });

  it('shows the reason with its prefix when nothing is marked (hand-edited reason)', () => {
    const reason = 'Fewer than two campaigns had enough calls.';
    const rows = zeroBudget.rows.map((row) => ({ ...row, isBest: false, isWorst: false }));
    const html = table({ ...zeroBudget, rows, bestWorst: { eligible: 0, reason } });
    expect(html).toContain(`No best or worst marked: ${reason}`);
    expect(html).not.toContain('badge-');
  });

  it('prints a 300-character unbroken name whole, in the cell and in title', () => {
    const long = 'x'.repeat(300);
    const html = table(campaignsFor('', storeWithNames([long, 'Short'])));
    expect(html).toContain(`title="${long}"`);
    expect(html).toContain(`>${long}</th>`);
    expect(html).not.toContain('…');
  });

  it('prints markup in a name as escaped text, never an element', () => {
    const name = '<img src=x onerror=alert(1)>';
    const html = table(campaignsFor('', storeWithNames([name, 'Short'])));
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror=alert(1)>'); // the raw tag end
  });

  it('labels every estimate column header est.', () => {
    const model = campaignsModel(zeroBudget, DEFAULT_SORT);
    const estimateColumns = model.columns.filter((c) => c.estimate);
    expect(estimateColumns.length).toBe(3);
    const head = table(zeroBudget).match(/<thead>.*<\/thead>/)![0];
    const headers = head.match(/<th[ >].*?<\/th>/g) ?? [];
    expect(headers).toHaveLength(model.columns.length);
    model.columns.forEach((column, i) => {
      expect(/est\./i.test(headers[i] ?? '')).toBe(column.estimate);
    });
  });

  it('never prints Infinity, NaN or undefined', () => {
    for (const view of [zeroBudget, campaignsFor('', storeWithNames(['A', 'B'])), campaignsFor('range=last7')]) {
      const html = table(view);
      expect(html).not.toMatch(/Infinity|NaN|undefined/);
    }
  });
});

describe('WeeklyChart', () => {
  const view = campaignsFor('range=all');

  it('prints the title and a visually-hidden table of the same weeks', () => {
    const chart = weeklyChartModel(view.weekly)!;
    expect(chart).not.toBeNull();
    // Recharts renders under Node (the ResponsiveContainer measures nothing, so it draws no bars);
    // the hidden table is the part the test can check.
    const html = renderToStaticMarkup(<WeeklyChart model={chart} />);
    const table = html.slice(html.indexOf('<table'));
    expect(table).toContain('class="visually-hidden"');
    expect(rowsOf(table)).toHaveLength(chart.bars.length + 1); // header row plus one per week
    for (const bar of chart.bars) expect(table).toContain(esc(bar.range));
  });

  it('prints a markup or very long campaign name as text in the title', () => {
    for (const name of ['<img src=x onerror=alert(1)>', 'y'.repeat(300)]) {
      const withName = campaignsFor('', storeWithNames([name, 'Short']));
      const chart = weeklyChartModel(withName.weekly)!;
      const html = renderToStaticMarkup(<WeeklyChart model={chart} />);
      expect(html).toContain(esc(name));
      expect(html).not.toContain('<img');
    }
  });

  it('is part of the Campaigns screen, with the picker listing names as text', () => {
    const name = '<img src=x onerror=alert(1)>';
    const withName = campaignsFor('', storeWithNames([name, 'Short']));
    const html = renderToStaticMarkup(
      <CampaignsScreen view={withName} state={parseUrlState('?view=campaigns')} span={span} onSelectCampaign={noop} />,
    );
    expect(html).toContain(`>${esc(name)}</option>`);
    expect(html).not.toContain('<img');
    expect(html).toContain('How the estimates work');
  });
});

describe('DataNotesPanel', () => {
  it('prints each section title and item, is a complementary region, and has a Close button', () => {
    const sections = [
      { title: 'First section', items: [{ label: 'Rows read', value: '1,234' }] },
      { title: 'Second section', items: [{ label: 'Skipped', value: 'None' }], list: ['a list entry'] },
    ];
    const html = renderToStaticMarkup(<DataNotesPanel sections={sections} onClose={noop} />);
    expect(html).toContain('role="complementary"');
    expect(html).toMatch(/<button[^>]*>Close<\/button>/);
    for (const section of sections) {
      expect(html).toContain(section.title);
      for (const item of section.items) {
        expect(html).toContain(item.label);
        expect(html).toContain(item.value);
      }
    }
    expect(html).toContain('a list entry');
  });
});

describe('Phase 7 review fixes (group C)', () => {
  const real = campaignsFor('range=all');
  const strip = (html: string) => html.replace(/<[^>]*>/g, '|').replace(/\|+/g, '|');

  it('puts each cell under its own header, whatever the column order', () => {
    const model = campaignsModel(real, DEFAULT_SORT);
    const reversed = { ...model, columns: [...model.columns].reverse() };
    const html = renderToStaticMarkup(<CampaignTable model={reversed} sort={DEFAULT_SORT} onSort={noop} />);
    const body = html.slice(html.indexOf('<tbody>'));
    const row = rowsOf(body)[0] ?? '';
    const cells = row.match(/<t[hd][ >].*?<\/t[hd]>/g) ?? [];
    expect(cells).toHaveLength(model.columns.length);
    const first = model.rows[0]!;
    reversed.columns.forEach((column, i) => {
      expect(strip(cells[i] ?? '')).toContain(esc(first.cells[column.key].text));
    });
    expect(cells[cells.length - 1]).toContain('<th scope="row"'); // the name column moved with its header
  });

  it('separates the Best and Worst badge from the name', () => {
    // Hand-edited copy of real data, as in the Best and Worst test above.
    const rows = real.rows.map((row, i) => ({ ...row, isBest: i === 0, isWorst: i === real.rows.length - 1 }));
    const marked = { ...real, rows, bestWorst: { eligible: 3, reason: null } };
    const html = renderToStaticMarkup(
      <CampaignTable model={campaignsModel(marked, DEFAULT_SORT)} sort={DEFAULT_SORT} onSort={noop} />,
    );
    expect(html).toContain('class="badge badge-');
    expect(html).not.toMatch(/[^\s>]<span class="badge/);
  });

  it('says there are no calls when every week is zero, and keeps the table', () => {
    const chart = weeklyChartModel(real.weekly)!;
    const zero = { ...chart, allZero: true, bars: chart.bars.map((bar) => ({ ...bar, calls: 0 })) };
    const html = renderToStaticMarkup(<WeeklyChart model={zero} />);
    expect(html).toContain('No calls in these weeks.');
    expect(html).toContain('visually-hidden');
    expect(renderToStaticMarkup(<WeeklyChart model={{ ...chart, allZero: false }} />)).not.toContain('No calls in these weeks.');
  });

  it('marks the chart section busy while the chart campaign updates', () => {
    const html = (busy: boolean) =>
      renderToStaticMarkup(
        <CampaignsScreen view={real} state={parseUrlState('?view=campaigns')} span={span} chartBusy={busy} onSelectCampaign={noop} />,
      );
    expect(html(true)).toContain('aria-busy="true"');
    expect(html(true)).toContain('Updating chart');
    expect(html(false)).not.toContain('aria-busy');
    expect(html(false)).not.toContain('Updating chart');
  });

  it('an empty export says it has no calls, in the words of the error screen', () => {
    const html = renderToStaticMarkup(<EmptyScreen notes={['A note.']} />);
    expect(html).toContain('This export has no calls');
    expect(html).toContain('A note.');
  });
});

describe('LocationTable', () => {
  const table = (view: LocationsData, sort: LocationSort = DEFAULT_LOCATION_SORT) =>
    renderToStaticMarkup(<LocationTable model={locationsModel(view, sort)} sort={sort} onSort={noop} />);
  const tbodyRows = (html: string) => rowsOf(html.slice(html.indexOf('<tbody>')));
  const rowFor = (html: string, name: string) => tbodyRows(html).find((row) => row.includes(`title="${name}"`))!;
  const renameFirst = (view: LocationsData, name: string): LocationsData => ({
    ...view,
    rows: view.rows.map((r, i) => (i === 0 ? { ...r, name } : r)),
  });
  const answerWorse = locationsFor('range=all', plantedStore('answer-worse'));
  // idleOfficeStore over its last week: loc_a has 7 calls (too few to test), loc_b and loc_c have none.
  const idle = locationsFor('start=2026-09-08&end=2026-09-14', idleOfficeStore());

  it('a worse flag prints a Worse badge and the flag text in words', () => {
    const html = table(answerWorse);
    const row = rowFor(html, 'Office A');
    expect(row).toContain('class="badge badge-worst">Worse</span>');
    expect(row).toContain('Answer rate worse: 30.0% here, 50.0% at other offices.');
    expect(count(html, 'badge-worst')).toBe(1);
    expect(html).not.toContain('Better');
  });

  it('a better flag prints a Better badge', () => {
    const html = table(locationsFor('range=all', plantedStore('better-only')));
    const row = rowFor(html, 'Office A');
    expect(row).toContain('class="badge badge-best">Better</span>');
    expect(row).toContain('Answer rate better: 70.0% here, 50.0% at other offices.');
    expect(html).not.toContain('Worse');
  });

  it('an office in line with the rest says so, with no badge', () => {
    const html = table(locationsFor('range=all', plantedStore('none')));
    expect(html).not.toContain('badge');
    expect(count(html, 'In line with other offices.')).toBe(3);
  });

  it('an office with no calls shows dashes with their notes, and the flag column says no calls', () => {
    const html = table(idle);
    expect(html).not.toMatch(/Infinity|NaN|undefined/);
    const row = rowFor(html, 'Office C');
    const note = 'No calls in this range.';
    expect(row).toContain(`<span title="${note}">${BLANK}</span>`);
    const cells = row.match(/<t[hd][ >].*?<\/t[hd]>/g) ?? [];
    expect(cells[cells.length - 1]).toContain(note); // the flag column
    expect(cells[2]).toContain(BLANK); // answer rate
  });

  it('an ineligible office reads Too few calls to compare.', () => {
    expect(rowFor(table(idle), 'Office A')).toContain('Too few calls to compare.');
  });

  it('sort headers are buttons, the default one has aria-sort descending, the flags header has none', () => {
    const head = table(answerWorse).match(/<thead>.*<\/thead>/)![0];
    const headers = head.match(/<th[ >].*?<\/th>/g) ?? [];
    expect(count(head, 'aria-sort=')).toBe(1);
    expect(head).toMatch(/<th[^>]*aria-sort="descending"[^>]*><button[^>]*>Calls<\/button>/);
    const flagsHeader = headers[headers.length - 1]!;
    expect(flagsHeader).toContain('Compared with other offices');
    expect(flagsHeader).not.toContain('aria-sort');
    expect(flagsHeader).not.toContain('<button');
    expect(count(head, '<button')).toBe(headers.length - 1);
    expect(table(answerWorse, { key: 'name', dir: 'asc' })).toMatch(
      /<th[^>]*aria-sort="ascending"[^>]*><button[^>]*>Office<\/button>/,
    );
  });

  it('prints a 300-character unbroken name whole, in the cell and in title', () => {
    const long = 'x'.repeat(300);
    const html = table(renameFirst(answerWorse, long));
    expect(html).toContain(`title="${long}"`);
    expect(html).toContain(`>${long}</th>`);
    expect(html).not.toContain('…');
  });

  it('prints markup in an office name as escaped text, never an element', () => {
    const html = table(renameFirst(answerWorse, '<img src=x onerror=alert(1)>'));
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror=alert(1)>');
  });
});

describe('LocationsView', () => {
  const render = (view: LocationsData, state = plainState, viewSpan = span) =>
    renderToStaticMarkup(<LocationsScreen view={view} state={state} span={viewSpan} />);
  const answerWorse = locationsFor('range=all', plantedStore('answer-worse'));

  it('prints the action text and a link to Missed calls for that office, keeping dev', () => {
    const action = answerWorse.actions[0]!;
    expect(action.link.locationId).toBe('loc_a');
    const state = parseUrlState('?view=locations&range=all');
    expect(actionHref(state, action.link)).toBe('/?view=missed-calls&range=all&location=loc_a');
    const html = render(answerWorse, state);
    expect(html).toContain(esc(action.text));
    expect(html).toContain(`href="${esc(actionHref(state, action.link))}"`);
    const dev = parseUrlState('?view=locations&range=all&dev');
    expect(actionHref(dev, action.link)).toContain('&dev');
    expect(render(answerWorse, dev)).toContain(`href="${esc(actionHref(dev, action.link))}"`);
  });

  it('an empty view says there are no calls and has no table', () => {
    // Hand-edited copy of real data: every office at zero calls.
    const empty = { ...answerWorse, rows: answerWorse.rows.map((r) => ({ ...r, calls: 0 })) };
    const html = render(empty);
    expect(html).toContain('No calls in this range.');
    expect(html).not.toContain('<table');
    expect(render(answerWorse)).toContain('<table');
  });

  it('shows the flags note under the table', () => {
    const html = render(answerWorse);
    const note = esc(locationsModel(answerWorse, DEFAULT_LOCATION_SORT).flagsNote);
    expect(html).toContain(note);
    expect(html.indexOf(note)).toBeGreaterThan(html.indexOf('</table>'));
  });

  it('shows the first-day caveat for a range including it, and never a previous-period caveat', () => {
    const store = idleOfficeStore();
    const storeSpan = dataSpan(store.calls)!;
    const view = locationsFor('range=all', store);
    const html = render(view, plainState, storeSpan);
    expect(html).toContain(esc(caveatsFor(view.notes, storeSpan, { comparing: false, range: view.range })[0]!.text));
    expect(html).toContain('<li');
    // Hand-edited notes: a usable comparison that overlaps and touches the first day, with a comparison in the URL.
    // The view passes comparing: false, so none of the comparison-period caveats appear.
    const notes = {
      ...view.notes,
      comparison: { ...view.notes.comparison, available: true, overlaps: true },
      incompletePrevious: { includesFirstDay: true, includesLastDay: true },
    };
    const comparisonUrl = parseUrlState('?view=locations&range=all&compareStart=2026-09-01&compareEnd=2026-09-05');
    const withComparison = render({ ...view, notes }, comparisonUrl, storeSpan);
    expect(withComparison).not.toContain('comparison period');
    expect(count(withComparison, '<li')).toBe(count(html, '<li'));
  });
});

describe('Heatmap', () => {
  // answer-worse: every office misses calls at one slot (weekday 3, hour 10) and nowhere else.
  const store = plantedStore('answer-worse');
  const view = missedCallsFor('range=all', store);
  const render = (mode: HeatmapMode, source = view.heatmap) =>
    renderToStaticMarkup(<Heatmap model={heatmapModel(source, mode)} mode={mode} onModeChange={noop} />);
  const body = (html: string) => rowsOf(html.slice(html.indexOf('<tbody>')));

  it('the zero cell is heat-0 with empty text and a hidden 0 missed calls', () => {
    const zero = render('office').match(/<td[^>]*heat-0[^>]*>.*?<\/td>/)![0];
    expect(zero).toMatch(/^<td class="heat-cell heat-0" data-level="0" title="[^"]*: 0 missed calls"><span class="visually-hidden">[^<]*: 0 missed calls<\/span><\/td>$/);
  });

  it('the busiest cell is level 4 and prints its count', () => {
    // Hand-set counts: the max (8) is in one cell, a quarter of it (2) in another.
    const first = view.heatmap.byOffice[0]!;
    const hours = first.hours.map(() => 0);
    hours[10] = 8;
    hours[11] = 2;
    const source = { ...view.heatmap, byOffice: [{ ...first, hours, total: 10 }] };
    const cellsOf = (html: string) =>
      [...html.matchAll(/<td class="heat-cell heat-(\d)"[^>]*>(\d*)<span/g)].map((m) => ({ level: Number(m[1]), text: m[2] }));
    const cells = cellsOf(render('office', source));
    expect(cells.find((c) => c.text === '8')?.level).toBe(4);
    expect(cells.find((c) => c.text === '2')?.level).toBeLessThan(4);
    expect(cells.filter((c) => c.level === 4)).toHaveLength(1);
    // And on the real data, every cell holding the maximum count is level 4.
    const max = Math.max(...view.heatmap.byOffice.flatMap((r) => r.hours));
    const real = cellsOf(render('office')).filter((c) => c.text === String(max));
    expect(real.length).toBeGreaterThan(0);
    expect(real.every((c) => c.level === 4)).toBe(true);
  });

  it('the mode buttons are pressed to match the mode', () => {
    for (const mode of ['office', 'weekday'] as const) {
      const html = render(mode);
      expect(html).toContain(`aria-pressed="${mode === 'office'}">By office<`);
      expect(html).toContain(`aria-pressed="${mode === 'weekday'}">By weekday<`);
      expect(count(html, 'aria-pressed="true"')).toBe(1);
    }
  });

  it('weekday mode renders seven rows, office mode one per office, a filtered view one', () => {
    expect(body(render('weekday'))).toHaveLength(7);
    expect(view.heatmap.byOffice.length).toBeGreaterThan(1);
    expect(body(render('office'))).toHaveLength(view.heatmap.byOffice.length);
    const filtered = missedCallsFor('range=all&location=loc_a', store);
    expect(body(render('office', filtered.heatmap))).toHaveLength(1);
  });

  it('prints the legend', () => {
    const html = render('office');
    expect(html).toContain('heat-legend');
    expect(html).toContain('Fewer');
    expect(html).toContain('More missed calls');
    expect(count(html, 'heat-swatch')).toBe(5);
  });

  it('prints office names as escaped text', () => {
    const name = '<img src=x onerror=alert(1)>';
    const source = { ...view.heatmap, byOffice: view.heatmap.byOffice.map((r, i) => (i === 0 ? { ...r, name } : r)) };
    const html = render('office', source);
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
  });
});

describe('CallbackTable', () => {
  const real = missedCallsFor('range=all', plantedStore('answer-worse'));
  const withRows = (n: number): MissedCallsData => ({
    ...real,
    callbacks: { ...real.callbacks, rows: real.callbacks.rows.slice(0, n) },
  });
  const render = (view: MissedCallsData, page = 1) =>
    renderToStaticMarkup(<CallbackTable model={missedCallsModel(view, span, page).callbacks} onPage={noop} />);
  const bodyRows = (html: string) => rowsOf(html.slice(html.indexOf('<tbody>')));
  // The real store has more than 40 callers; a 40-row list is a slice of real rows.
  const forty = withRows(40);

  it('has 25 body rows on page 1 of 40 and 15 on page 2', () => {
    expect(real.callbacks.rows.length).toBeGreaterThanOrEqual(40);
    expect(bodyRows(render(forty, 1))).toHaveLength(25);
    expect(bodyRows(render(forty, 2))).toHaveLength(15);
  });

  it('Previous is disabled on page 1 and Next on the last page', () => {
    const first = render(forty, 1);
    expect(first).toMatch(/<button[^>]*disabled=""[^>]*>Previous</);
    expect(first).toMatch(/<button(?![^>]*disabled)[^>]*>Next</);
    expect(first).toContain('Rows 1–25 of 40');
    const last = render(forty, 2);
    expect(last).toMatch(/<button(?![^>]*disabled)[^>]*>Previous</);
    expect(last).toMatch(/<button[^>]*disabled=""[^>]*>Next</);
    expect(last).toContain('Rows 26–40 of 40');
  });

  it('has no pager for 25 rows or fewer', () => {
    for (const n of [25, 3]) {
      const html = render(withRows(n));
      expect(bodyRows(html)).toHaveLength(n);
      expect(html).not.toContain('Previous');
      expect(html).not.toContain('Next');
      expect(html).not.toContain('pager');
    }
    expect(render(withRows(26))).toContain('pager');
  });

  it('the Est. value header says est.', () => {
    const head = render(forty).match(/<thead>.*<\/thead>/)![0];
    const headers = head.match(/<th[ >].*?<\/th>/g) ?? [];
    expect(headers[headers.length - 1]).toMatch(/>Est\. value</);
  });

  it('prints markup in a hash or office name escaped, and a long unbroken value whole', () => {
    const long = 'z'.repeat(300);
    const hostile = '<img src=x onerror=alert(1)>';
    const rows = real.callbacks.rows.slice(0, 3).map((r, i) => ({
      ...r,
      callerHash: i === 0 ? hostile : i === 1 ? long : r.callerHash,
      officeName: i === 0 ? hostile : r.officeName,
    }));
    const html = render({ ...real, callbacks: { ...real.callbacks, rows } });
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
    expect(html).toContain(`>${long}</td>`);
    expect(html).not.toContain('…');
  });
});

describe('MissedCallsView', () => {
  const offices = [
    { id: 'loc_a', name: 'Office A' },
    { id: 'loc_b', name: 'Office B' },
    { id: 'loc_c', name: 'Office C' },
  ];
  const store = plantedStore('answer-worse');
  const real = missedCallsFor('range=all', store);
  const base = '?view=missed-calls&range=all';
  const render = (view: MissedCallsData, search = base, busy = false) =>
    renderToStaticMarkup(
      <MissedCallsScreen view={view} state={parseUrlState(search)} span={span} offices={offices} busy={busy} onSelectOffice={noop} />,
    );
  // Hand-edited copy of real data: an office with no unanswered calls (the real stores always miss somewhere).
  const zeroMiss: MissedCallsData = {
    ...real,
    unansweredCalls: 0,
    officeFilter: { locationId: 'loc_b', name: 'Office B' },
    callbacks: { ...real.callbacks, rows: [], unidentifiedUnanswered: 0 },
  };

  it('shows Est. lost value, with the formula text from the API inside a details', () => {
    const html = render(real);
    expect(html).toContain('Est. lost value');
    expect(real.lostValue.formula.length).toBeGreaterThan(0);
    const details = html.match(/<details>.*?<\/details>/)![0];
    expect(details).toContain(esc(real.lostValue.formula));
  });

  it('links Download CSV to csvHref(state) with the download attribute, carrying the office', () => {
    const state = parseUrlState(base);
    const link = render(real).match(/<a[^>]*>Download CSV<\/a>/)![0];
    expect(link).toContain(`href="${esc(csvHref(state))}"`);
    expect(link).toMatch(/ download(=""|[ >])/);
    const search = `${base}&location=loc_a`;
    const filtered = render(missedCallsFor('range=all&location=loc_a', store), search);
    expect(csvHref(parseUrlState(search))).toContain('location=loc_a');
    expect(filtered).toContain(`href="${esc(csvHref(parseUrlState(search)))}"`);
  });

  it('the office picker lists All offices first, one option per office, and selects the state office', () => {
    const options = render(real, `${base}&location=loc_b`).match(/<option[ >].*?<\/option>/g) ?? [];
    expect(options).toHaveLength(4);
    expect(options[0]).toContain('All offices');
    expect(options.slice(1).map((o) => o.replace(/<[^>]*>/g, ''))).toEqual(['Office A', 'Office B', 'Office C']);
    expect(options.filter((o) => o.includes('selected=""'))).toEqual([options[2]]);
  });

  it('a state office that is not in the list selects All offices and does not crash', () => {
    const options = render(real, `${base}&location=nope`).match(/<option[ >].*?<\/option>/g) ?? [];
    expect(options).toHaveLength(4);
    // Server markup marks nothing when no option matches; React then picks the first option in the browser.
    expect(options.filter((o) => o.includes('selected=""'))).toEqual([]);
    expect(options[0]).toContain('All offices');
  });

  it('a very long office name is whole and escaped, in a picker that cannot widen the page', () => {
    const long = 'N'.repeat(300);
    const html = renderToStaticMarkup(
      <MissedCallsScreen
        view={real}
        state={plainState}
        span={span}
        offices={[{ id: 'loc_x', name: long }, { id: 'loc_y', name: '<img src=x onerror=alert(1)>' }]}
        onSelectOffice={noop}
      />,
    );
    expect(html).toContain(`>${long}</option>`);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
    expect(html).toContain('class="button office-select"');
    const css = readFileSync('src/web/styles/base.css', 'utf8');
    expect(css).toMatch(/\.office-select\s*\{[^}]*max-width:\s*100%/);
  });

  it('hides Download CSV while busy, because the link would fetch the other office', () => {
    expect(render(real, base, true)).not.toContain('Download CSV');
    expect(render(real, base, false)).toContain('Download CSV');
  });

  it('prints the lost value once, with est. only in the heading', () => {
    const html = render(real);
    const start = html.indexOf('<h2>Est. lost value</h2>');
    const section = html.slice(start, html.indexOf('</section>', start));
    expect(section).toContain(`<strong>${esc(missedCallsModel(real, span).lostValue.value)}</strong>`);
    expect(section.toLowerCase().split('est.').length - 1).toBe(1);
  });

  it('marks the estimate column from the model flag', () => {
    const html = render(real);
    const heads = html.match(/<th [^>]*>[^<]*<\/th>/g) ?? [];
    const marked = heads.filter((h) => h.includes(' est"')).map((h) => h.replace(/<[^>]*>/g, ''));
    expect(marked).toEqual(['Est. value']);
  });

  it('busy shows Updating… and aria-busy, and idle shows neither', () => {
    const busy = render(real, base, true);
    expect(busy).toContain('Updating…');
    expect(busy).toContain('aria-busy="true"');
    const idle = render(real);
    expect(idle).not.toContain('Updating…');
    expect(idle).not.toContain('aria-busy');
  });

  it('a view with nothing missed has no table, download or lost value, but keeps the action and picker', () => {
    const html = render(zeroMiss, `${base}&location=loc_b`);
    expect(html).not.toContain('<table');
    expect(html).not.toContain('Download CSV');
    expect(html).not.toContain('Est. lost value');
    expect(html).toContain(esc(zeroMiss.actions[0]!.text));
    expect(html).toContain('<select');
    expect(html).toContain('No calls went unanswered at Office B in this range.');
  });

  it('an empty callback list says no one to call back and has no download link or list table', () => {
    const html = render({ ...real, callbacks: { ...real.callbacks, rows: [] } });
    expect(html).toContain('No one to call back from this range.');
    expect(html).not.toContain('Download CSV');
    expect(html).not.toContain('class="callbacks"');
  });

  it('never prints a comparison-period caveat, even with a usable comparison in the notes (hand-edited)', () => {
    const notes = {
      ...real.notes,
      comparison: { ...real.notes.comparison, available: true, overlaps: true },
      incompletePrevious: { includesFirstDay: true, includesLastDay: true },
    };
    const html = render({ ...real, notes }, `${base}&compareStart=2026-09-01&compareEnd=2026-09-05`);
    expect(html).not.toContain('comparison period');
  });

  it('a long list shows the pager label, and the reach, limit and download notes are present', () => {
    const html = render(real);
    const model = missedCallsModel(real, span);
    expect(model.callbacks.pager).not.toBeNull();
    expect(html).toContain(esc(model.callbacks.pager!.label));
    expect(model.limitNote.length).toBeGreaterThan(0);
    for (const note of [model.reachNote, model.limitNote, model.callbacks.downloadNote]) expect(html).toContain(esc(note));
  });
});

describe('no placeholder remains', () => {
  it('no view prints Not built yet', () => {
    const store = plantedStore('answer-worse');
    const htmls = [
      renderToStaticMarkup(<LocationsScreen view={locationsFor('range=all', store)} state={plainState} span={span} />),
      renderToStaticMarkup(
        <MissedCallsScreen view={missedCallsFor('range=all', store)} state={plainState} span={span} offices={[]} onSelectOffice={noop} />,
      ),
      renderToStaticMarkup(<OverviewView view={overviewFor('range=last7')} state={plainState} span={span} />),
      renderToStaticMarkup(<CampaignsScreen view={campaignsFor('range=all')} state={plainState} span={span} onSelectCampaign={noop} />),
      renderToStaticMarkup(<EmptyScreen notes={[]} />),
    ];
    for (const html of htmls) expect(html).not.toContain('Not built yet');
  });
});

describe('OverviewView with an alert entry', () => {
  const real = overviewFor('range=last7');
  const alertText = 'Calls dropped for 2 campaigns.';
  const [campaigns, ...rest] = real.topActions;
  const withAlert: OverviewData = {
    ...real,
    notes: { ...real.notes, incompleteCurrent: { ...real.notes.incompleteCurrent, includesLastDay: true } },
    topActions: [
      campaigns!,
      { ...campaigns!, action: { ...campaigns!.action, kind: 'review_call_changes', text: alertText, actionable: true } },
      ...rest,
    ],
  };
  const html = renderToStaticMarkup(<OverviewView view={withAlert} state={parseUrlState('?range=last7')} span={span} />);

  it('lists the alert once with an Open Campaigns link', () => {
    expect(count(html, alertText)).toBe(1);
    const items = html.slice(html.indexOf('<h2>Top actions</h2>')).match(/<li[ >].*?<\/li>/g) ?? [];
    expect(items).toHaveLength(4);
    expect(items[1]).toContain(alertText);
    expect(items[1]).toContain('Open Campaigns');
  });

  it('carries the incomplete-day caveat that qualifies it', () => {
    expect(html).toContain('the last day in the data, may be incomplete.');
  });
});

describe('a later equal-length second range', () => {
  // Sep 1-3 against Sep 12-14: same length, but the second range comes after the selected one.
  const SEARCH = 'start=2026-09-01&end=2026-09-03&compareStart=2026-09-12&compareEnd=2026-09-14';
  const LINE = 'Comparing Sep 1 – Sep 3, 2026 with Sep 12 – Sep 14, 2026.';

  it('Overview names both ranges, with no per-day caveat', () => {
    const html = renderToStaticMarkup(<OverviewView view={overviewFor(SEARCH)} state={plainState} span={span} />);
    expect(count(html, LINE)).toBe(1);
    expect(html).not.toContain('compare per day.');
  });

  it('Campaigns names both ranges and shows no jump or drop badges, with the reason', () => {
    const view = campaignsFor(SEARCH);
    const html = renderToStaticMarkup(
      <CampaignsScreen view={view} state={parseUrlState('?view=campaigns')} span={span} onSelectCampaign={noop} />,
    );
    expect(count(html, LINE)).toBe(1);
    expect(html).not.toContain('badge-jump');
    expect(html).not.toContain('badge-drop');
    expect(view.alerts.reason).toBe('Call-change alerts need the comparison period to come before the selected range.');
    expect(html).toContain(esc(view.alerts.reason!));
  });
});
