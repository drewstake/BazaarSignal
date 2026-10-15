import { Component, type ReactNode } from "react";

/** A missing lazy chunk or malformed view must leave a recoverable screen. */
export default class ViewBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="auth-loading">
        <div role="alert">
          <p>
            This view could not load. Your saved portfolio is still available.
          </p>
          <button onClick={() => location.reload()}>Reload BazaarSignal</button>
        </div>
      </main>
    ) : (
      this.props.children
    );
  }
}
