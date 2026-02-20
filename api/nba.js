// /api/nba.js (Vercel serverless function)
// Robust proxy for BallDontLie (works with multiple query styles)
// Supports:
//  - Search players:  ?type=players&q=Kevin Durant
//  - Search players:  ?type=search&q=Kevin Durant
//  - Search players:  ?search=Kevin Durant   (back-compat)
//  - Game logs:       ?type=gamelogs&player_id=140&season=2025&last_n=10
//  - Game logs:       ?playerId=140&season=2025&last_n=10              (back-compat)

const API_BASE = "https://api.balldontlie.io/v1";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseMinutes(minVal) {
  if (minVal == null) return 0;
  // "37" or "37:12" or number
  const s = String(minVal);
  const parts = s.split(":");
  return num(parts[0]);
}

function isoDateOnly(d) {
  return String(d || "").split("T")[0];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey = process.env.BALLDONTLIE_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      source: "balldontlie",
      error: "Missing BALLDONTLIE_API_KEY on Vercel",
      data: [],
      fetched_at: new Date().toISOString(),
    });
  }

  const hdrs = { Authorization: apiKey };

  // Accept multiple param styles
  const type =
    req.query.type ||
    (req.query.search ? "search" : null) ||
    (req.query.playerId || req.query.player_id ? "gamelogs" : null);

  const q = req.query.q || req.query.search || "";
  const player_id = req.query.player_id || req.query.playerId || "";
  const season = req.query.season != null ? String(req.query.season) : ""; // optional
  const last_n_raw = req.query.last_n != null ? String(req.query.last_n) : "10";

  const lastN = Math.min(Math.max(parseInt(last_n_raw, 10) || 10, 1), 50);

  try {
    // ---------- SEARCH / PLAYERS ----------
    if (type === "search" || type === "players") {
      if (!q) return res.status(400).json({ error: "Missing ?q=" });

      const url = `${API_BASE}/players?search=${encodeURIComponent(q)}&per_page=25`;
      const r = await fetch(url, { headers: hdrs });

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
        type: "search",
        q,
        data: players,
        fetched_at: new Date().toISOString(),
      });
    }

    // ---------- GAMELOGS ----------
    if (type === "gamelogs") {
      if (!player_id) return res.status(400).json({ error: "Missing ?player_id=" });

      // Pull stats directly (this avoids the “rookie missing games” problem)
      // We'll paginate until we gather lastN valid games (min>0 AND game.status Final)
      let page = 1;
      const per_page = 100;
      const maxPages = 10; // safety
      const collected = [];

      while (page <= maxPages && collected.length < lastN) {
        let statsUrl = `${API_BASE}/stats?player_ids[]=${encodeURIComponent(
          player_id
        )}&per_page=${per_page}&page=${page}`;

        if (season) statsUrl += `&seasons[]=${encodeURIComponent(season)}`;

        const sRes = await fetch(statsUrl, { headers: hdrs });
        if (!sRes.ok) return res.status(sRes.status).json({ error: await sRes.text() });

        const sJson = await sRes.json();
        const rows = sJson?.data || [];

        if (rows.length === 0) break; // no more pages

        // Sort newest first by game date
        rows.sort((a, b) => String(b.game?.date || "").localeCompare(String(a.game?.date || "")));

        for (const s of rows) {
          const g = s.game || {};
          const minutes = parseMinutes(s.min);

          // only completed games + played minutes
          if (g.status !== "Final") continue;
          if (minutes <= 0) continue;

          const teamAbbr = s.team?.abbreviation || "";
          const hAbbr = g.home_team?.abbreviation || "";
          const vAbbr = g.visitor_team?.abbreviation || "";
          const opp = teamAbbr
            ? teamAbbr === hAbbr
              ? vAbbr
              : teamAbbr === vAbbr
              ? hAbbr
              : ""
            : "";

          const pts = num(s.pts);
          const reb = num(s.reb);
          const ast = num(s.ast);

          collected.push({
            date: isoDateOnly(g.date),
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
          });

          if (collected.length >= lastN) break;
        }

        page += 1;
      }

      return res.json({
        source: "balldontlie",
        type: "gamelogs",
        player_id: String(player_id),
        season: season ? Number(season) : null,
        last_n: lastN,
        data: collected.slice(0, lastN),
        fetched_at: new Date().toISOString(),
      });
    }

    return res.status(400).json({
      error: "Unknown type. Use ?type=players (or search) or ?type=gamelogs",
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
