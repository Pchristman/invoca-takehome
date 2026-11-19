import type { UrlState } from '../urlState';

// Changing the range or the office must put the callback list back on page 1.
// The list is remounted when this key changes, so the key names exactly what should reset it.
export function pageKey(range: { start: string; end: string }, state: Pick<UrlState, 'location'>): string {
  return `${range.start}|${range.end}|${state.location ?? ''}`;
}
