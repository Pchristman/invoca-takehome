import { addDays, daysBetween, isLocalDate } from './localDate';
import type { LocalDate } from './localDate';
import type { CleanCall } from './types';

/** A run of local dates, inclusive at both ends. */
export interface DateRange {
  start: LocalDate;
  end: LocalDate;
}

export interface ResolvedRange extends DateRange {
  days: number;
  /** True when the request reached outside the data and was cut to fit. */
  clamped: boolean;
}

export type RangeSpec =
  | { kind: 'preset'; preset: 'last7' | 'last28' | 'all' }
  /** Raw strings from the URL: they may be anything. */
  | { kind: 'custom'; start: string; end: string };

export type RangeErrorCode = 'no_data' | 'bad_date' | 'start_after_end' | 'outside_data';

export interface RangeError {
  code: RangeErrorCode;
  message: string;
}

export type RangeResult = { ok: true; range: ResolvedRange } | { ok: false; error: RangeError };

const PRESET_DAYS = { last7: 7, last28: 28 } as const;

/** First and last local date of any call; null when there are no calls. */
export function dataSpan(calls: readonly CleanCall[]): DateRange | null {
  let start: LocalDate | null = null;
  let end: LocalDate | null = null;
  for (const call of calls) {
    if (start === null || call.localDate < start) start = call.localDate;
    if (end === null || call.localDate > end) end = call.localDate;
  }
  return start === null || end === null ? null : { start, end };
}

/** The first problem with a pair of raw dates, or null: a bad date comes before start-after-end. */
export function checkDates(start: string, end: string): RangeError | null {
  for (const value of [start, end]) {
    if (!isLocalDate(value)) {
      return { code: 'bad_date', message: `"${value}" is not a date. Use the form YYYY-MM-DD, for example 2026-09-30.` };
    }
  }
  if (start > end) {
    return { code: 'start_after_end', message: `The start date ${start} is after the end date ${end}.` };
  }
  return null;
}

function lengthOf(range: DateRange): number {
  return daysBetween(range.start, range.end) + 1;
}

/** Turn a preset or custom request into a range inside the data, or say why that can't be done. */
export function resolveRange(span: DateRange | null, spec: RangeSpec): RangeResult {
  if (span === null) {
    return { ok: false, error: { code: 'no_data', message: 'There are no calls in this export, so there is no date range to show.' } };
  }

  if (spec.kind === 'preset') {
    if (spec.preset === 'all') return { ok: true, range: { ...span, days: lengthOf(span), clamped: false } };
    const wanted = addDays(span.end, -(PRESET_DAYS[spec.preset] - 1));
    const start = wanted < span.start ? span.start : wanted;
    const range = { start, end: span.end };
    return { ok: true, range: { ...range, days: lengthOf(range), clamped: start !== wanted } };
  }

  const problem = checkDates(spec.start, spec.end);
  if (problem) return { ok: false, error: problem };

  if (spec.end < span.start || spec.start > span.end) {
    return {
      ok: false,
      error: {
        code: 'outside_data',
        message: `${spec.start} to ${spec.end} has no data. The data runs from ${span.start} to ${span.end}.`,
      },
    };
  }

  const start = spec.start < span.start ? span.start : spec.start;
  const end = spec.end > span.end ? span.end : spec.end;
  const range = { start, end };
  return { ok: true, range: { ...range, days: lengthOf(range), clamped: start !== spec.start || end !== spec.end } };
}
