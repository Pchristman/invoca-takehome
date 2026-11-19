import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { parseUrlState, toSearch } from './urlState';
import type { UrlState } from './urlState';

// The URL is the only state. history.pushState does not fire any event, so every write
// in the app goes through pushUrl, which tells all listeners (the hook, via Link too).
const CHANGE_EVENT = 'urlstatechange';

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener); // back and forward buttons
  window.addEventListener(CHANGE_EVENT, listener); // our own writes
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

/** Write a URL (path and query) to the history and notify every listener. */
export function pushUrl(href: string, mode: 'push' | 'replace' = 'push'): void {
  if (mode === 'replace') window.history.replaceState(null, '', href);
  else window.history.pushState(null, '', href);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useUrlState(): { state: UrlState; navigate(next: UrlState, mode?: 'push' | 'replace'): void } {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => '');
  const state = useMemo(() => parseUrlState(search), [search]);
  const navigate = useCallback((next: UrlState, mode: 'push' | 'replace' = 'push') => {
    pushUrl(`${window.location.pathname}${toSearch(next)}`, mode);
  }, []);
  return { state, navigate };
}
