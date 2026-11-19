import { Component } from 'react';
import type { ReactNode } from 'react';

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

/** Catches render errors anywhere below it and shows the fallback instead of unmounting the app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <ErrorFallback /> : this.props.children;
  }
}
