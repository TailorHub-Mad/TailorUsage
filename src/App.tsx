import { Component, useEffect, type ReactNode } from "react";
import { useStore } from "./store";
import { PopoverPanel } from "./components/PopoverPanel";
import {
  checkForUpdate,
  getAppVersion,
  getHideFromDock,
  getLaunchAtLogin,
  getPreferences,
} from "./lib/api";

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
  const {
    setAppVersion,
    setHideFromDock,
    setLaunchAtLogin,
    setPreferences,
    setUpdateInfo,
  } = useStore();

  useEffect(() => {
    getAppVersion().then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => {
    getPreferences().then(setPreferences).catch(() => {});
    getLaunchAtLogin().then(setLaunchAtLogin).catch(() => {});
    getHideFromDock().then(setHideFromDock).catch(() => {});
  }, [setHideFromDock, setLaunchAtLogin, setPreferences]);

  useEffect(() => {
    checkForUpdate().then(setUpdateInfo).catch(() => {});
  }, [setUpdateInfo]);

  return (
    <ErrorBoundary>
      <div className="h-full">
        <PopoverPanel />
      </div>
    </ErrorBoundary>
  );
}

export default App;
