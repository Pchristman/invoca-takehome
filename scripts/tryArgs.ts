import type { ViewName } from '../src/core/views';
import { QUESTION_MAX_CHARS } from '../src/server/questionQuery';

export const TRY_VIEWS: readonly ViewName[] = ['overview', 'campaigns', 'locations', 'missed-calls'];
export const TRY_USAGE =
  'Usage: npm run ai:try -- <view|all> [range]   (range: last7, last28 or all; default all)\n' +
  '   or: npm run ai:try -- --question "<text>" [--question "<text>" ...]';

export interface TryArgs {
  views: ViewName[];
  range: string;
  questions: string[];
}

/** `--question "text"` (repeatable) and nothing else: one real question per option. */
function parseQuestions(argv: string[]): string[] {
  const questions: string[] = [];
  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1];
    if (argv[i] !== '--question' || value === undefined || value.trim() === '') {
      throw new Error(`--question needs a non-empty question, and cannot be mixed with a view.\n${TRY_USAGE}`);
    }
    if (value.trim().length > QUESTION_MAX_CHARS) {
      throw new Error(`A --question is at most ${QUESTION_MAX_CHARS} characters.`);
    }
    questions.push(value.trim());
  }
  return questions;
}

/**
 * `npm run ai:try -- <view|all> [range]`: which views to ask about, and over which range.
 * `npm run ai:try -- --question "text"`: which questions to ask instead (no views).
 */
export function parseTryArgs(argv: string[]): TryArgs {
  if (argv.includes('--question')) return { views: [], range: 'all', questions: parseQuestions(argv) };
  const [target, range = 'all'] = argv;
  if (!target) throw new Error(TRY_USAGE);
  if (target === 'all') return { views: [...TRY_VIEWS], range, questions: [] };
  const view = TRY_VIEWS.find((v) => v === target);
  if (!view) throw new Error(`Unknown view "${target.slice(0, 40)}". Use one of: ${TRY_VIEWS.join(', ')}, all.`);
  return { views: [view], range, questions: [] };
}

/** One takeaway reply as text to print. ok is false for an error reply (the caller sets the exit code). */
export function formatTryResult(view: string, status: number, body: unknown): { ok: boolean; text: string } {
  const b = (body ?? {}) as { text?: string; source?: string; reason?: string | null; error?: { message?: string } };
  if (status !== 200 || typeof b.source !== 'string') {
    const message = b.error?.message ?? 'No error message in the reply.';
    return { ok: false, text: `\n${view}: HTTP ${status}\n${message}` };
  }
  return { ok: true, text: `\n${view}: source=${b.source} reason=${b.reason ?? '-'}\n${b.text ?? ''}` };
}

export type QuestionOutcome =
  | { ok: true; cached: boolean; value: string }
  | { ok: false; reason: string; detail: string | null };

/** One question's outcome as text. The question itself is never printed (only its number). */
export function formatQuestionResult(number: number, outcome: QuestionOutcome, costUsd: number): string {
  const cost = `cost=$${costUsd.toFixed(6)}`;
  if (outcome.ok) {
    return `\nquestion ${number}: ok cached=${outcome.cached ? 'yes' : 'no'} ${cost}\n  query: ${outcome.value}`;
  }
  const detail = outcome.detail === null ? '' : `\n  detail: ${outcome.detail}`;
  return `\nquestion ${number}: failed reason=${outcome.reason} ${cost}${detail}`;
}
