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
    if (type === "search") {
      const r = await fetch(
        `${API_BASE}/players?search=${encodeURIComponent(q)}&per_page=10`,
        { headers }
      );

      const d = await r.json();

      return res.json({
        source: "balldontlie",
        data: (d.data || []).map((p) => ({
          id: p.id,
          first_name: p.first_name,
          last_name: p.last_name,
          position: p.position || "",
          team: p.team?.abbreviation || "",
        })),
        fetched_at: new Date().toISOString(),
      });
    }

    if (type === "gamelogs") {
      const lastN = Math.min(Math.max(parseInt(last_n, 10) || 10, 1), 20);

      const pRes = await fetch(`${API_BASE}/players/${player_id}`, { headers });
      const pJson = await pRes.json();

      const teamId = pJson?.data?.team?.id;
      const teamAbbr = pJson?.data?.team?.abbreviation;

      if (!teamId) {
        return res.json({
          source: "balldontlie",
          data: [],
          fetched_at: new Date().toISOString(),
        });
      }

      const season = currentSeason();

      const gamesRes = await fetch(
        `${API_BASE}/games?team_ids[]=${teamId}&seasons[]=${season}&per_page=100`,
        { headers }
      );

      const gamesJson = await gamesRes.json();

      const games = (gamesJson.data || [])
        .filter((g) => g.status === "Final")
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 25);

      if (!games.length) {
        return res.json({
          source: "balldontlie",
          data: [],
          fetched_at: new Date().toISOString(),
        });
      }

      let statsUrl = `${API_BASE}/stats?player_ids[]=${player_id}&per_page=100`;
      games.forEach((g) => {
        statsUrl += `&game_ids[]=${g.id}`;
      });

      const statsRes = await fetch(statsUrl, { headers });
      const statsJson = await statsRes.json();

      const logs = (statsJson.data || [])
        .sort((a, b) => new Date(b.game.date) - new Date(a.game.date))
        .slice(0, lastN)
        .map((s) => {
          const g = s.game;
          const home = g.home_team?.abbreviation;
          const visitor = g.visitor_team?.abbreviation;
          const opponent = teamAbbr === home ? visitor : home;

          const minutes = s.min ? parseInt(String(s.min).split(":")[0]) : 0;

          return {
            date: g.date.split("T")[0],
            opponent,
            minutes,
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
            pra: num(s.pts) + num(s.reb) + num(s.ast),
          };
        })
        .filter((log) => log.minutes > 0);

      return res.json({
        source: "balldontlie",
        data: logs,
        fetched_at: new Date().toISOString(),
      });
    }

    return res.status(400).json({ error: "Unknown type" });
  } catch (err) {
    return res.status(500).json({
      source: "balldontlie",
      error: String(err),
      data: [],
      fetched_at: new Date().toISOString(),
    });
  }
}
