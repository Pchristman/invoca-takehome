// The URL is the only state of the web app. This module turns a search string
// into a UrlState and back. It is pure: no browser, no React.
import type { ActionLink, ViewName } from '../core/views/facts';

export type RangeChoice =
  | { kind: 'preset'; preset: string } // raw: the server judges it
  | { kind: 'custom'; start: string; end: string }; // either may be '' (hand-edited URL)

export interface UrlState {
  view: ViewName;
  range: RangeChoice | null; // null = the server's default
  compare: { start: string; end: string } | null; // either may be ''
  campaign: string | null;
  location: string | null;
  dev: boolean;
}

export const VIEW_ORDER: readonly ViewName[] = ['overview', 'campaigns', 'locations', 'missed-calls'];

// The first value of a parameter, or null when it is missing or empty.
function firstValue(params: URLSearchParams, name: string): string | null {
  const value = params.get(name);
  return value === null || value === '' ? null : value;
}

function parseView(params: URLSearchParams): ViewName {
  const value = params.get('view');
  return VIEW_ORDER.find((name) => name === value) ?? 'overview';
}

function parseRange(params: URLSearchParams): RangeChoice | null {
  const preset = firstValue(params, 'range');
  if (preset !== null) return { kind: 'preset', preset }; // a preset wins over start and end
  const start = firstValue(params, 'start') ?? '';
  const end = firstValue(params, 'end') ?? '';
  if (start === '' && end === '') return null;
  return { kind: 'custom', start, end };
}

function parseCompare(params: URLSearchParams): { start: string; end: string } | null {
  const start = firstValue(params, 'compareStart') ?? '';
  const end = firstValue(params, 'compareEnd') ?? '';
  if (start === '' && end === '') return null;
  return { start, end };
}

// Never throws: URLSearchParams accepts any string.
export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  return {
    view: parseView(params),
    range: parseRange(params),
    compare: parseCompare(params),
    campaign: firstValue(params, 'campaign'),
    location: firstValue(params, 'location'),
    dev: params.has('dev'),
  };
}

// The range and comparison as [name, value] pairs, blanks left out.
function rangePairs(state: UrlState): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  if (state.range?.kind === 'preset') {
    pairs.push(['range', state.range.preset]);
  } else if (state.range?.kind === 'custom') {
    pairs.push(['start', state.range.start], ['end', state.range.end]);
  }
  if (state.compare) {
    pairs.push(['compareStart', state.compare.start], ['compareEnd', state.compare.end]);
  }
  return pairs.filter(([, value]) => value !== '');
}

// '' for the defaults, else '?view=campaigns&range=last7&dev' (dev is written bare).
export function toSearch(state: UrlState): string {
  const pairs: Array<[string, string]> = [];
  if (state.view !== 'overview') pairs.push(['view', state.view]);
  pairs.push(...rangePairs(state));
  if (state.campaign) pairs.push(['campaign', state.campaign]);
  if (state.location) pairs.push(['location', state.location]);

  const parts = pairs.map(([name, value]) => `${name}=${encodeURIComponent(value)}`);
  if (state.dev) parts.push('dev');
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

// The query for the API: the URL minus view and dev, only what this view uses.
export function apiParams(state: UrlState, view: ViewName): URLSearchParams {
  const params = new URLSearchParams();
  for (const [name, value] of rangePairs(state)) params.set(name, value);
  if (view === 'campaigns' && state.campaign) params.set('campaign', state.campaign);
  if (view === 'missed-calls' && state.location) params.set('location', state.location);
  return params;
}

export function withView(state: UrlState, view: ViewName): UrlState {
  return { ...state, view };
}

// A new range makes the old comparison meaningless, so it is cleared.
export function withRange(state: UrlState, range: RangeChoice | null): UrlState {
  return { ...state, range, compare: null };
}

// Sets or clears only the second range; the selected range stays.
export function withCompare(state: UrlState, compare: { start: string; end: string } | null): UrlState {
  return { ...state, compare };
}

export function withCampaign(state: UrlState, id: string | null): UrlState {
  return { ...state, campaign: id };
}

export function withLocation(state: UrlState, id: string | null): UrlState {
  return { ...state, location: id };
}

// The callback CSV for what is on screen: same range and office, no view, dev, campaign or comparison
// (Missed calls has no comparison, and a half-typed one would make the export fail).
export function csvHref(state: UrlState): string {
  const query = apiParams({ ...state, compare: null }, 'missed-calls').toString();
  return query === '' ? '/api/missed-calls/callbacks.csv' : `/api/missed-calls/callbacks.csv?${query}`;
}

export function customRange(start: string, end: string): RangeChoice | null {
  const trimmedStart = start.trim();
  const trimmedEnd = end.trim();
  if (trimmedStart === '' || trimmedEnd === '') return null;
  return { kind: 'custom', start: trimmedStart, end: trimmedEnd };
}

export function customCompare(start: string, end: string): { start: string; end: string } | null {
  const trimmedStart = start.trim();
  const trimmedEnd = end.trim();
  if (trimmedStart === '' || trimmedEnd === '') return null;
  return { start: trimmedStart, end: trimmedEnd };
}

// Which preset button is active; null when the range is custom.
export function presetOf(state: UrlState, defaultPreset: string): string | null {
  if (state.range === null) return defaultPreset;
  return state.range.kind === 'preset' ? state.range.preset : null;
}

// A link to another view: keeps range, comparison and dev; drops the campaign.
export function actionHref(state: UrlState, link: ActionLink): string {
  const target: UrlState = {
    ...state,
    view: link.view,
    campaign: null,
    location: link.locationId ?? null,
  };
  return `/${toSearch(target)}`;
}

// A link that keeps only the view and dev.
export function defaultsHref(state: UrlState): string {
  const target: UrlState = {
    view: state.view,
    range: null,
    compare: null,
    campaign: null,
    location: null,
    dev: state.dev,
  };
  return `/${toSearch(target)}`;
}

// The query for a takeaway: what changes its fact sheet. The campaign only picks the weekly chart, so it is left out.
export function takeawayParams(state: UrlState, view: ViewName): URLSearchParams {
  return apiParams({ ...state, campaign: null }, view);
}
