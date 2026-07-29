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
<<<<<<< HEAD
          <p className="eyebrow">Something went wrong</p>
          <h1>We could not open this page</h1>
          <p>
            Your data has not changed. Try again, and if the problem continues,
            share the correlation reference shown with the error.
=======
          <p className="eyebrow">Safe recovery</p>
          <h1>This view could not be rendered</h1>
          <p>
            No data was changed. Retry the route; if the problem persists,
            provide the request correlation shown by the failed operation.
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
          </p>
          <button
            type="button"
            className="primary-button"
            onClick={() => this.setState({ failed: false })}
          >
<<<<<<< HEAD
            Try again
=======
            Retry view
>>>>>>> 952b6244f78c00b3e453e46683833a97e8a1919d
          </button>
        </section>
      </main>
    );
  }
}
