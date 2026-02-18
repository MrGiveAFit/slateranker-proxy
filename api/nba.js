// /api/nba.js
// Vercel Serverless Function

const API_BASE = "https://api.balldontlie.io/v1";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function currentSeason() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0=Jan ... 9=Oct
  return month >= 9 ? year : year - 1;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { type, q, player_id, last_n = "10" } = req.query;

  const apiKey = process.env.BALLDONTLIE_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "Missing BALLDONTLIE_API_KEY in Vercel Environment Variables"
    });
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`
  };

  try {

    // ---------------- SEARCH ----------------
    if (type === "search") {
      if (!q) return res.status(400).json({ error: "Missing ?q=" });

      const r = await fetch(
        `${API_BASE}/players?search=${encodeURIComponent(q)}&per_page=10`,
        { headers }
      );

      if (!r.ok) {
        return res.status(r.status).json({ error: await r.text() });
      }

      const d = await r.json();

      const players = (d.data || []).map(p => ({
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

    // ---------------- GAMELOGS ----------------
    if (type === "gamelogs") {
      if (!player_id)
        return res.status(400).json({ error: "Missing ?player_id=" });

      const season = currentSeason();

      const statsRes = await fetch(
        `${API_BASE}/stats?player_ids[]=${player_id}&seasons[]=${season}&per_page=10`,
        { headers }
      );

      if (!statsRes.ok) {
        return res.status(statsRes.status).json({ error: await statsRes.text() });
      }

      const statsJson = await statsRes.json();
      const stats = statsJson.data || [];

      const logs = stats.map(s => ({
        date: s.game?.date?.split("T")[0] || "",
        minutes: num(String(s.min || "").split(":")[0]),
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
      }));

      return res.json({
        source: "balldontlie",
        data: logs,
        fetched_at: new Date().toISOString()
      });
    }

    return res.status(400).json({
      error: "Use ?type=search or ?type=gamelogs"
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: String(err),
      data: []
    });
  }
}
