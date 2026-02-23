import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  try {
    const { playerId } = req.query;

    if (!playerId) {
      return res.status(400).json({
        error: "Missing playerId query parameter",
      });
    }

    const API_KEY = process.env.BALLDONTLIE_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({
        error: "Missing BALLDONTLIE_API_KEY in environment variables",
      });
    }

    // Fetch last 10 games
    const response = await fetch(
      `https://api.balldontlie.io/v1/stats?player_ids[]=${playerId}&per_page=10`,
      {
        headers: {
          Authorization: API_KEY,
        },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: "BallDontLie API error",
        details: text,
      });
    }

    const data = await response.json();

    if (!data.data || data.data.length === 0) {
      return res.status(404).json({
        error: "No stats found for player",
      });
    }

    const games = data.data;

    const averages = {
      pts:
        games.reduce((sum: number, g: any) => sum + g.pts, 0) /
        games.length,
      reb:
        games.reduce((sum: number, g: any) => sum + g.reb, 0) /
        games.length,
      ast:
        games.reduce((sum: number, g: any) => sum + g.ast, 0) /
        games.length,
      gamesAnalyzed: games.length,
    };

    return res.status(200).json({
      playerId,
      averages,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
}
