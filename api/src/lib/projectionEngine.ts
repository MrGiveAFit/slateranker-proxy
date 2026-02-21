// src/lib/projectionEngine.ts
// Smarter projection + probability + confidence for NBA props
// Works with your existing game log shape from balldontlie proxy/edge functions.

export type StatKey =
  | "pts"
  | "reb"
  | "ast"
  | "stl"
  | "blk"
  | "fg3a" // 3PT attempts
  | "fg3m" // 3PT makes
  | "tov"  // turnovers
  | "pra"; // points+reb+ast (computed)

export type PropType =
  | "PTS"
  | "REB"
  | "AST"
  | "STL"
  | "BLK"
  | "3PA"
  | "3PM"
  | "TOV"
  | "PRA";

export interface GameLog {
  date?: string;
  opponent?: string;
  minutes?: number | string;

  // common box score fields (some may be missing depending on source)
  pts?: number;
  reb?: number;
  ast?: number;
  stl?: number;
  blk?: number;

  fg3a?: number; // 3PT attempts
  fg3m?: number; // 3PT makes

  turnover?: number; // some sources use "turnover"
  tov?: number;      // some use "tov"

  // optional extras if you add later
  dunks?: number;
}

export interface PropInput {
  playerName: string;
  propType: PropType;
  line: number;              // the betting line (ex: 28.5)
  opponent?: string;
}

export interface ChartPoint {
  date: string;
  value: number;
  minutes: number;
  overLine: boolean;
}

export interface PropResult {
  playerName: string;
  propType: PropType;
  line: number;
  opponent?: string;

  projection: number;   // projected stat value
  probability: number;  // % chance to hit the pick side
  confidence: number;   // 0-100 score

  l10Avg: number;
  l5Avg: number;
  minutesAvg10: number;

  notes: string[];      // short bullet notes
  warnings: string[];   // risk flags like "minutes volatility"
  chart: ChartPoint[];  // last 10 game values
}

