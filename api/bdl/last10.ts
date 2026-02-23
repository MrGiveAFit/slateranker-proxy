// api/bdl/last10.ts
// Vercel Serverless Function (Node 18+)

function setCors(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function toNumber(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function mean(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stddev(nums: number[]) {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const v = mean(nums.map((n) => (n - m) * (n - m)));
  return Math.sqrt(v);
}

function isoDateOnly(iso: string) {
  // "2023-11-12T00:00:00.000Z" -> "2023-11-12"
  if (!iso) return "";
  return String(iso).slice(0, 10);
}

// Try to pick a reasonable season if none provided:
// NBA season year is usually the year the season starts.
// In Feb 2026, season is 2025 (2025-26). We'll default to currentYear-1 for Jan–Jun, else currentYear.
function defaultSeasonYear() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-12
  return m <= 6 ? y - 1 : y;
}

export default async function handler(req: any, res: any) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const playerId = String(req.query?.playerId || "").trim();
  if (!playerId) {
    return res.status(400).json({ error: "Missing playerId query param" });
  }

  const season = String(req.query?.season || defaultSeasonYear()).trim();

  try {
    // BallDontLie v1 stats endpoint:
    // We'll pull a chunk of games for the player for the season, then take the most recent 10.
    const url = `https://www.balldontlie.io/api/v1/stats?per_page=100&player_ids[]=${encodeURIComponent(
      playerId
    )}&seasons[]=${encodeURIComponent(season)}`;

    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(502).json({ error: "Upstream error", status: upstream.status });
    }

    const data = await upstream.json();
    const rows = Array.isArray(data?.data) ? data.data : [];

    // Sort by game date desc
    rows.sort((a: any, b: any) => {
      const da = new Date(a?.game?.date || 0).getTime();
      const db = new Date(b?.game?.date || 0).getTime();
      return db - da;
    });

    const last10 = rows.slice(0, 10);

    // Build simplified game list
    const games = last10.map((r: any) => ({
      date: isoDateOnly(r?.game?.date || ""),
      pts: toNumber(r?.pts),
      reb: toNumber(r?.reb),
      ast: toNumber(r?.ast),
    }));

    const ptsArr = games.map((g) => g.pts);
    const rebArr = games.map((g) => g.reb);
    const astArr = games.map((g) => g.ast);

    const averages = {
      pts: Number(mean(ptsArr).toFixed(1)),
      reb: Number(mean(rebArr).toFixed(1)),
      ast: Number(mean(astArr).toFixed(1)),
      gamesAnalyzed: games.length,
    };

    const volatility = {
      pts: Number(stddev(ptsArr).toFixed(2)),
      reb: Number(stddev(rebArr).toFixed(2)),
      ast: Number(stddev(astArr).toFixed(2)),
    };

    return res.status(200).json({
      playerId,
      season,
      averages,
      volatility,
      games,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Server error", detail: String(err?.message || err) });
  }
}
