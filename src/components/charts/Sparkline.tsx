import { AreaChart, Area, ResponsiveContainer } from "recharts";

interface SparklineProps {
  data: { date: string; value: number }[];
}

export function Sparkline({ data }: SparklineProps) {
  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00ffff" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#00ffff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke="#00ffff"
            strokeWidth={1.5}
            fill="url(#sparkGrad)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
