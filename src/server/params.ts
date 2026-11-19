import { checkDates, resolveRange } from '../core/ranges';
import type { DateRange, RangeSpec, ResolvedRange } from '../core/ranges';
import type { CallStore } from '../core/types';
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
    if (problem) return fail(problem);
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
      let field: string | undefined;
      if (problem.field === 'start') field = 'compareStart';
      else if (problem.field === 'end') field = 'compareEnd';
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
