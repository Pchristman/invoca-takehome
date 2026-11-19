import { describe, it, expect } from 'vitest';
import {
  VIEW_ORDER,
  parseUrlState,
  toSearch,
  apiParams,
  withView,
  withRange,
  withCampaign,
  withLocation,
  csvHref,
  customRange,
  presetOf,
  actionHref,
  defaultsHref,
  type UrlState,
} from '../../src/web/urlState';

const DEFAULTS: UrlState = {
  view: 'overview',
  range: null,
  compare: null,
  campaign: null,
  location: null,
  dev: false,
};

function state(changes: Partial<UrlState>): UrlState {
  return { ...DEFAULTS, ...changes };
}

describe('parseUrlState', () => {
  it('no search is the defaults', () => {
    expect(parseUrlState('')).toEqual(DEFAULTS);
    expect(parseUrlState('?')).toEqual(DEFAULTS);
  });

  it('each view parses', () => {
    expect(parseUrlState('?view=campaigns').view).toBe('campaigns');
    expect(parseUrlState('?view=locations').view).toBe('locations');
    expect(parseUrlState('?view=missed-calls').view).toBe('missed-calls');
    for (const bad of ['zzz', 'Campaigns', '', 'overview']) {
      expect(parseUrlState(`?view=${bad}`).view).toBe('overview');
    }
  });

  it('ranges', () => {
    expect(parseUrlState('?range=last7').range).toEqual({ kind: 'preset', preset: 'last7' });
    expect(parseUrlState('?range=banana').range).toEqual({ kind: 'preset', preset: 'banana' });
    expect(parseUrlState('?range=').range).toBeNull();
    expect(parseUrlState('?start=2026-09-01&end=2026-09-05').range).toEqual({
      kind: 'custom',
      start: '2026-09-01',
      end: '2026-09-05',
    });
    expect(parseUrlState('?start=2026-09-01').range).toEqual({
      kind: 'custom',
      start: '2026-09-01',
      end: '',
    });
    expect(parseUrlState('?range=last7&start=2026-09-01&end=2026-09-05').range).toEqual({
      kind: 'preset',
      preset: 'last7',
    });
    expect(parseUrlState('?range=last7&range=all').range).toEqual({
      kind: 'preset',
      preset: 'last7',
    });
  });

  it('compare', () => {
    expect(parseUrlState('?compareStart=2026-08-01&compareEnd=2026-08-05').compare).toEqual({
      start: '2026-08-01',
      end: '2026-08-05',
    });
    expect(parseUrlState('?compareStart=2026-08-01').compare).toEqual({
      start: '2026-08-01',
      end: '',
    });
    expect(parseUrlState('?compareEnd=2026-08-05').compare).toEqual({
      start: '',
      end: '2026-08-05',
    });
    expect(parseUrlState('?view=campaigns').compare).toBeNull();
  });

  it('dev by presence', () => {
    for (const search of ['?dev', '?dev=1', '?dev=0', '?dev=']) {
      expect(parseUrlState(search).dev).toBe(true);
    }
    expect(parseUrlState('').dev).toBe(false);
    expect(parseUrlState('?devx').dev).toBe(false);
  });

  it.each([
    '?%E0%A4%A',
    '?&&&',
    '?=x',
    '?view',
    '?campaign=%00',
    `?campaign=${'x'.repeat(10000)}`,
    '?range[]=x',
  ])('garbage never throws: %s', (search) => {
    const parsed = parseUrlState(search);
    expect(parsed.view).toBeTypeOf('string');
    expect(toSearch(parsed)).toBeTypeOf('string');
  });
});

