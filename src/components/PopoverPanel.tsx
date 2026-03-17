import { useStore } from "../store";
import { usePolling } from "../hooks/usePolling";
import { ProxyToggle } from "./sections/ProxyToggle";
import { RealtimeSection } from "./sections/RealtimeSection";
import { TodaySection } from "./sections/TodaySection";
import { WeekSection } from "./sections/WeekSection";
import { Footer } from "./Footer";

export function PopoverPanel() {
  usePolling();
  const { loading, error } = useStore();

  return (
    <div className="h-full p-2 flex flex-col">
      {/* Card with drop shadow */}
      <div
        className="flex-1 bg-white rounded-2xl flex flex-col overflow-hidden"
        style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)" }}
      >
        {/* Loading bar */}
        {loading && (
          <div className="h-0.5 bg-gray-100 overflow-hidden rounded-t-2xl">
            <div className="h-full w-1/3 bg-gray-400 animate-pulse" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-4 py-2 bg-red-50 text-red-500 text-xs border-b border-red-100">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <RealtimeSection />
          <Divider />
          <TodaySection />
          <Divider />
          <WeekSection />
          <Divider />
          <ProxyToggle />
        </div>

        <div className="border-t border-gray-100">
          <Footer />
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-gray-100 mx-4" />;
}
