export function calculateProjection(logs, statKey, propLine) {
  if (!logs || logs.length === 0) {
    return null;
  }

  // Remove DNP / zero-minute games
  const cleaned = logs.filter(g => g.minutes > 0);

  const values = cleaned.map(g => getStatValue(g, statKey));

  const l5 = values.slice(0, 5);
  const l10 = values.slice(0, 10);

  const meanL5 = mean(l5);
  const meanL10 = mean(l10);

  // Weighted mean (recent heavier)
  const weighted = (meanL5 * 0.65) + (meanL10 * 0.35);

  const stdDev = standardDeviation(values);

  const floor = weighted - (stdDev * 0.8);
  const ceiling = weighted + (stdDev * 1.2);

  const overProbability = calculateOverProbability(weighted, stdDev, propLine);

  return {
    projection: round(weighted),
    l5: round(meanL5),
    l10: round(meanL10),
    stdDev: round(stdDev),
    floor: round(floor),
    ceiling: round(ceiling),
    overProbability: round(overProbability * 100)
  };
}

function getStatValue(game, key) {
  if (key.includes("+")) {
    const parts = key.split("+");
    return parts.reduce((sum, stat) => sum + (Number(game[stat]) || 0), 0);
  }

  return Number(game[key]) || 0;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function standardDeviation(arr) {
  const avg = mean(arr);
  const variance = mean(arr.map(v => Math.pow(v - avg, 2)));
  return Math.sqrt(variance);
}

function calculateOverProbability(mean, stdDev, line) {
  if (!line || stdDev === 0) return 0.5;

  const z = (line - mean) / stdDev;
  return 1 - normalCDF(z);
}

function normalCDF(x) {
  return (1 + erf(x / Math.sqrt(2))) / 2;
}

function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * x);
  const y = 1 - (((((
    a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return sign * y;
}

function round(num) {
  return Math.round(num * 10) / 10;
}
