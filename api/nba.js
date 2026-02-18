// /api/nba.js (Vercel serverless function)

const API_BASE = "https://api.balldontlie.io/v1";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function currentSeason() {
  const now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

function getHeaders() {
  const key = process.env.BALLDONTLIE_API_KEY;
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${key}`
  };
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: getHeaders() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function fetchGames(teamId, seasons) {
  let url = `${API_BASE}/games?team_ids[]=${teamId}&per_page=100`;
  for (const s of seasons) url += `&seasons[]=${s}`;

  const json = await fetchJson(url);
  return (json.data || []).filter(g => g.status === "Final");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { type, q, player_id, last_n = "10" } = req.query;

  try {

    // SEARCH
    if (type === "search") {
      if (!q) return res.status(400).json({ error: "Missing ?q=" });

      const url = `${API_BASE}/players?search=${encodeURIComponent(q)}&per_page=10`;
      const json = await fetchJson(url);

      const players = (json.data || []).map(p => ({
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        position: p.position || "",
        team: p.team?.abbreviation || ""
      }));

      return res.json({
        source: "balldontlie",
        data: players,
        fetched_at: new Date().toISOString()
      });
    }

    // GAMELOGS
    if (type === "gamelogs") {
      if (!player_id) return res.status(400).json({ error: "Missing ?player_id=" });

      const lastN = Math.min(Math.max(parseInt(last_n, 10) || 10, 1), 50);

      const playerJson = await fetchJson(`${API_BASE}/players/${player_id}`);
      const teamId = playerJson.data?.team?.id;
      const teamAbbr = playerJson.data?.team?.abbreviation || "";

      if (!teamId) {
        return res.json({ source: "balldontlie", data: [] });
      }

      const season = currentSeason();
      let games = await fetchGames(teamId, [season, season - 1]);

      if (games.length === 0) {
        games = await fetchGames(teamId, []);
      }

      games.sort((a, b) => b.date.localeCompare(a.date));
      const recent = games.slice(0, lastN * 2);

      if (recent.length === 0) {
        return res.json({ source: "balldontlie", data: [] });
      }

      let statsUrl = `${API_BASE}/stats?player_ids[]=${player_id}&per_page=100`;
      for (const g of recent) statsUrl += `&game_ids[]=${g.id}`;

      const statsJson = await fetchJson(statsUrl);
      const allStats = statsJson.data || [];

      allStats.sort((a, b) =>
        String(b.game?.date || "").localeCompare(String(a.game?.date || ""))
      );

      const top = allStats.slice(0, lastN);

      const logs = top.map(s => {
        const g = s.game || {};
        const hAbbr = g.home_team?.abbreviation || "";
        const vAbbr = g.visitor_team?.abbreviation || "";
        const opp = teamAbbr === hAbbr ? vAbbr : hAbbr;

        let minutes = 0;
        if (s.min != null) {
          const parts = String(s.min).split(":");
          minutes = num(parts[0]);
        }

        const pts = num(s.pts);
        const reb = num(s.reb);
        const ast = num(s.ast);

        return {
          date: String(g.date || "").split("T")[0],
          opponent: opp,
          minutes,
          pts,
          reb,
          ast,
          three_pm: num(s.fg3m),
          fgm: num(s.fgm),
          fga: num(s.fga),
          fg3a: num(s.fg3a),
          ftm: num(s.ftm),
          fta: num(s.fta),
          turnover: num(s.turnover),
          pf: num(s.pf),
          plus_minus: num(s.plus_minus),
          pra: pts + reb + ast
        };
      });

      return res.json({
        source: "balldontlie",
        data: logs,
        fetched_at: new Date().toISOString()
      });
    }

    return res.status(400).json({ error: "Unknown type" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: String(err),
      data: []
    });
  }
}
