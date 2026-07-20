const MODEL_COLORS: Record<string, string> = {
  Opus: "model-bar-magenta",
  Sonnet: "model-bar-cyan",
  Haiku: "model-bar-cyan",
};

interface ModelBarProps {
  name: string;
  pct: number;
}

export function ModelBar({ name, pct }: ModelBarProps) {
  const color = MODEL_COLORS[name] ?? "model-bar-cyan";

  return (
    <div className="model-bar-row">
      <div className="model-bar-track">
        <div
          className={`model-bar-fill ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="model-bar-label">
        {name} {pct}%
      </span>
    </div>
  );
}
