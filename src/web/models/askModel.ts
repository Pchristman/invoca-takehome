// What the question box shows. Pure: AI status and the request state in, plain strings out.
import type { QuestionReason } from '../../ai/types';
import type { Meta, QuestionResponse } from '../../server/api';
import type { RequestState } from '../requestState';

export type AskShow =
  | { box: 'hidden'; note: string }
  | { box: 'shown'; busy: boolean; message: string | null; examples: string[] | null };

export const AI_OFF_NOTE = 'Ask a question needs an AI key. Set ANTHROPIC_API_KEY and restart.';

/** Three kinds of question the box can answer. No names, no numbers: they must work on any export. */
export const EXAMPLE_QUESTIONS: string[] = [
  'Which office misses the most calls on Fridays?',
  'How many calls came in on weekends?',
  'Which campaign gets the most calls in the mornings?',
];

// The same sentences the server sends (Task 4). invalid_filter carries the server's own detail.
const MESSAGES: Record<Exclude<QuestionReason, 'invalid_filter'>, string> = {
  ai_off: 'Questions need an AI key.',
  budget_reached: 'The AI budget for this app is used up.',
  timeout: "The AI service didn't answer. Try again.",
  api_error: "The AI service didn't answer. Try again.",
  refusal: "Couldn't turn that into a filter. Try rewording it.",
  malformed: "Couldn't turn that into a filter. Try rewording it.",
  unanswerable: "That isn't a question about these calls.",
  log_unavailable: 'AI is off for this session.',
};

const WITH_EXAMPLES: QuestionReason[] = ['invalid_filter', 'malformed', 'refusal', 'unanswerable'];

function failureMessage(reply: Extract<QuestionResponse, { ok: false }>): string {
  if (reply.reason === 'invalid_filter') return reply.message;
  // A client-side api_error ("Can't reach the data.") keeps its own sentence.
  if (reply.reason === 'api_error' && reply.message !== '') return reply.message;
  return MESSAGES[reply.reason];
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
