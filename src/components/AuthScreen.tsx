import { useState } from "react";
import { useStore } from "../store";
import { startAuthFlow, setAuthCookie } from "../lib/api";

export function AuthScreen() {
  const { setAuthenticated } = useStore();
  const [manualCookie, setManualCookie] = useState("");
  const [showManual, setShowManual] = useState(false);

  const handleGoogleSignIn = async () => {
    try {
      await startAuthFlow();
    } catch (e) {
      console.error("Auth flow error:", e);
    }
  };

  const handleManualAuth = async () => {
    if (!manualCookie.trim()) return;
    await setAuthCookie(manualCookie.trim());
    setAuthenticated(true, manualCookie.trim());
  };

  return (
    <div className="h-full p-2 flex flex-col">
      <div
        className="flex-1 bg-white rounded-2xl flex flex-col items-center justify-center px-6"
        style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)" }}
      >
        <div className="text-xl font-bold mb-1 text-gray-900">Tailor Bar</div>
        <p className="text-gray-400 text-sm mb-8 text-center">
          Connect to your AI usage dashboard
        </p>

        <button
          onClick={handleGoogleSignIn}
          className="w-full bg-gray-900 text-white font-medium py-2.5 px-4 rounded-xl hover:bg-gray-700 transition-colors mb-3 text-sm"
        >
          Sign in with Google
        </button>

        <button
          onClick={() => setShowManual(!showManual)}
          className="text-gray-400 text-xs hover:text-gray-600 transition-colors"
        >
          {showManual ? "Hide" : "Enter session cookie manually"}
        </button>

        {showManual && (
          <div className="mt-4 w-full">
            <input
              type="text"
              value={manualCookie}
              onChange={(e) => setManualCookie(e.target.value)}
              placeholder="Paste cookie value..."
              className="w-full bg-gray-50 text-gray-800 text-sm px-3 py-2 rounded-xl border border-gray-200 focus:border-gray-400 focus:outline-none mb-2"
            />
            <button
              onClick={handleManualAuth}
              className="w-full bg-gray-100 text-gray-700 text-sm py-2 px-4 rounded-xl hover:bg-gray-200 transition-colors"
            >
              Connect
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
