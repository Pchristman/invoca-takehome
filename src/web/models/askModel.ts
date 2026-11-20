// What the question box shows. Pure: AI status and the request state in, plain strings out.
import type { QuestionReason } from '../../ai/types';
import type { Meta, QuestionResponse } from '../../server/api';
import type { RequestState } from '../requestState';

export type AskShow =
  | { box: 'hidden'; note: string }
  | { box: 'shown'; busy: boolean; message: string | null; examples: string[] | null };

export const AI_OFF_NOTE = 'Ask a question needs AI. Set ANTHROPIC_API_KEY, make sure the logs folder is writable, and restart.';

/** Three kinds of question the box can answer. No names, no numbers: they must work on any export. */
export const EXAMPLE_QUESTIONS: string[] = [
  'Which office misses the most calls on Fridays?',
  'How many calls came in on weekends?',
  'Which campaign gets the most calls in the mornings?',
];

const WITH_EXAMPLES: QuestionReason[] = ['invalid_filter', 'malformed', 'refusal', 'unanswerable'];

const FALLBACK_MESSAGE = "Couldn't answer that. Try again.";

/** The server's text for every failure (the client-side api_error carries its own). Never a copy of the server's table. */
function failureMessage(reply: Extract<QuestionResponse, { ok: false }>): string {
  return reply.message !== '' ? reply.message : FALLBACK_MESSAGE;
}

/** Is a reply still wanted? Not if a newer question was submitted, or this one was cancelled (unmount, new submit). */
export function replyWanted(submit: { submitId: number; latestId: number; aborted: boolean }): boolean {
  return !submit.aborted && submit.submitId === submit.latestId;
}

export function askModel(meta: Pick<Meta, 'aiStatus'>, request: RequestState<QuestionResponse> | null): AskShow {
  if (meta.aiStatus === 'off') return { box: 'hidden', note: AI_OFF_NOTE };
  if (request === null) return { box: 'shown', busy: false, message: null, examples: null };
  if (request.status === 'loading') return { box: 'shown', busy: true, message: null, examples: null };
  if (request.status === 'failed') return { box: 'shown', busy: false, message: request.error.message, examples: null };
  const reply = request.data;
  if (reply.ok) return { box: 'shown', busy: false, message: null, examples: null }; // the page is about to navigate
  return {
    box: 'shown',
    busy: false,
    message: failureMessage(reply),
    examples: WITH_EXAMPLES.includes(reply.reason) ? EXAMPLE_QUESTIONS : null,
  };
}
