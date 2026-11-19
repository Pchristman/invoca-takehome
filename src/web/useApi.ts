import { useCallback, useEffect, useReducer, useState } from 'react';
import { fetchApi } from './api';
import { initialRequest, requestReducer } from './requestState';
import type { RequestState } from './requestState';

// No test of its own: every decision is in fetchApi (what a reply means) and
// requestReducer (which reply wins). This hook only connects them to React.

/** Fetch `path` with `params`. A null path means no request and a null state. `retry` runs the same request again. */
export function useApi<T>(path: string | null, params: URLSearchParams): { state: RequestState<T> | null; retry(): void } {
  const [attempt, setAttempt] = useState(0);
  const query = params.toString();
  const key = `${path}?${query}#${attempt}`;
  const [state, dispatch] = useReducer(requestReducer<T>, key, initialRequest<T>);

  useEffect(() => {
    if (path === null) return;
    // One controller per effect run; the cleanup aborts it when the key changes or the component unmounts.
    const controller = new AbortController();
    dispatch({ type: 'start', key });
    fetchApi<T>(path, new URLSearchParams(query), controller.signal).then((result) => {
      if (controller.signal.aborted) return; // an aborted request never dispatches
      dispatch({ type: 'done', key, result });
    });
    return () => controller.abort();
  }, [path, query, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  // On the render where the key has just changed, the effect has not yet dispatched 'start',
  // so state.key is the old key. Show loading rather than the old request's data.
  if (path === null) return { state: null, retry };
  return { state: state.key === key ? state : initialRequest<T>(key), retry };
}
