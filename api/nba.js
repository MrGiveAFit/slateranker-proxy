// /api/nba.js (Vercel serverless function)
// Returns: { source, fetched_at, data: [...] }

const API_BASE = "https://api.balldontlie.io/v1";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function currentSeason() {
  const now = new Date();
  // NBA season starts in October (month 9). Before that, it's previous year.
  return now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { type, q, player_id, last_n = "10" } = req.query;

  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      source: "balldontlie",
      error: "Missing BALLDONTLIE_API_KEY env var on Vercel",
      data: [],
      fetched_at: new Date().toISOString(),
    });
  }

  const hdrs = { Authorization: apiKey };

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

      // 1) Get player info + team
      const pRes = await fetch(`${API_BASE}/players/${player_id}`, { headers: hdrs });
      if (!pRes.ok) return res.status(pRes.status).json({ error: await pRes.text() });

      const pJson = await pRes.json();
      const teamId = pJson?.data?.team?.id;
      const teamAbbr = String(pJson?.data?.team?.abbreviation || "");

      if (!teamId) {
        return res.json({
          source: "balldontlie",
          data: [],
          fetched_at: new Date().toISOString(),
        });
      }

      // 2) Fetch completed games (try current + previous season first)
      const season = currentSeason();
      let games = await fetchGames(teamId, [season, season - 1], hdrs);

      // 3) Fallback: if empty, try without season filter
      if (games.length === 0) {
        games = await fetchGames(teamId, [], hdrs);
      }

      // 4) Sort newest first, take a larger slice to ensure we get enough stats rows
      games.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      const recentGames = games.slice(0, lastN * 3);

      if (recentGames.length === 0) {
        return res.json({
          source: "balldontlie",
          data: [],
          fetched_at: new Date().toISOString(),
        });
      }

      // 5) Fetch stats for those games
      let statsUrl = `${API_BASE}/stats?player_ids[]=${player_id}&per_page=100`;
      for (const g of recentGames) statsUrl += `&game_ids[]=${g.id}`;

      const sRes = await fetch(statsUrl, { headers: hdrs });
      if (!sRes.ok) return res.status(sRes.status).json({ error: await sRes.text() });

      const sJson = await sRes.json();
      const allStats = sJson?.data || [];

      // 6) Sort newest first, take lastN
      allStats.sort((a, b) =>
        String(b.game?.date || "").localeCompare(String(a.game?.date || ""))
      );
      const top = allStats.slice(0, lastN);

      // 7) Map to clean log objects (INCLUDES opponent)
      const logs = top.map((s) => {
        const g = s.game || {};
        const hAbbr = g.home_team?.abbreviation || "";
        const vAbbr = g.visitor_team?.abbreviation || "";

        // opponent calc
        const opponent =
          teamAbbr && hAbbr && vAbbr
            ? teamAbbr === hAbbr
              ? vAbbr
              : hAbbr
            : "";

        // minutes can be "37", "37:12", number, or null
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
          opponent,                 // ✅ important for your UI
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

async function fetchGames(teamId, seasons, hdrs) {
  let url = `${API_BASE}/games?team_ids[]=${teamId}&per_page=100`;
  for (const s of seasons) url += `&seasons[]=${s}`;

  const r = await fetch(url, { headers: hdrs });
  if (!r.ok) return [];

  const j = await r.json();
  return (j.data || []).filter((g) => g.status === "Final");
}
