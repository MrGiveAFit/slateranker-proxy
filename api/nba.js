// api/nba.js (Vercel serverless function)

const API_BASE = "https://api.balldontlie.io/v1";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function currentSeason() {
  const now = new Date();
  // NBA season starts in October (month 9). If before Oct, use previous year.
  return now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { type, q, player_id, last_n = "10" } = req.query;

  const apiKey = process.env.BALLDONTLIE_API_KEY;
  const hdrs = {
    Authorization: apiKey,
  };

  try {
    // ---------- SEARCH ----------
    if (type === "search") {
      if (!q) return res.status(400).json({ error: "Missing ?q=" });

      const r = await fetch(
        `${API_BASE}/players?search=${encodeURIComponent(q)}&per_page=10`,
        { headers: hdrs }
      );

      if (!r.ok) return res.status(r.status).json({ error: await r.text() });

      const d = await r.json();
      const players = (d.data || []).map((p) => ({
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        position: p.position || "",
        team: p.team?.abbreviation || "",
      }));

      return res.json({
        source: "balldontlie",
        data: players,
        fetched_at: new Date().toISOString(),
      });
    }

    // ---------- GAMELOGS ----------
    if (type === "gamelogs") {
      if (!player_id) return res.status(400).json({ error: "Missing ?player_id=" });

      const lastN = Math.min(Math.max(parseInt(last_n, 10) || 10, 1), 50);

      // 1) Get player info (team used only to compute opponent abbreviation)
      const pRes = await fetch(`${API_BASE}/players/${player_id}`, { headers: hdrs });
      if (!pRes.ok) return res.status(pRes.status).json({ error: await pRes.text() });

      const pJson = await pRes.json();
      const teamAbbr = String(pJson?.data?.team?.abbreviation || "");

      // 2) Pull stats by season (more reliable than filtering by game_ids[])
      // Try current season first; if empty, fall back to previous season.
      const season = currentSeason();

      let allStats = await fetchStatsBySeason(player_id, season, hdrs);

      if (allStats.length === 0) {
        allStats = await fetchStatsBySeason(player_id, season - 1, hdrs);
      }

      if (allStats.length === 0) {
        return res.json({
          source: "balldontlie",
          data: [],
          fetched_at: new Date().toISOString(),
        });
      }

      // 3) Sort newest first, take lastN
      allStats.sort((a, b) =>
        String(b.game?.date || "").localeCompare(String(a.game?.date || ""))
      );

      const top = allStats.slice(0, lastN);

      // 4) Map to clean numeric logs
      const logs = top.map((s) => {
        const g = s.game || {};
        const hAbbr = g.home_team?.abbreviation || "";
        const vAbbr = g.visitor_team?.abbreviation || "";

        const opp = teamAbbr
          ? (teamAbbr === hAbbr ? vAbbr : hAbbr)
          : "";

        // minutes can be "37", "37:12", number, etc
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
          pra: pts + reb + ast,
        };
      });

      return res.json({
        source: "balldontlie",
        data: logs,
        fetched_at: new Date().toISOString(),
      });
    }

    return res.status(400).json({
      error: "Unknown type. Use ?type=search or ?type=gamelogs",
    });
  } catch (err) {
    console.error("[nba-api]", err);
    return res.status(500).json({
      source: "balldontlie",
      error: String(err),
      data: [],
      fetched_at: new Date().toISOString(),
    });
  }
}

async function fetchStatsBySeason(playerId, season, hdrs) {
  // Pull a page big enough to cover recent games
  const url = `${API_BASE}/stats?player_ids[]=${playerId}&seasons[]=${season}&per_page=100`;
  const r = await fetch(url, { headers: hdrs });
  if (!r.ok) return [];

  const j = await r.json();

  // Keep only completed games
  return (j.data || []).filter((s) => s.game?.status === "Final");
}
