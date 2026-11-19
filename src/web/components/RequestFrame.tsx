import type { ReactNode } from 'react';
import { describeError } from '../models/errors';
import type { RequestState } from '../requestState';
import { Link } from './Link';

/** Loading, failed or ready, for any request. Prints; decides nothing beyond which of the three. */
export function RequestFrame<T>({
  state,
  loadingLabel,
  resetHref,
  onRetry,
  children,
}: {
  state: RequestState<T> | null;
  loadingLabel: string;
  resetHref: string;
  onRetry(): void;
  children(data: T): ReactNode;
}) {
  if (state === null || state.status === 'loading') {
    return (
      <p role="status" className="loading">
        {loadingLabel}
      </p>
    );
  }
  if (state.status === 'failed') {
    const copy = describeError(state.error);
    return (
      <div role="alert" className="notice">
        <h2>{copy.title}</h2>
        <p>{copy.message}</p>
        {copy.canReset && (
          <p>
            <Link href={resetHref}>Reset to defaults</Link>
          </p>
        )}
        {copy.canRetry && (
          <p>
            <button type="button" className="button" onClick={onRetry}>
              Try again
            </button>
          </p>
        )}
      </div>
    );
  }
  return <>{children(state.data)}</>;
}
