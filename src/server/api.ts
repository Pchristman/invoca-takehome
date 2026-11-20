import type { DateRange, RangeErrorCode } from '../core/ranges';
import type { DataNotes } from '../core/types';
import type { ViewName } from '../core/views';
import type { QuestionReason, TakeawayReason } from '../ai/types';
import type { AnswerView } from '../core/answer';

/** The range presets a URL may name, and the one used when none is given. */
export const PRESETS = ['last7', 'last28', 'all'] as const;
export const DEFAULT_PRESET = 'last28';

/** The body of GET /api/meta: what the date control and the pickers need before any range is chosen. */
export interface Meta {
  hasData: boolean;
  callCount: number;
  span: DateRange | null;
  /** Store order. */
  campaigns: { id: string; name: string }[];
  /** Store order. */
  locations: { id: string; name: string }[];
  presets: typeof PRESETS;
  defaultPreset: typeof DEFAULT_PRESET;
  /** store.dataNotes.badRows */
  skippedRows: number;
  /** store.dataNotes.notes, e.g. "calls.csv is empty: ..." */
  notes: string[];
  /** Whether the question box can be used. */
  aiStatus: 'on' | 'off' | 'budget_reached';
}

/** The body of GET /api/data-notes. `ai` has its final shape now; Phase 9 fills it in. */
export interface AiStatus {
  status: 'on' | 'off' | 'budget_reached';
  spendUsd: number;
  cacheHits: number;
  checkerFailures: number;
}

export interface DataNotesResponse {
  dataNotes: DataNotes;
  ai: AiStatus;
}

/** The body of GET /api/takeaway/:view. `reason` is null exactly when the text is AI-written and checked. */
export type TakeawayResponse =
  | { view: ViewName; text: string; source: 'ai'; reason: null }
  | { view: ViewName; text: string; source: 'template'; reason: TakeawayReason };

/** The body of GET /api/answer: the answer plus the names of the selected ids, so the page can print how the question was read. */
export type AnswerResponse = AnswerView & {
  names: { offices: { id: string; name: string }[]; campaigns: { id: string; name: string }[] };
};

/** The body of GET /api/question: a validated query string (from a model reply, checked by code), or why not. */
export type QuestionResponse =
  | { ok: true; source: 'ai'; cached: boolean; query: string }
  | { ok: false; reason: QuestionReason; message: string };

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
