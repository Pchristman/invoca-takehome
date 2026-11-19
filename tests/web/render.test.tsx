// Render the dumb components to a string (no browser, no DOM) and assert on the markup.
// Covers what a model test cannot: that the component prints the model, and that dev-only things are absent.
// Data comes from the real view builders (tests/web/fixtures.ts). Where a fixture lacks a case, the test says
// how it builds it: another store, or a hand-edited copy of real JSON view data.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CampaignsView, OverviewView as OverviewData } from '../../src/core/views';
import { dataSpan } from '../../src/core/ranges';
import type { DateRange } from '../../src/core/ranges';
import type { Meta } from '../../src/server/api';
import type { ClientError } from '../../src/web/api';
import { CampaignTable } from '../../src/web/components/CampaignTable';
import { CampaignsView as CampaignsScreen } from '../../src/web/components/CampaignsView';
import { Caveats } from '../../src/web/components/Caveats';
import { ComingSoon } from '../../src/web/components/ComingSoon';
import { DataNotesPanel } from '../../src/web/components/DataNotesPanel';
import { EstimateNote } from '../../src/web/components/EstimateNote';
import { Header } from '../../src/web/components/Header';
import { Nav } from '../../src/web/components/Nav';
import { OverviewView } from '../../src/web/components/OverviewView';
import { RangeControl } from '../../src/web/components/RangeControl';
import { RequestFrame } from '../../src/web/components/RequestFrame';
import { WeeklyChart } from '../../src/web/components/WeeklyChart';
import { BLANK } from '../../src/web/format';
import { DEFAULT_SORT, campaignsModel } from '../../src/web/models/campaignsModel';
import type { CampaignSort } from '../../src/web/models/campaignsModel';
import { weeklyChartModel } from '../../src/web/models/weeklyChart';
import { estimateFormulas } from '../../src/web/models/estimates';
import type { RequestState } from '../../src/web/requestState';
import { actionHref, parseUrlState } from '../../src/web/urlState';
import { campaignsFor, metaFor, overviewFor, storeWithNames, storeWithZeroBudget } from './fixtures';
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
    renderToStaticMarkup(<RangeControl state={parseUrlState(search)} meta={m} error={error} onChange={noop} />);

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

  it('carries min and max from the data span on both date inputs', () => {
    const inputs = render('').match(/<input[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
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

  it('shows a range error as an alert only for a range field', () => {
    const html = render('?start=nope&end=2026-09-05', { code: 'bad_date', message: 'Start date is not a date.', field: 'start' });
    expect(html).toMatch(/<p role="alert"[^>]*>Start date is not a date\.<\/p>/);
    const other = render('', { code: 'unknown_campaign', message: 'No such campaign.', field: 'campaign' });
    expect(other).not.toContain('role="alert"');
    expect(render('')).not.toContain('role="alert"');
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

describe('ComingSoon', () => {
  it('says Not built yet and names the view', () => {
    const html = renderToStaticMarkup(<ComingSoon view="Locations" />);
    expect(html).toContain('Not built yet');
    expect(html).toContain('Locations');
  });
});
