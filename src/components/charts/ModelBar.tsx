const MODEL_COLORS: Record<string, string> = {
  Opus: "bg-purple-500",
  Sonnet: "bg-blue-500",
  Haiku: "bg-emerald-500",
};

interface ModelBarProps {
  name: string;
  pct: number;
}

export function ModelBar({ name, pct }: ModelBarProps) {
  const color = MODEL_COLORS[name] ?? "bg-neutral-500";

  return (
    <div className="flex items-center gap-2 mb-1">
      <div className="flex-1 h-2 bg-neutral-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-neutral-400 w-20 text-right">
        {name} {pct}%
      </span>
    </div>
  );
}
