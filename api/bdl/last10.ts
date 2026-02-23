// /api/bdl/last10.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const BDL_BASE = "https://api.balldontlie.io/v1";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { playerId } = req.query;

  if (!playerId) {
    return res.status(400).json({ error: "Missing playerId query param" });
  }

  try {
    // Pull last 10 games sorted by most recent
    const url = `${BDL_BASE}/stats?player_ids[]=${playerId}&per_page=10&postseason=false`;

    const upstream = await fetch(url, {
      headers: {
        Authorization: process.env.BDL_API_KEY || "",
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: "Upstream error",
        status: upstream.status,
      });
    }

    const json = await upstream.json();
    const games = json.data || [];

    if (!games.length) {
      return res.status(200).json({
        playerId,
        averages: {
          pts: 0,
          reb: 0,
          ast: 0,
          gamesAnalyzed: 0,
        },
      });
    }

    const totals = games.reduce(
      (acc: any, g: any) => {
        acc.pts += g.pts || 0;
        acc.reb += g.reb || 0;
        acc.ast += g.ast || 0;
        return acc;
      },
      { pts: 0, reb: 0, ast: 0 }
    );

    const count = games.length;

    return res.status(200).json({
      playerId,
      averages: {
        pts: totals.pts / count,
        reb: totals.reb / count,
        ast: totals.ast / count,
        gamesAnalyzed: count,
      },
      games: games.map((g: any) => ({
        date: g.game?.date,
        pts: g.pts,
        reb: g.reb,
        ast: g.ast,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
}
