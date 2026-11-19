import type { ApiResult, ClientError } from './api';

export type RequestState<T> =
  | { status: 'loading'; key: string }
  | { status: 'ready'; key: string; data: T }
  | { status: 'failed'; key: string; error: ClientError };

export type RequestAction<T> = { type: 'start'; key: string } | { type: 'done'; key: string; result: ApiResult<T> };

export function initialRequest<T>(key: string): RequestState<T> {
  return { status: 'loading', key };
}

export function requestReducer<T>(state: RequestState<T>, action: RequestAction<T>): RequestState<T> {
  if (action.type === 'start') {
    // Old data is dropped: stale numbers must never show under a new range label.
    return { status: 'loading', key: action.key };
  }
  // A reply for a request that is no longer the current one is ignored.
  if (action.key !== state.key) return state;
  if (action.result.ok) return { status: 'ready', key: action.key, data: action.result.data };
  return { status: 'failed', key: action.key, error: action.result.error };
}
