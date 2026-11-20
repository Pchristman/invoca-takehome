import { checkDates, resolveRange } from '../core/ranges';
import type { DateRange, RangeSpec, ResolvedRange } from '../core/ranges';
import type { AnswerFilter } from '../core/answer';
import type { CallStore } from '../core/types';
import type { ViewName } from '../core/views';
import { DEFAULT_PRESET, PRESETS, shorten } from './api';
import type { ApiError } from './api';

/** What Hono's c.req.queries() returns: every parameter, each with all its values. */
export type Query = Record<string, string[]>;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export interface ViewQuery {
  range: ResolvedRange;
  /** The comparison range as asked for; Phase 5 decides whether it is like for like. */
  previous?: DateRange;
  campaignId?: string;
  locationId?: string;
}

/** Which optional filters the route uses; the others are ignored. */
export interface ViewQueryWants {
  campaign?: boolean;
  location?: boolean;
}

type Preset = (typeof PRESETS)[number];

const fail = (error: ApiError): { ok: false; error: ApiError } => ({ ok: false, error });
const isPreset = (value: string): value is Preset => (PRESETS as readonly string[]).includes(value);

/**
 * Turn URL text into a resolved range, an optional comparison and ids that exist, or one message.
 * Checks run in order and the first failure wins. Never throws.
 */
export function parseViewQuery(
  store: CallStore,
  span: DateRange | null,
  query: Query,
  wants: ViewQueryWants = {},
): Parsed<ViewQuery> {
  // 1. A parameter this route uses, given twice.
  const used = ['range', 'start', 'end', 'compareStart', 'compareEnd'];
  if (wants.campaign) used.push('campaign');
  if (wants.location) used.push('location');
  for (const name of used) {
    if ((query[name]?.length ?? 0) > 1) {
      return fail({ code: 'bad_param', field: name, message: `The parameter ${name} was given more than once.` });
    }
  }
  // An empty value counts as not given.
  const one = (name: string): string => query[name]?.[0] ?? '';

  // 2. The shape of the range request.
  const preset = one('range');
  const start = one('start');
  const end = one('end');
  let spec: RangeSpec;
  if (preset !== '' && (start !== '' || end !== '')) {
    return fail({ code: 'bad_param', field: 'range', message: 'Use either range or start and end, not both.' });
  }
  if ((start === '') !== (end === '')) {
    const missing = start === '' ? 'start' : 'end';
    return fail({ code: 'bad_param', field: missing, message: 'The parameters start and end must be given together.' });
  }
  if (start !== '') {
    spec = { kind: 'custom', start, end };
  } else if (preset === '') {
    spec = { kind: 'preset', preset: DEFAULT_PRESET };
  } else if (isPreset(preset)) {
    spec = { kind: 'preset', preset };
  } else {
    return fail({
      code: 'bad_param',
      field: 'range',
      message: `"${shorten(preset)}" is not a range. Use ${PRESETS.join(', ')}, or start and end.`,
    });
  }

  // 3. The dates' syntax, for the range and for the comparison.
  if (spec.kind === 'custom') {
    const problem = checkDates(spec.start, spec.end);
    // An inverted pair names no single date; put it on the end so the range control shows the message.
    if (problem) return fail({ ...problem, field: problem.field ?? 'end' });
  }
  const compareStart = one('compareStart');
  const compareEnd = one('compareEnd');
  if ((compareStart === '') !== (compareEnd === '')) {
    return fail({
      code: 'bad_param',
      field: compareStart === '' ? 'compareStart' : 'compareEnd',
      message: 'The parameters compareStart and compareEnd must be given together.',
    });
  }
  let previous: DateRange | undefined;
  if (compareStart !== '') {
    const problem = checkDates(compareStart, compareEnd);
    if (problem) {
      // An inverted pair names no single date; put it on the end so the range control shows the message.
      const field = problem.field === 'start' ? 'compareStart' : 'compareEnd';
      return fail({ ...problem, field, message: `Comparison range: ${problem.message}` });
    }
    previous = { start: compareStart, end: compareEnd };
  }

  // 4. No data, and a range outside the data.
  const resolved = resolveRange(span, spec);
  if (!resolved.ok) return fail(resolved.error);

  // 5. Ids that must exist, only for the routes that use them.
  const campaignId = one('campaign') || undefined;
  if (wants.campaign && campaignId !== undefined && !store.campaigns.some((c) => c.id === campaignId)) {
    return fail({ code: 'unknown_campaign', field: 'campaign', message: `No campaign has the id "${shorten(campaignId)}".` });
  }
  const locationId = one('location') || undefined;
  if (wants.location && locationId !== undefined && !store.locations.some((l) => l.id === locationId)) {
    return fail({ code: 'unknown_location', field: 'location', message: `No office has the id "${shorten(locationId)}".` });
  }

  return {
    ok: true,
    value: {
      range: resolved.range,
      previous,
      campaignId: wants.campaign ? campaignId : undefined,
      locationId: wants.location ? locationId : undefined,
    },
  };
}

