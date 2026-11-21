import type { UrlState } from '../urlState';

// Changing the office must put the callback list back on page 1: the view remembers the page with this key and
// starts at page 1 again when the key changes. A new range already remounts the whole content (see contentKey),
// which resets the page too; the range stays in the key so this rule does not lean on that.
export function pageKey(range: { start: string; end: string }, state: Pick<UrlState, 'location'>): string {
  return `${range.start}|${range.end}|${state.location ?? ''}`;
}
