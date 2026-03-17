import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../store";
import { getAuthCookie } from "../lib/api";

export function useAuth() {
  const { setAuthenticated } = useStore();

  useEffect(() => {
    // Check for persisted cookie on mount
    getAuthCookie().then((cookie) => {
      if (cookie) {
        setAuthenticated(true, cookie);
      }
    });

    // Listen for auth success from Rust backend
    const unlisten = listen("auth-success", async () => {
      const cookie = await getAuthCookie();
      if (cookie) {
        setAuthenticated(true, cookie);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setAuthenticated]);
}
