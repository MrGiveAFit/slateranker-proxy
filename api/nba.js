export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { type, q, player_id, last_n = 10 } = req.query;
  const API_KEY = process.env.BALLDONTLIE_API_KEY;

  const headers = {
    Authorization: API_KEY,
  };

  try {
    if (type === "search") {
      const response = await fetch(
        `https://api.balldontlie.io/v1/players?search=${q}`,
        { headers }
      );
      const data = await response.json();
      return res.status(200).json({
        source: "balldontlie",
        fetched_at: new Date().toISOString(),
        data: data.data,
      });
    }

    if (type === "gamelogs") {
      try {
        const pid = Number(player_id);

        if (!Number.isInteger(pid) || pid <= 0) {
          return res.status(400).json({
            error: "Invalid player_id",
            received: player_id,
          });
        }

        // 1) Get recent completed games (season 2025)
        const gamesRes = await fetch(
          `https://api.balldontlie.io/v1/games?seasons[]=2025&per_page=50`,
          { headers }
        );

        const gamesJson = await gamesRes.json();
        const games = gamesJson.data || [];

        const gameIds = games
          .filter((g) => g.status === "Final")
          .slice(0, Number(last_n))
          .map((g) => g.id);

        if (!gameIds.length) {
          return res.status(200).json({
            source: "balldontlie",
            fetched_at: new Date().toISOString(),
            data: [],
          });
        }

        // 2) Pull stats for THIS player in those games
        const gameIdsQuery = gameIds.map((id) => `game_ids[]=${id}`).join("&");

        const statsRes = await fetch(
          `https://api.balldontlie.io/v1/stats?player_ids[]=${pid}&${gameIdsQuery}`,
          { headers }
        );

        const statsJson = await statsRes.json();

        return res.status(200).json({
          source: "balldontlie",
          fetched_at: new Date().toISOString(),
          data: statsJson.data || [],
        });
      } catch (err) {
        return res.status(500).json({
          error: "Gamelogs fetch failed",
          details: err.message,
        });
      }
    }

    return res.status(400).json({ error: "Invalid type" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