/** Most values one f_ parameter may hold. */
export const ANSWER_LIMITS = { maxValues: 50 } as const;

export interface AnswerQuery {
  range: ResolvedRange;
  filter: AnswerFilter;
}

const ANSWER_VIEWS: ViewName[] = ['overview', 'campaigns', 'locations', 'missed-calls'];

function tooMany(field: string): { ok: false; error: ApiError } {
  return fail({ code: 'bad_param', field, message: `The parameter ${field} may have at most ${ANSWER_LIMITS.maxValues} values.` });
}

/** Whole numbers from min to max, de-duplicated with order kept, or the first bad value's message. */
function parseInts(query: Query, field: string, min: number, max: number): Parsed<number[]> {
  const raw = query[field] ?? [];
  if (raw.length > ANSWER_LIMITS.maxValues) return tooMany(field);
  const numbers: number[] = [];
  for (const text of raw) {
    const n = /^[0-9]+$/.test(text) ? Number(text) : NaN;
    if (!(n >= min && n <= max)) {
      return fail({ code: 'bad_param', field, message: `"${shorten(text)}" is not a whole number from ${min} to ${max}.` });
    }
    if (!numbers.includes(n)) numbers.push(n);
  }
  return { ok: true, value: numbers };
}

/** Ids that must all exist: de-duplicated with order kept; an empty value counts as absent. */
function parseIds(
  query: Query,
  field: string,
  exists: (id: string) => boolean,
  unknown: 'unknown_location' | 'unknown_campaign',
  noun: string,
): Parsed<string[]> {
  const raw = query[field] ?? [];
  if (raw.length > ANSWER_LIMITS.maxValues) return tooMany(field);
  const ids = [...new Set(raw.filter((id) => id !== ''))];
  const missing = ids.find((id) => !exists(id));
  if (missing !== undefined) return fail({ code: unknown, field, message: `No ${noun} has the id "${shorten(missing)}".` });
  return { ok: true, value: ids };
}

/** Turn the URL's range, view and f_ filter into a resolved range and an AnswerFilter, or one message. Never throws. */
export function parseAnswerQuery(store: CallStore, span: DateRange | null, query: Query): Parsed<AnswerQuery> {
  const parsedRange = parseViewQuery(store, span, query);
  if (!parsedRange.ok) return parsedRange;

  const viewText = query['view']?.[0] ?? '';
  const view = viewText === '' ? 'overview' : ANSWER_VIEWS.find((v) => v === viewText);
  if (view === undefined) {
    return fail({ code: 'unknown_view', field: 'view', message: `Unknown view. Use one of: ${ANSWER_VIEWS.join(', ')}.` });
  }

  const officeIds = parseIds(query, 'f_office', (id) => store.locations.some((l) => l.id === id), 'unknown_location', 'office');
  if (!officeIds.ok) return officeIds;
  const campaignIds = parseIds(query, 'f_campaign', (id) => store.campaigns.some((c) => c.id === id), 'unknown_campaign', 'campaign');
  if (!campaignIds.ok) return campaignIds;

  const unattributed = (query['f_unattributed'] ?? []).filter((v) => v !== '');
  if (unattributed.length > 1 || (unattributed[0] !== undefined && unattributed[0] !== '0' && unattributed[0] !== '1')) {
    return fail({ code: 'bad_param', field: 'f_unattributed', message: 'The parameter f_unattributed must be 1 or 0.' });
  }

  const weekdays = parseInts(query, 'f_weekday', 0, 6);
  if (!weekdays.ok) return weekdays;
  const hours = parseInts(query, 'f_hour', 0, 23);
  if (!hours.ok) return hours;

  return {
    ok: true,
    value: {
      range: parsedRange.value.range,
      filter: {
        view,
        officeIds: officeIds.value,
        campaignIds: campaignIds.value,
        includeUnattributed: unattributed[0] === '1',
        weekdays: weekdays.value,
        hours: hours.value,
      },
    },
  };
}
