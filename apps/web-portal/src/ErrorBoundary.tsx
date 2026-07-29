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
          <p className="eyebrow">Something went wrong</p>
          <h1>We could not open this page</h1>
          <p>
            Your data has not changed. Try again, and if the problem continues,
            share the correlation reference shown with the error.
          </p>
          <button
            type="button"
            className="primary-button"
            onClick={() => this.setState({ failed: false })}
          >
            Try again
          </button>
        </section>
      </main>
    );
  }
}