describe('toSearch', () => {
  const roundTripStates: Array<[string, UrlState]> = [
    ['default', DEFAULTS],
    ['campaigns plus campaign', state({ view: 'campaigns', campaign: 'camp_a' })],
    [
      'custom range plus compare',
      state({
        range: { kind: 'custom', start: '2026-09-01', end: '2026-09-05' },
        compare: { start: '2026-08-01', end: '2026-08-05' },
      }),
    ],
    ['missed-calls plus location plus dev', state({ view: 'missed-calls', location: 'loc_a', dev: true })],
    ['preset plus dev', state({ range: { kind: 'preset', preset: 'last7' }, dev: true })],
    ['custom with a blank end', state({ range: { kind: 'custom', start: '2026-09-01', end: '' } })],
  ];

  it.each(roundTripStates)('round trip: %s', (_name, s) => {
    expect(parseUrlState(toSearch(s))).toEqual(s);
  });

  it('is canonical', () => {
    expect(toSearch(DEFAULTS)).toBe('');
    expect(
      toSearch(state({ view: 'campaigns', range: { kind: 'preset', preset: 'last7' }, dev: true })),
    ).toBe('?view=campaigns&range=last7&dev');
  });

  it('percent-encodes a campaign id and round-trips it', () => {
    const s = state({ view: 'campaigns', campaign: 'a&b c' });
    const search = toSearch(s);
    expect(search).not.toContain(' ');
    expect(search).not.toContain('a&b');
    expect(parseUrlState(search).campaign).toBe('a&b c');
  });
});

describe('apiParams', () => {
  const everything = state({
    range: { kind: 'preset', preset: 'last7' },
    campaign: 'camp_a',
    location: 'loc_a',
    dev: true,
  });

  it('overview carries only the range', () => {
    expect(apiParams(everything, 'overview').toString()).toBe('range=last7');
  });

  it('campaigns adds campaign', () => {
    expect(apiParams(everything, 'campaigns').toString()).toBe('range=last7&campaign=camp_a');
  });

  it('missed-calls adds location', () => {
    expect(apiParams(everything, 'missed-calls').toString()).toBe('range=last7&location=loc_a');
  });

  it('custom range and compare add start, end and compare dates', () => {
    const s = state({
      range: { kind: 'custom', start: '2026-09-01', end: '2026-09-05' },
      compare: { start: '2026-08-01', end: '2026-08-05' },
    });
    expect(apiParams(s, 'overview').toString()).toBe(
      'start=2026-09-01&end=2026-09-05&compareStart=2026-08-01&compareEnd=2026-08-05',
    );
  });

  it('omits blanks and nulls, and never carries view or dev', () => {
    const s = state({
      view: 'campaigns',
      range: { kind: 'custom', start: '2026-09-01', end: '' },
      compare: { start: '', end: '2026-08-05' },
      dev: true,
    });
    const params = apiParams(s, 'campaigns');
    expect(params.toString()).toBe('start=2026-09-01&compareEnd=2026-08-05');
    expect(params.has('view')).toBe(false);
    expect(params.has('dev')).toBe(false);
  });

  it('the default state yields an empty set', () => {
    expect(apiParams(DEFAULTS, 'overview').toString()).toBe('');
  });
});

describe('with* helpers', () => {
  it('withRange clears the comparison', () => {
    const s = state({ compare: { start: '2026-08-01', end: '2026-08-05' } });
    const next = withRange(s, { kind: 'preset', preset: 'last7' });
    expect(next.range).toEqual({ kind: 'preset', preset: 'last7' });
    expect(next.compare).toBeNull();
  });

  it('withView keeps the rest', () => {
    const s = state({ range: { kind: 'preset', preset: 'last7' }, campaign: 'camp_a', dev: true });
    expect(withView(s, 'campaigns')).toEqual({ ...s, view: 'campaigns' });
  });

  it('withCampaign(null) removes the campaign', () => {
    const s = state({ view: 'campaigns', campaign: 'camp_a' });
    expect(withCampaign(s, null).campaign).toBeNull();
    expect(withCampaign(s, 'camp_b').campaign).toBe('camp_b');
  });

  it('withLocation sets and clears, and keeps the rest', () => {
    const s = state({
      view: 'missed-calls',
      range: { kind: 'preset', preset: 'last7' },
      compare: { start: '2026-08-01', end: '2026-08-05' },
      campaign: 'camp_a',
      dev: true,
    });
    expect(withLocation(s, 'loc_a')).toEqual({ ...s, location: 'loc_a' });
    expect(withLocation(withLocation(s, 'loc_a'), null)).toEqual(s);
  });
});

