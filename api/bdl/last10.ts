// api/bdl/last10.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const API_BASE = "https://api.balldontlie.io/v1";

function getApiKey() {
  return process.env.BALLDONTLIE_API_KEY || process.env.BALLDONTLIE_KEY || "";
}

function isoDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function mean(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stdev(nums: number[]) {
  if (nums.length <= 1) return 0;
  const m = mean(nums);
  const v = mean(nums.map((x) => (x - m) ** 2));
  return Math.sqrt(v);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const playerId = String(req.query.playerId || "").trim();
    if (!playerId) {
      return res.status(400).json({ error: "Missing playerId query param" });
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      return res.status(500).json({ error: "Missing BALLDONTLIE_API_KEY in Vercel env" });
    }

    // Grab a window of recent stats, then sort by game date and take last 10.
    // Stats endpoint supports player_ids[], start_date/end_date, per_page.  [oai_citation:1‡Balldontlie NBA API](https://nba.balldontlie.io/)
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 120); // wide net so we can usually find 10 games

    const qs = new URLSearchParams();
    qs.set("per_page", "100");
    qs.set("start_date", isoDate(start));
    qs.set("end_date", isoDate(end));
    qs.append("player_ids[]", playerId);

    const url = `${API_BASE}/stats?${qs.toString()}`;

    const upstream = await fetch(url, {
      method: "GET",
      headers: { Authorization: apiKey },
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: "Upstream error",
        status: upstream.status,
        upstream: text.slice(0, 800),
      });
    }

    const json = JSON.parse(text);
    const data = Array.isArray(json?.data) ? json.data : [];

    const games = data
      .map((s: any) => ({
        date: String(s?.game?.date || ""),
        pts: Number(s?.pts ?? 0),
        reb: Number(s?.reb ?? 0),
        ast: Number(s?.ast ?? 0),
      }))
      .filter((g: any) => g.date)
      .sort((a: any, b: any) => (a.date < b.date ? 1 : -1))
      .slice(0, 10);

    const ptsArr = games.map((g: any) => g.pts);
    const rebArr = games.map((g: any) => g.reb);
    const astArr = games.map((g: any) => g.ast);

    const gamesAnalyzed = games.length;

    return res.status(200).json({
      playerId,
      averages: {
        pts: gamesAnalyzed ? Number(mean(ptsArr).toFixed(1)) : undefined,
        reb: gamesAnalyzed ? Number(mean(rebArr).toFixed(1)) : undefined,
        ast: gamesAnalyzed ? Number(mean(astArr).toFixed(1)) : undefined,
        gamesAnalyzed,
      },
      volatility: {
        pts: gamesAnalyzed ? Number(stdev(ptsArr).toFixed(2)) : undefined,
        reb: gamesAnalyzed ? Number(stdev(rebArr).toFixed(2)) : undefined,
        ast: gamesAnalyzed ? Number(stdev(astArr).toFixed(2)) : undefined,
      },
      games,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Server error", message: String(err?.message || err) });
  }
}
