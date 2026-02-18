export default async function handler(req, res) {
  // -----------------------------
  // CORS HEADERS
  // -----------------------------
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
    // =========================================
    // PLAYER SEARCH
    // =========================================
    if (type === "search") {
      const response = await fetch(
        `https://api.balldontlie.io/v1/players?search=${q}`,
        { headers }
      );

      const json = await response.json();

      return res.status(200).json({
        source: "balldontlie",
        fetched_at: new Date().toISOString(),
        data: json.data || [],
      });
    }

    // =========================================
    // GAMELOGS (player → team → games → stats)
    // =========================================
    if (type === "gamelogs") {
      const pid = Number(player_id);
      const n = Number(last_n);

      if (!Number.isInteger(pid) || pid <= 0) {
        return res.status(400).json({
          error: "Invalid player_id",
          received: player_id,
        });
      }

      // 1️⃣ Get player to retrieve team ID
      const playerRes = await fetch(
        `https://api.balldontlie.io/v1/players/${pid}`,
        { headers }
      );

      const playerJson = await playerRes.json();
      const teamId = playerJson?.data?.team?.id;

      if (!teamId) {
        return res.status(200).json({
          source: "balldontlie",
          fetched_at: new Date().toISOString(),
          data: [],
        });
      }

      // 2️⃣ Get recent completed games for that team
      const gamesRes = await fetch(
        `https://api.balldontlie.io/v1/games?team_ids[]=${teamId}&seasons[]=2025&per_page=50`,
        { headers }
      );

      const gamesJson = await gamesRes.json();

      const gameIds = (gamesJson.data || [])
        .filter((g) => g.status === "Final")
        .slice(0, Number.isFinite(n) ? n : 10)
        .map((g) => g.id);

      if (!gameIds.length) {
        return res.status(200).json({
          source: "balldontlie",
          fetched_at: new Date().toISOString(),
          data: [],
        });
      }

      // 3️⃣ Get stats for player in those games
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
    }

    // =========================================
    // INVALID TYPE
    // =========================================
    return res.status(400).json({
      error: "Invalid type parameter",
    });

  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err.message,
    });
  }
}
