// While a screen reloads for a new range, comparison, campaign or office, the last reply stays on screen (dimmed, not clickable)
// so the page does not blank and flash. A different view, a first load, and a retry never keep old data.
import type { RequestState } from '../requestState';

/** The request without its retry count: `/api/campaigns?range=last28&campaign=a`. */
function parts(key: string): { path: string; others: string; filters: string } {
  const [path = '', query = ''] = (key.split('#')[0] ?? '').split('?');
  const params = new URLSearchParams(query);
  const filters = JSON.stringify([params.get('campaign'), params.get('location')]);
  params.delete('campaign');
  params.delete('location');
  params.sort();
  return { path, others: params.toString(), filters };
}

/** True when the next request is for the same view and differs from the last ready one only by its range, comparison, campaign or office. */
export function keepPreviousFor(previousKey: string | null, nextKey: string): boolean {
  if (previousKey === null) return false;
  const before = parts(previousKey);
  const next = parts(nextKey);
  return before.path === next.path && (before.others !== next.others || before.filters !== next.filters);
}

/** What to show: the new state, or the last ready data (marked busy) while a change of range, comparison, campaign or office loads. */
export function displayState<T>(
  lastReady: { key: string; data: T } | null,
  state: RequestState<T> | null,
): { state: RequestState<T> | null; busy: boolean } {
  if (state !== null && state.status === 'loading' && lastReady !== null && keepPreviousFor(lastReady.key, state.key)) {
    return { state: { status: 'ready', key: state.key, data: lastReady.data }, busy: true };
  }
  return { state, busy: false };
}
