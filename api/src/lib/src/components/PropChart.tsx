// src/components/PropChart.tsx
import React from "react";

type Direction = "OVER" | "UNDER";

export type PropChartData = {
  // newest -> oldest (left to right)
  values: number[];
  minutes?: number[];
  line: number;
  pick: Direction;

  // Optional upgrades (from ProjectionResult)
  projection?: number; // mean projection
  floor?: number;      // p10
  ceiling?: number;    // p90

  height?: number; // px
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function fmt(n: number) {
  // cleaner small labels
  if (!Number.isFinite(n)) return "0";
  const isInt = Math.abs(n - Math.round(n)) < 1e-9;
  return isInt ? String(Math.round(n)) : n.toFixed(1);
}

function isHit(value: number, line: number, pick: Direction) {
  if (pick === "OVER") return value > line;
  return value < line;
}

export function PropChart({
  values,
  minutes = [],
  line,
  pick,
  projection,
  floor,
  ceiling,
  height = 78,
}: PropChartData) {
  const safeVals = (values || []).map((v) => (Number.isFinite(v) ? v : 0));
  const n = safeVals.length;

  // y-scale max: include line + projection + ceiling so reference lines always fit
  const maxVal = Math.max(
    1,
    ...safeVals,
    Number.isFinite(line) ? line : 0,
    Number.isFinite(projection ?? NaN) ? (projection as number) : 0,
    Number.isFinite(ceiling ?? NaN) ? (ceiling as number) : 0
  );

  const yMax = Math.ceil(maxVal * 1.15 * 10) / 10; // headroom

  // Convert a stat value into a percent-from-bottom for absolute positioning
  const yPct = (v: number) => clamp((v / yMax) * 100, 0, 100);

  // Reference lines positions
  const linePct = yPct(line);
  const projPct = projection != null ? yPct(projection) : null;

  // Range band (p10..p90)
  const hasBand = floor != null && ceiling != null && ceiling >= floor;
  const bandTopPct = hasBand ? yPct(ceiling as number) : null;
  const bandBotPct = hasBand ? yPct(floor as number) : null;

  return (
    <div className="w-full">
      {/* Top mini legend */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono">
            Line: <span className="text-foreground">{fmt(line)}</span>
          </span>
          {projection != null && (
            <span className="font-mono">
              Proj: <span className="text-foreground">{fmt(projection)}</span>
            </span>
          )}
          {hasBand && (
            <span className="font-mono">
              Range:{" "}
              <span className="text-foreground">
                {fmt(floor as number)}–{fmt(ceiling as number)}
              </span>
            </span>
          )}
        </div>
        <div className="font-mono">
          L{n || 0}
        </div>
      </div>

      {/* Chart */}
      <div
        className="relative w-full rounded-md border border-border/60 bg-background/30 overflow-hidden"
        style={{ height }}
      >
        {/* P10–P90 band */}
        {hasBand && bandTopPct != null && bandBotPct != null && (
          <div
            className="absolute left-0 right-0 bg-primary/10"
            style={{
              bottom: `${bandBotPct}%`,
              height: `${Math.max(0, bandTopPct - bandBotPct)}%`,
            }}
            aria-hidden
          />
        )}

        {/* Sportsbook line */}
        <div
          className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/60"
          style={{ bottom: `${linePct}%` }}
          aria-hidden
        />
        <div
          className="absolute left-2 text-[10px] text-muted-foreground font-mono"
          style={{ bottom: `calc(${linePct}% + 2px)` }}
        >
          line {fmt(line)}
        </div>

        {/* Projection line */}
        {projPct != null && (
          <>
            <div
              className="absolute left-0 right-0 border-t border-dashed border-primary/70"
              style={{ bottom: `${projPct}%` }}
              aria-hidden
            />
            <div
              className="absolute right-2 text-[10px] text-primary font-mono"
              style={{ bottom: `calc(${projPct}% + 2px)` }}
            >
              proj {fmt(projection as number)}
            </div>
          </>
        )}

        {/* Bars */}
        <div className="absolute inset-0 flex items-end gap-1 px-2 pb-2">
          {safeVals.map((v, i) => {
            const hit = isHit(v, line, pick);
            const hPct = yPct(v);
            const min = minutes[i];
            const showTooltip = true;

            // Colors:
            // - "hit" is green-ish via bg-emerald
            // - "miss" is red-ish via bg-rose
            // (If your Tailwind palette differs, swap these classes.)
            const barClass = hit ? "bg-emerald-500/80" : "bg-rose-500/75";

            return (
              <div
                key={i}
                className="group relative flex-1 min-w-[6px]"
                aria-label={`Game ${i + 1}`}
              >
                <div
                  className={`w-full rounded-sm ${barClass}`}
                  style={{ height: `${hPct}%` }}
                />

                {/* Tooltip */}
                {showTooltip && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block">
                    <div className="rounded-md border border-border bg-background px-2 py-1 shadow text-[11px] font-mono whitespace-nowrap">
                      <div>
                        val <span className="text-foreground">{fmt(v)}</span>
                        {Number.isFinite(min) && (
                          <>
                            {" "}
                            · min{" "}
                            <span className="text-foreground">{fmt(min as number)}</span>
                          </>
                        )}
                      </div>
                      <div className="text-muted-foreground">
                        {pick} vs {fmt(line)} →{" "}
                        <span className={hit ? "text-emerald-500" : "text-rose-500"}>
                          {hit ? "HIT" : "MISS"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom axis hint */}
        <div className="absolute bottom-0 left-0 right-0 px-2 py-1 text-[10px] text-muted-foreground font-mono flex justify-between">
          <span>newest</span>
          <span>oldest</span>
        </div>
      </div>
    </div>
  );
}

export default PropChart;