describe('csvHref', () => {
  const PATH = '/api/missed-calls/callbacks.csv';

  it('is the bare path for the default state', () => {
    expect(csvHref(DEFAULTS)).toBe(PATH);
  });

  it('carries a preset range and the office', () => {
    const s = state({ range: { kind: 'preset', preset: 'last7' }, location: 'loc_a' });
    expect(csvHref(s)).toBe(`${PATH}?range=last7&location=loc_a`);
  });

  it('carries a custom range', () => {
    const s = state({ range: { kind: 'custom', start: '2026-09-01', end: '2026-09-05' } });
    expect(csvHref(s)).toBe(`${PATH}?start=2026-09-01&end=2026-09-05`);
  });

  it('never carries view, dev or campaign', () => {
    const href = csvHref(state({ view: 'missed-calls', campaign: 'camp_a', dev: true }));
    expect(href).toBe(PATH);
  });

  it('never carries a comparison, even a half-typed one', () => {
    const href = csvHref(state({ range: { kind: 'preset', preset: 'last7' }, compare: { start: '2026-09-01', end: '' } }));
    expect(href).toBe(`${PATH}?range=last7`);
  });

  it('percent-encodes an office id and decodes it back', () => {
    const href = csvHref(state({ location: 'a&b c' }));
    expect(new URL(href, 'http://x').searchParams.get('location')).toBe('a&b c');
  });
});

describe('customRange', () => {
  it('trims', () => {
    expect(customRange('2026-09-01', ' 2026-09-05 ')).toEqual({
      kind: 'custom',
      start: '2026-09-01',
      end: '2026-09-05',
    });
  });

  it('is null when either is blank', () => {
    expect(customRange('', '2026-09-05')).toBeNull();
    expect(customRange('2026-09-01', '   ')).toBeNull();
  });
});

describe('presetOf', () => {
  it('uses the default when range is null', () => {
    expect(presetOf(DEFAULTS, 'last28')).toBe('last28');
  });

  it('uses the preset when there is one', () => {
    expect(presetOf(state({ range: { kind: 'preset', preset: 'last7' } }), 'last28')).toBe('last7');
  });

  it('is null for a custom range', () => {
    const s = state({ range: { kind: 'custom', start: '2026-09-01', end: '2026-09-05' } });
    expect(presetOf(s, 'last28')).toBeNull();
  });
});

describe('hrefs', () => {
  const from = state({
    view: 'campaigns',
    range: { kind: 'preset', preset: 'last7' },
    campaign: 'camp_a',
    location: 'loc_stale',
    dev: true,
  });

  it('actionHref goes to the link view with the location, keeping range and dev', () => {
    expect(actionHref(from, { view: 'missed-calls', locationId: 'loc_a' })).toBe(
      '/?view=missed-calls&range=last7&location=loc_a&dev',
    );
  });

  it('actionHref without a location has no location', () => {
    expect(actionHref(from, { view: 'locations' })).toBe('/?view=locations&range=last7&dev');
  });

  it('actionHref to campaigns carries no stale location or campaign', () => {
    const href = actionHref(from, { view: 'campaigns' });
    expect(href).not.toContain('location');
    expect(href).not.toContain('campaign=');
  });

  it('defaultsHref keeps view and dev only', () => {
    const messy = state({
      ...from,
      compare: { start: '2026-08-01', end: '2026-08-05' },
    });
    expect(defaultsHref(messy)).toBe('/?view=campaigns&dev');
    expect(defaultsHref(DEFAULTS)).toBe('/');
  });

  it('a link to Missed calls for an office with special characters round-trips', () => {
    const href = actionHref(DEFAULTS, { view: 'missed-calls', locationId: 'a&b c' });
    const search = href.slice(href.indexOf('?'));
    expect(parseUrlState(search).location).toBe('a&b c');
  });

  it('defaultsHref from Missed calls drops the office', () => {
    expect(defaultsHref(state({ view: 'missed-calls', location: 'nope', dev: true }))).toBe('/?view=missed-calls&dev');
  });

  it('every href starts with a slash', () => {
    expect(defaultsHref(DEFAULTS).startsWith('/')).toBe(true);
    expect(actionHref(DEFAULTS, { view: 'overview' }).startsWith('/')).toBe(true);
  });
});

describe('VIEW_ORDER', () => {
  it('lists the four views in nav order', () => {
    expect(VIEW_ORDER).toEqual(['overview', 'campaigns', 'locations', 'missed-calls']);
  });
});
