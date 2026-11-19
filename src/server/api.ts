import type { RangeErrorCode } from '../core/ranges';

/** The range presets a URL may name, and the one used when none is given. */
export const PRESETS = ['last7', 'last28', 'all'] as const;
export const DEFAULT_PRESET = 'last28';

export type ApiErrorCode =
  | RangeErrorCode
  | 'bad_param'
  | 'unknown_campaign'
  | 'unknown_location'
  | 'unknown_view'
  | 'not_found'
  | 'internal';

/** The body of every error response is `{ error: ApiError }`. */
export interface ApiError {
  code: ApiErrorCode;
  message: string;
  /** The parameter at fault, so a form can mark the right box. */
  field?: string;
}

/** no_data is 409, not_found 404, internal 500; every other code is the caller's mistake: 400. */
export function statusFor(code: ApiErrorCode): 400 | 404 | 409 | 500 {
  if (code === 'no_data') return 409;
  if (code === 'not_found') return 404;
  if (code === 'internal') return 500;
  return 400;
}

/** Keep text that came from a URL short in a message: over 40 characters, the first 40 plus "...". Same rule as checkDates. */
export function shorten(text: string): string {
  return text.length > 40 ? `${text.slice(0, 40)}...` : text;
}
