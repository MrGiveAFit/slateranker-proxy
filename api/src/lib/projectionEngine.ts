// src/lib/projectionEngine.ts

export type PlayerGameLog = {
  date: string;
  minutes: number;
  pts: number;
  reb: number;
  ast: number;
  stl?: number;
  blk?: number;
  turnover?: number;
  three_pm?: number;
  fg3a?: number;
  pra?: number;
};

type ProjectionResult = {
  projection: number;
  l5: number;
  l10: number;
  floor: number;
  ceiling: number;
  stdDev: number;
  overProbability: number;
};

function average(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stdDev(nums: number[]) {
  if (nums.length <= 1) return 0;
  const avg = average(nums);
  const variance =
    nums.reduce((sum, n) => sum + Math.pow(n - avg, 2), 0) / nums.length;
  return Math.sqrt(variance);
}

export function calculateProjection(
  logs: PlayerGameLog[],
  statKey: keyof PlayerGameLog,
  propLine: number
): ProjectionResult | null {
  if (!logs || logs.length === 0) return null;

  // Remove zero-minute games
  const valid = logs.filter((g) => g.minutes > 0);

  if (valid.length === 0) return null;

  const statValues = valid
    .map((g) => Number(g[statKey] || 0))
    .filter((v) => !isNaN(v));

  if (statValues.length === 0) return null;

  const l5 = average(statValues.slice(0, 5));
  const l10 = average(statValues.slice(0, 10));

  // Weighted projection (L5 weighted heavier)
  const projection = l5 * 0.6 + l10 * 0.4;

  const deviation = stdDev(statValues.slice(0, 10));

  const floor = projection - deviation;
  const ceiling = projection + deviation;

  // Simple probability model
  let overProbability = 0.5;
  if (deviation > 0) {
    const z = (projection - propLine) / deviation;
    overProbability = 0.5 + Math.atan(z) / Math.PI;
  }

  return {
    projection,
    l5,
    l10,
    floor,
    ceiling,
    stdDev: deviation,
    overProbability: Math.max(0, Math.min(1, overProbability)),
  };
}
