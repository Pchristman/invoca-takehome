import type { TakeawayResponse } from '../../server/api';
import type { RequestState } from '../requestState';

export type TakeawayShow =
  | { kind: 'hidden' }
  | { kind: 'loading'; label: string }
  | { kind: 'ready'; text: string; marker: 'AI' | 'template' };

/**
 * What the takeaway line shows. A missing or failed takeaway is hidden: the view is complete without it,
 * and the view's own request reports any real error. Loading never carries old text.
 */
export function takeawayModel(state: RequestState<TakeawayResponse> | null): TakeawayShow {
  if (state === null || state.status === 'failed') return { kind: 'hidden' };
  if (state.status === 'loading') return { kind: 'loading', label: 'Loading takeaway...' };
  const { text, source } = state.data;
  return { kind: 'ready', text, marker: source === 'ai' ? 'AI' : 'template' };
}
