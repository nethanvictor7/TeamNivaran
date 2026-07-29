import { Component, type ErrorInfo, type ReactNode } from "react";

export class FeatureErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Error boundaries are the final recovery surface. Normal API failures are
    // handled inline and never reach this path.
    console.error("Portal rendering failure", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="auth-screen">
        <section className="login-card" role="alert">
          <p className="eyebrow">Safe recovery</p>
          <h1>This view could not be rendered</h1>
          <p>
            No data was changed. Retry the route; if the problem persists,
            provide the request correlation shown by the failed operation.
          </p>
          <button
            type="button"
            className="primary-button"
            onClick={() => this.setState({ failed: false })}
          >
            Retry view
          </button>
        </section>
      </main>
    );
  }
}
