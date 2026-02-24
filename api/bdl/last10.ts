import type { VercelRequest, VercelResponse } from "@vercel/node";

const BDL_BASE = "https://api.balldontlie.io/v1";

function bdlHeaders() {
  const key = process.env.BDL_API_KEY;
  return {
    Authorization: key ? key : "",
    Accept: "application/json",
  };
}

function mean(arr: number[]) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr: number[]) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) * (x - m), 0) / (arr.length - 1);
  return Math.sqrt(v);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const playerId = String(req.query.playerId || "").trim();
    if (!playerId) return res.status(400).json({ error: "Missing ?playerId=" });

    if (!process.env.BDL_API_KEY) {
      return res.status(500).json({ error: "Missing BDL_API_KEY env var on Vercel." });
    }

    // BallDontLie v1 stats supports player_ids[] and per_page.  [oai_citation:3‡docs.balldontlie.io](https://docs.balldontlie.io/)
    const url = `${BDL_BASE}/stats?player_ids[]=${encodeURIComponent(playerId)}&per_page=10`;

    const r = await fetch(url, { headers: bdlHeaders() });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(500).json({ error: `BDL error ${r.status}`, detail: text.slice(0, 300) });
    }

    const json: any = await r.json();
    const data: any[] = Array.isArray(json?.data) ? json.data : [];

    // Normalize to the shape your Rankings.tsx expects
    const games = data.slice(0, 10).map((row) => ({
      date: String(row?.game?.date ?? row?.game?.start_time ?? ""),
      pts: Number(row?.pts) || 0,
      reb: Number(row?.reb) || 0,
      ast: Number(row?.ast) || 0,
    }));

    const ptsArr = games.map((g) => g.pts);
    const rebArr = games.map((g) => g.reb);
    const astArr = games.map((g) => g.ast);

    return res.status(200).json({
      playerId,
      averages: {
        pts: Number(mean(ptsArr).toFixed(1)),
        reb: Number(mean(rebArr).toFixed(1)),
        ast: Number(mean(astArr).toFixed(1)),
        gamesAnalyzed: games.length,
      },
      volatility: {
        pts: Number(stdDev(ptsArr).toFixed(1)),
        reb: Number(stdDev(rebArr).toFixed(1)),
        ast: Number(stdDev(astArr).toFixed(1)),
      },
      games,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
