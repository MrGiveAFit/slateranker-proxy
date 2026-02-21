import React from "react";

type Direction = "OVER" | "UNDER";

export type PropChartData = {
  // newest -> oldest (left to right we’ll render oldest -> newest)
  values: number[];
  minutes: number[];
  line: number;
  pick: Direction;
  height?: number; // px
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function PropChart({ values, minutes, line, pick, height = 86 }: PropChartData) {
  const n = Math.min(values.length, minutes.length);
  const vals = values.slice(0, n);
  const mins = minutes.slice(0, n);

  // render oldest -> newest for “timeline feel”
  const series = [...vals].reverse();
  const minsSeries = [...mins].reverse();

  const maxVal = Math.max(line, ...series, 1);
  const maxMin = Math.max(...minsSeries, 1);

  const isOverPick = pick === "OVER";

  return (
    <div className="w-full">
      {/* Chart area */}
      <div className="relative w-full rounded-lg border border-border/40 bg-background/30 px-2 pt-3 pb-2">
        {/* Prop line */}
        <div
          className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/40"
          style={{
            top: `${clamp(100 - (line / maxVal) * 100, 0, 100)}%`,
          }}
        />

        {/* Bars */}
        <div className="flex items-end gap-1" style={{ height }}>
          {series.map((v, i) => {
            const hit = isOverPick ? v > line : v < line;
            const hPct = clamp((v / maxVal) * 100, 0, 100);

            // minutes dot position (0..100) mapped to chart height
            const mPct = clamp((minsSeries[i] / maxMin) * 100, 0, 100);

            return (
              <div key={i} className="relative flex-1">
                <div
                  className={[
                    "w-full rounded-sm",
                    hit ? "bg-emerald-500/70" : "bg-rose-500/60",
                  ].join(" ")}
                  style={{ height: `${hPct}%` }}
                  title={`${v.toFixed(1)} (min ${minsSeries[i]})`}
                />

                {/* minutes dot */}
                <div
                  className="absolute left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full bg-muted-foreground/70"
                  style={{ bottom: `${mPct}%` }}
                  title={`Minutes: ${minsSeries[i]}`}
                />
              </div>
            );
          })}
        </div>

        {/* Legend row */}
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            Line: <span className="font-mono">{line}</span>
          </span>
          <span>
            Minutes dots: <span className="font-mono">●</span>
          </span>
        </div>
      </div>

      {/* Tiny axis labels */}
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground/80">
        <span>Older</span>
        <span>Recent</span>
      </div>
    </div>
  );
}
