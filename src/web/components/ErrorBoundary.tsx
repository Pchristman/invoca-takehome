import { Component } from 'react';
import type { ReactNode } from 'react';
import { Link } from './Link';

/** What the user sees if a component throws while rendering. Never a blank page. */
export function ErrorFallback() {
  return (
    <div role="alert" className="notice">
      <p>Something went wrong showing this page. Reload to try again.</p>
      <p>
        <button type="button" className="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </p>
    </div>
  );
}

/** The content area failed to draw. The header, nav and range control above it still work. */
export function ContentErrorFallback({ resetHref }: { resetHref: string }) {
  return (
    <div role="alert" className="notice">
      <p>Something went wrong showing this view. Choose another view or range, or reset.</p>
      <p>
        <Link href={resetHref}>Reset to defaults</Link>
      </p>
    </div>
  );
}

/**
 * Catches render errors anywhere below it and shows the fallback instead of unmounting the app.
 * Give it a key to start over: a new key mounts a fresh boundary that tries the children again.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback ?? <ErrorFallback />;
  }
}
