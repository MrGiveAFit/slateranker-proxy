// src/lib/projections.ts
// Monte Carlo projection engine for SlateRanker
// - Works with any stat series (PTS, REB, AST, etc.)
// - Outputs probability, projection, percentiles, edge, volatility, and histogram bins

export type PropDirection = "OVER" | "UNDER";

export type ProjectionInputs = {
  series: number[];          // stat values, most recent first OR any order (we handle)
  line: number;              // sportsbook line
  direction: PropDirection;  // OVER / UNDER
  simulations?: number;      // default 5000
  clampMin?: number;         // default 0 (stats cannot go negative)
  rngSeed?: number;          // optional deterministic runs (debug)
};

export type HistogramBin = {
  x0: number;     // bin start
  x1: number;     // bin end
  count: number;  // how many samples fell in this bin
};

export type ProjectionResult = {
  projection: number;     // mean of simulations
  probability: number;    // probability of hitting the chosen direction
  edge: number;           // projection - line (for OVER) or line - projection (for UNDER)
  floor: number;          // p10
  median: number;         // p50
  ceiling: number;        // p90
  stdev: number;          // stdev of series (not samples)
  volatility: "LOW" | "MODERATE" | "HIGH";
  confidence: number;     // 0–100 simple heuristic
  samplesPreview: number[]; // small preview (first 50) for debugging/chart
  histogram: HistogramBin[];
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function mean(arr: number[]) {
  if (!arr.length) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function variance(arr: number[]) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let s = 0;
  for (const v of arr) s += (v - m) * (v - m);
  return s / (arr.length - 1);
}

function stdev(arr: number[]) {
  return Math.sqrt(variance(arr));
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

// Simple deterministic PRNG for optional seed
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller transform to generate normal(0,1)
function randn(prng: () => number) {
  let u = 0, v = 0;
  while (u === 0) u = prng();
  while (v === 0) v = prng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function buildHistogram(samples: number[], binCount = 12): HistogramBin[] {
  if (samples.length === 0) return [];
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  if (min === max) {
    return [{ x0: min, x1: max, count: samples.length }];
  }

  const width = (max - min) / binCount;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    x0: min + i * width,
    x1: min + (i + 1) * width,
    count: 0,
  }));

  for (const s of samples) {
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor((s - min) / width)));
    bins[idx].count += 1;
  }
  return bins;
}

function volatilityBucket(seriesStdev: number, seriesMean: number) {
  // coefficient of variation (normalized volatility)
  const denom = Math.max(1, Math.abs(seriesMean));
  const cv = seriesStdev / denom;

  if (cv < 0.30) return "LOW" as const;
  if (cv < 0.55) return "MODERATE" as const;
  return "HIGH" as const;
}

function confidenceScore(probability: number, seriesLen: number, vol: "LOW" | "MODERATE" | "HIGH") {
  // Simple, explainable heuristic:
  // - higher probability away from 50% = better
  // - more games = better
  // - lower volatility = better
  const probStrength = Math.abs(probability - 0.5) * 2; // 0..1
  const sampleStrength = clamp(seriesLen / 20, 0, 1);   // 0..1
  const volPenalty = vol === "LOW" ? 1 : vol === "MODERATE" ? 0.75 : 0.55;

  const score = 100 * probStrength * 0.65 + 100 * sampleStrength * 0.35;
  return Math.round(score * volPenalty);
}

/**
 * Main: Monte Carlo projection from historical stat series.
 * Uses Normal(mean, stdev) with clamping at clampMin.
 * Later we can upgrade distribution (skew, minutes-adjusted, opponent, pace, etc).
 */
export function monteCarloProject(input: ProjectionInputs): ProjectionResult {
  const {
    series,
    line,
    direction,
    simulations = 5000,
    clampMin = 0,
    rngSeed,
  } = input;

  const clean = (series || [])
    .map((v) => (Number.isFinite(v) ? v : 0))
    .filter((v) => v >= 0);

  const n = clean.length;
  const m = mean(clean);
  const sd = stdev(clean);

  // If sd is 0 (flat series), make a tiny sd so sims still work
  const simSd = sd === 0 ? Math.max(0.75, m * 0.10) : sd;

  const prng = rngSeed != null ? mulberry32(rngSeed) : Math.random;

  const samples: number[] = [];
  let hits = 0;

  for (let i = 0; i < simulations; i++) {
    const z = randn(prng);
    let value = m + z * simSd;

    // Clamp at clampMin, round to 1 decimal for stable charts
    value = Math.max(clampMin, value);
    value = Math.round(value * 10) / 10;

    samples.push(value);

    const over = value > line; // use strict > for over; can change to >= if you want pushes treated differently
    const under = value < line;

    // Push behavior:
    // - If equals line, treat as half-win or ignore.
    // For simplicity: ignore pushes (neither hit nor miss).
    if (direction === "OVER" && over) hits += 1;
    if (direction === "UNDER" && under) hits += 1;
  }

  samples.sort((a, b) => a - b);

  const p10 = percentile(samples, 0.10);
  const p50 = percentile(samples, 0.50);
  const p90 = percentile(samples, 0.90);

  const proj = mean(samples);
  const prob = hits / simulations;

  const edge =
    direction === "OVER" ? proj - line : line - proj;

  const vol = volatilityBucket(sd, m);
  const conf = confidenceScore(prob, n, vol);

  const histogram = buildHistogram(samples, 12);

  return {
    projection: Math.round(proj * 10) / 10,
    probability: Math.round(prob * 1000) / 10, // percent with 1 decimal (e.g. 62.3)
    edge: Math.round(edge * 10) / 10,
    floor: Math.round(p10 * 10) / 10,
    median: Math.round(p50 * 10) / 10,
    ceiling: Math.round(p90 * 10) / 10,
    stdev: Math.round(sd * 10) / 10,
    volatility: vol,
    confidence: conf,
    samplesPreview: samples.slice(0, 50),
    histogram,
  };
}
