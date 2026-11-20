// The URL is the only state of the web app. This module turns a search string
// into a UrlState and back. It is pure: no browser, no React.
import type { ActionLink, ViewName } from '../core/views/facts';

export type RangeChoice =
  | { kind: 'preset'; preset: string } // raw: the server judges it
  | { kind: 'custom'; start: string; end: string }; // either may be '' (hand-edited URL)

/** The filter of an answer page (S4). The server judges the values; the web keeps only well-formed ones. */
export interface AnswerParams {
  offices: string[];
  campaigns: string[];
  unattributed: boolean;
  weekdays: number[];
  hours: number[];
}

export interface UrlState {
  view: ViewName;
  range: RangeChoice | null; // null = the server's default
  compare: { start: string; end: string } | null; // either may be ''
  campaign: string | null;
  location: string | null;
  dev: boolean;
  print: boolean; // the one-page print summary
  answer: AnswerParams | null; // non-null exactly when the bare `answer` parameter is present
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

function nonEmpty(values: string[]): string[] {
  return values.filter((value) => value !== '');
}

function integers(values: string[]): number[] {
  return values.filter((value) => /^\d{1,3}$/.test(value)).map(Number);
}

function parseAnswer(params: URLSearchParams): AnswerParams | null {
  if (!params.has('answer')) return null;
  return {
    offices: nonEmpty(params.getAll('f_office')),
    campaigns: nonEmpty(params.getAll('f_campaign')),
    unattributed: params.get('f_unattributed') === '1',
    weekdays: integers(params.getAll('f_weekday')),
    hours: integers(params.getAll('f_hour')),
  };
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
    print: params.has('print'),
    answer: parseAnswer(params),
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

// The f_ parameters of an answer filter, in a fixed order.
function filterPairs(answer: AnswerParams): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const id of answer.offices) pairs.push(['f_office', id]);
  for (const id of answer.campaigns) pairs.push(['f_campaign', id]);
  if (answer.unattributed) pairs.push(['f_unattributed', '1']);
  for (const day of answer.weekdays) pairs.push(['f_weekday', String(day)]);
  for (const hour of answer.hours) pairs.push(['f_hour', String(hour)]);
  return pairs;
}

// '' for the defaults, else '?view=campaigns&range=last7&dev' (answer, print and dev are written bare, in that order).
export function toSearch(state: UrlState): string {
  const pairs: Array<[string, string]> = [];
  if (state.view !== 'overview') pairs.push(['view', state.view]);
  pairs.push(...rangePairs(state));
  if (state.campaign) pairs.push(['campaign', state.campaign]);
  if (state.location) pairs.push(['location', state.location]);
  if (state.answer) pairs.push(...filterPairs(state.answer));

  const parts = pairs.map(([name, value]) => `${name}=${encodeURIComponent(value)}`);
  if (state.answer) parts.push('answer');
  if (state.print) parts.push('print');
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

// A nav link always leaves the answer page.
export function withView(state: UrlState, view: ViewName): UrlState {
  return { ...state, view, answer: null };
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
    answer: null,
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
    print: state.print,
    answer: null,
  };
  return `/${toSearch(target)}`;
}

// The query for a takeaway: what changes its fact sheet. The campaign only picks the weekly chart, so it is left out.
export function takeawayParams(state: UrlState, view: ViewName): URLSearchParams {
  return apiParams({ ...state, campaign: null }, view);
}

// The print page: the view, range and comparison, company-wide. Drops the filters and dev.
export function printHref(state: UrlState): string {
  return `/${toSearch({ ...state, campaign: null, location: null, dev: false, print: true, answer: null })}`;
}

// The way back from the print page to the app: everything kept, print off.
export function appHref(state: UrlState): string {
  return `/${toSearch({ ...state, print: false })}`;
}

/** The five requests the print page makes, in order: the overview, then each view's takeaway. Never state.view. */
export function printRequests(state: UrlState): { path: string; params: URLSearchParams }[] {
  const takeaways = (['overview', 'campaigns', 'locations', 'missed-calls'] as const).map((view) => ({
    path: `/api/takeaway/${view}`,
    params: printParams(state, view),
  }));
  return [{ path: '/api/overview', params: printParams(state, 'overview') }, ...takeaways];
}

// The query for the print page's requests: the same as the screen's, with no campaign or location.
export function printParams(state: UrlState, view: ViewName): URLSearchParams {
  return apiParams({ ...state, campaign: null, location: null }, view);
}

/** The query for /api/answer: view, range and the f_ filter. No comparison, no dev. */
export function answerParams(state: UrlState): URLSearchParams {
  const params = new URLSearchParams();
  params.set('view', state.view);
  for (const [name, value] of rangePairs({ ...state, compare: null })) params.append(name, value);
  if (state.answer) for (const [name, value] of filterPairs(state.answer)) params.append(name, value);
  return params;
}

/**
 * The page for a validated question: `query` is the one a QuestionResponse carries (view, filter, maybe a range).
 * A range in the query wins; otherwise the current one stays. Comparison, campaign and location are dropped; dev is kept.
 */
export function answerHref(state: UrlState, query: string): string {
  const fromQuery = parseUrlState(`?${query}&answer`);
  const target: UrlState = {
    view: fromQuery.view,
    range: fromQuery.range ?? state.range,
    compare: null,
    campaign: null,
    location: null,
    dev: state.dev,
    print: false,
    answer: fromQuery.answer,
  };
  return `/${toSearch(target)}`;
}

/** The Overview for the same range, off the answer page. dev is kept. */
export function clearHref(state: UrlState): string {
  return `/${toSearch({ view: 'overview', range: state.range, compare: null, campaign: null, location: null, dev: state.dev, print: false, answer: null })}`;
}

/** An in-app href (path and query) with dev set as the state has it. */
export function withDevOf(href: string, state: UrlState): string {
  const target = parseUrlState(href.slice(href.indexOf('?') === -1 ? href.length : href.indexOf('?')));
  return `/${toSearch({ ...target, dev: state.dev })}`;
}