function toNum(v: unknown): number {
  const n = typeof v === "string" ? Number(v.split(":")[0]) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function mean(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stdev(nums: number[]) {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const v = mean(nums.map((x) => (x - m) ** 2));
  return Math.sqrt(v);
}

function zToProb(z: number) {
  // Approximate Normal CDF (good enough for props)
  // Abramowitz & Stegun style approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

function statKeyFromPropType(propType: PropType): StatKey {
  switch (propType) {
    case "PTS":
      return "pts";
    case "REB":
      return "reb";
    case "AST":
      return "ast";
    case "STL":
      return "stl";
    case "BLK":
      return "blk";
    case "3PA":
      return "fg3a";
    case "3PM":
      return "fg3m";
    case "TOV":
      return "tov";
    case "PRA":
      return "pra";
  }
}

function getStatValue(log: GameLog, key: StatKey): number {
  if (key === "pra") {
    return toNum(log.pts) + toNum(log.reb) + toNum(log.ast);
  }
  if (key === "tov") {
    // support both naming conventions
    return toNum((log as any).tov ?? (log as any).turnover);
  }
  return toNum((log as any)[key]);
}

function getMinutes(log: GameLog): number {
  return toNum(log.minutes);
}

/**
 * Core: smarter projection
 * - Weighted blend of last 5 and last 10
 * - Minutes adjustment relative to last10 minutes
 * - Volatility penalty (more volatile => slightly pulled toward mean + confidence down)
 */
function computeProjection(values10: number[], values5: number[], mins10: number[], expectedMinutes?: number) {
  const l10 = mean(values10);
  const l5 = mean(values5);

  // Weighted recent form
  const base = 0.62 * l5 + 0.38 * l10;

  const minAvg10 = mean(mins10) || 1;
  const expMin = expectedMinutes ?? minAvg10;

  // Opportunity adjustment (gentle)
  const minutesFactor = clamp(expMin / minAvg10, 0.80, 1.25);
  const minutesAdjusted = base * minutesFactor;

  // Volatility adjustment
  const sd10 = stdev(values10);
  const cv = l10 > 0 ? sd10 / l10 : 0; // coefficient of variation
  const volatilityPull = clamp(cv * 0.15, 0, 0.12); // pull toward l10 when volatile
  const projected = (1 - volatilityPull) * minutesAdjusted + volatilityPull * l10;

  return {
    projection: projected,
    l10,
    l5,
    minAvg10,
    sd10,
    cv,
    minutesFactor,
  };
}

/**
 * Probability estimate:
 * Blend:
 *  - empirical hit rate last10
 *  - normal approximation using mean/stdev
 */
function computeProbability(values10: number[], line: number, higherIsBetter: boolean) {
  if (!values10.length) return 0.5;

  const hits = values10.filter((v) => (higherIsBetter ? v > line : v < line)).length;
  const hitRate = hits / values10.length;

  const m = mean(values10);
  const sd = stdev(values10) || 1;

  // P(value > line) or P(value < line)
  const z = (line - m) / sd;
  const pOver = 1 - zToProb(z);
  const p = higherIsBetter ? pOver : 1 - pOver;

  // Blend (hit rate gets slightly more weight)
  const blended = 0.6 * hitRate + 0.4 * p;
  return clamp(blended, 0.05, 0.95);
}

/**
 * Confidence score 0-100:
 * - higher probability => higher confidence
 * - high volatility => lower confidence
 * - unstable minutes => lower confidence
 */
function computeConfidence(prob: number, cv: number, minutesStd: number) {
  let score = prob * 100;

  // volatility penalty
  score -= clamp(cv * 40, 0, 22);

  // minutes volatility penalty (minutesStd ~ 0-10+)
  score -= clamp(minutesStd * 1.2, 0, 18);

  return Math.round(clamp(score, 1, 99));
}

export function computePropResult(input: PropInput, logsRaw: GameLog[]): PropResult {
  const key = statKeyFromPropType(input.propType);

  // clean + sort newest->oldest if dates exist
  const logs = [...(logsRaw || [])].sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || ""))
  );

  const last10 = logs.slice(0, 10);
  const last5 = logs.slice(0, 5);

  const values10 = last10.map((g) => getStatValue(g, key));
  const values5 = last5.map((g) => getStatValue(g, key));
  const mins10 = last10.map(getMinutes);

  const minutesStd = stdev(mins10);

  // If you later add "expected minutes" from injury/news, plug it in here.
  const { projection, l10, l5, minAvg10, sd10, cv, minutesFactor } =
    computeProjection(values10, values5, mins10);

  // Decide if we’re evaluating "over" chance by default.
  // Your UI can choose OVER/UNDER later; here we give OVER probability by default.
  const probabilityOver = computeProbability(values10, input.line, true);

  const confidence = computeConfidence(probabilityOver, cv, minutesStd);

  const notes: string[] = [];
  const warnings: string[] = [];

  if (l5 > l10 + 0.35) notes.push(`Trending up: ${l5.toFixed(1)} avg L5 vs ${l10.toFixed(1)} L10`);
  if (l5 + 0.35 < l10) notes.push(`Cooling off: ${l5.toFixed(1)} avg L5 vs ${l10.toFixed(1)} L10`);

  if (minutesStd >= 6) warnings.push("High minutes volatility");
  if (cv >= 0.45) warnings.push("High stat volatility");

  if (minutesFactor > 1.08) notes.push("Opportunity bump (recent minutes up)");
  if (minutesFactor < 0.92) warnings.push("Opportunity risk (recent minutes down)");

  // chart points newest->oldest (keep that order for your chart)
  const chart: ChartPoint[] = last10.map((g) => {
    const value = getStatValue(g, key);
    const minutes = getMinutes(g);
    const date = String(g.date || "").slice(0, 10) || "";
    return {
      date,
      value,
      minutes,
      overLine: value > input.line,
    };
  });

  return {
    playerName: input.playerName,
    propType: input.propType,
    line: input.line,
    opponent: input.opponent,

    projection: Number(projection.toFixed(1)),
    probability: Math.round(probabilityOver * 100),
    confidence,

    l10Avg: Number(l10.toFixed(1)),
    l5Avg: Number(l5.toFixed(1)),
    minutesAvg10: Math.round(minAvg10),

    notes,
    warnings,
    chart,
  };
}
