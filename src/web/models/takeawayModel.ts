import type { TakeawayReason } from '../../ai/types';
import type { TakeawayResponse } from '../../server/api';
import type { RequestState } from '../requestState';

export type TakeawayShow =
  | { kind: 'hidden' }
  | { kind: 'loading'; label: string }
  | { kind: 'ready'; text: string; marker: 'AI' | 'template'; note: string | null };

// A Record, so a new reason will not compile until it has a sentence.
const REASON_NOTES: Record<TakeawayReason, string> = {
  ai_off: 'AI is off: no API key.',
  budget_reached: 'AI budget reached.',
  no_facts: 'There were no facts to write about.',
  timeout: 'The AI took too long to answer.',
  api_error: 'The AI service returned an error.',
  refusal: 'The AI declined to write this one.',
  malformed: 'The AI reply could not be read.',
  check_failed: 'The AI text failed its check.',
  log_unavailable: 'AI is off: the call log could not be used.',
};

/**
 * What the takeaway line shows. A missing or failed takeaway is hidden: the view is complete without it,
 * and the view's own request reports any real error. Loading never carries old text.
 */
export function takeawayModel(state: RequestState<TakeawayResponse> | null, options: { dev: boolean }): TakeawayShow {
  if (state === null || state.status === 'failed') return { kind: 'hidden' };
  if (state.status === 'loading') return { kind: 'loading', label: 'Loading takeaway...' };
  const { text, source, reason } = state.data;
  if (source === 'ai') return { kind: 'ready', text, marker: 'AI', note: null };
  return { kind: 'ready', text, marker: 'template', note: options.dev ? REASON_NOTES[reason] : null };
}
