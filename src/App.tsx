import { Component, type ReactNode } from "react";
import { useStore } from "./store";
import { useAuth } from "./hooks/useAuth";
import { AuthScreen } from "./components/AuthScreen";
import { PopoverPanel } from "./components/PopoverPanel";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: Error) {
    return { error: `${err.message}\n${err.stack}` };
  }
  render() {
    if (this.state.error)
      return (
        <pre style={{ color: "red", fontSize: 11, padding: 12, whiteSpace: "pre-wrap" }}>
          {this.state.error}
        </pre>
      );
    return this.props.children;
  }
}

function App() {
  useAuth();
  const { isAuthenticated } = useStore();

  return (
    <ErrorBoundary>
      <div className="h-full">
        {isAuthenticated ? <PopoverPanel /> : <AuthScreen />}
      </div>
    </ErrorBoundary>
  );
}

export default App;
