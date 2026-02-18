export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { type, q = "", player_id, last_n = "10" } = req.query;

  const API_KEY = process.env.BALLDONTLIE_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({
      error: "Missing BALLDONTLIE_API_KEY env var in Vercel",
    });
  }

  const headers = { Authorization: API_KEY };

  try {
    // -------------------------
    // SEARCH
    // -------------------------
    if (type === "search") {
      const query = String(q).trim();

      // 1) Try full query first
      const url1 = `https://api.balldontlie.io/v1/players?search=${encodeURIComponent(
        query
      )}`;
      const r1 = await fetch(url1, { headers });
      const j1 = await r1.json();
      const data1 = j1?.data || [];

      // 2) If empty AND query has spaces, retry with last token (usually last name)
      if (data1.length === 0 && query.includes(" ")) {
        const lastToken = query.split(/\s+/).filter(Boolean).slice(-1)[0];
        const url2 = `https://api.balldontlie.io/v1/players?search=${encodeURIComponent(
          lastToken
        )}`;
        const r2 = await fetch(url2, { headers });
        const j2 = await r2.json();

        return res.status(200).json({
          source: "balldontlie",
          fetched_at: new Date().toISOString(),
          data: j2?.data || [],
          note: `Full-name search empty; retried with last token "${lastToken}"`,
        });
      }

      return res.status(200).json({
        source: "balldontlie",
        fetched_at: new Date().toISOString(),
        data: data1,
      });
    }

    // -------------------------
    // GAMELOGS
    // -------------------------
    if (type === "gamelogs") {
      const pid = Number(player_id);
      const n = Math.max(1, Math.min(25, Number(last_n) || 10)); // clamp 1..25

      if (!Number.isInteger(pid) || pid <= 0) {
        return res.status(400).json({
          error: "Invalid player_id",
          received: player_id,
        });
      }

      // 1) player -> team_id
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
          note: "No team_id found for player",
        });
      }

      // 2) recent completed games for that team (season 2025)
      const gamesRes = await fetch(
        `https://api.balldontlie.io/v1/games?team_ids[]=${teamId}&seasons[]=2025&per_page=50`,
        { headers }
      );
      const gamesJson = await gamesRes.json();

      const gameIds = (gamesJson?.data || [])
        .filter((g) => String(g.status).toLowerCase() === "final")
        .slice(0, n)
        .map((g) => g.id);

      if (!gameIds.length) {
        return res.status(200).json({
          source: "balldontlie",
          fetched_at: new Date().toISOString(),
          data: [],
          note: "No final games found for team in season 2025",
        });
      }

      // 3) stats for player in those games
      const gameIdsQuery = gameIds.map((id) => `game_ids[]=${id}`).join("&");
      const statsRes = await fetch(
        `https://api.balldontlie.io/v1/stats?player_ids[]=${pid}&${gameIdsQuery}`,
        { headers }
      );
      const statsJson = await statsRes.json();

      return res.status(200).json({
        source: "balldontlie",
        fetched_at: new Date().toISOString(),
        data: statsJson?.data || [],
      });
    }

    // -------------------------
    // BAD TYPE
    // -------------------------
    return res.status(400).json({
      error: "Invalid type",
      expected: ["search", "gamelogs"],
      received: type,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Proxy error",
      details: err?.message || String(err),
    });
  }
}
