// /api/nba.js

const API_BASE = "https://api.balldontlie.io/v1";

function num(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function currentSeason() {
  const now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { type, q, player_id, last_n = "10" } = req.query;
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  const headers = { Authorization: apiKey };

  try {

    // SEARCH
    if (type === "search") {
      const r = await fetch(
        `${API_BASE}/players?search=${encodeURIComponent(q)}&per_page=10`,
        { headers }
      );
      const j = await r.json();

      return res.json({
        source: "balldontlie",
        data: (j.data || []).map(p => ({
          id: p.id,
          first_name: p.first_name,
          last_name: p.last_name,
          position: p.position,
          team: p.team?.abbreviation
        })),
        fetched_at: new Date().toISOString()
      });
    }

    // GAMELOGS
    if (type === "gamelogs") {

      const lastN = Math.min(Math.max(parseInt(last_n) || 10, 1), 50);

      // Player
      const pRes = await fetch(`${API_BASE}/players/${player_id}`, { headers });
      const pJson = await pRes.json();
      const teamId = pJson?.data?.team?.id;
      const teamAbbr = pJson?.data?.team?.abbreviation;

      if (!teamId) {
        return res.json({ source: "balldontlie", data: [], fetched_at: new Date().toISOString() });
      }

      const season = currentSeason();

      // Fetch games
      const gRes = await fetch(
        `${API_BASE}/games?team_ids[]=${teamId}&seasons[]=${season}&per_page=100`,
        { headers }
      );
      const gJson = await gRes.json();
      const games = (gJson.data || []).filter(g => g.status === "Final");

      if (games.length === 0) {
        return res.json({ source: "balldontlie", data: [], fetched_at: new Date().toISOString() });
      }

      // Fetch stats
      let statsUrl = `${API_BASE}/stats?player_ids[]=${player_id}&per_page=100`;
      games.slice(0, lastN * 2).forEach(g => {
        statsUrl += `&game_ids[]=${g.id}`;
      });

      const sRes = await fetch(statsUrl, { headers });
      const sJson = await sRes.json();
      const stats = (sJson.data || []).slice(0, lastN);

      const logs = stats.map(s => {

        const g = s.game;
        const homeId = g.home_team_id;
        const visitorId = g.visitor_team_id;

        const opponentId = teamId === homeId ? visitorId : homeId;

        return {
          date: g.date.split("T")[0],
          opponent: opponentId, // returning ID instead of blank
          minutes: num((s.min || "0").split(":")[0]),
          pts: num(s.pts),
          reb: num(s.reb),
          ast: num(s.ast),
          three_pm: num(s.fg3m),
          fgm: num(s.fgm),
          fga: num(s.fga),
          fg3a: num(s.fg3a),
          ftm: num(s.ftm),
          fta: num(s.fta),
          turnover: num(s.turnover),
          pf: num(s.pf),
          plus_minus: num(s.plus_minus),
          pra: num(s.pts) + num(s.reb) + num(s.ast)
        };
      });

      return res.json({
        source: "balldontlie",
        data: logs,
        fetched_at: new Date().toISOString()
      });
    }

    return res.status(400).json({ error: "Invalid type" });

  } catch (err) {
    return res.status(500).json({
      source: "balldontlie",
      error: String(err),
      data: [],
      fetched_at: new Date().toISOString()
    });
  }
}
