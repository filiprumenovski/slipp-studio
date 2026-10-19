import React from "react";
import { MotionConfig } from "motion/react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <main className="fatal">
        <h1>Studio could not render.</h1>
        <p>{this.state.error}</p>
        <button onClick={() => location.reload()}>Restart Studio</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </ErrorBoundary>,
);
