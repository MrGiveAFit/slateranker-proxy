// /api/nba.js (Vercel serverless function)

const API_BASE = "https://api.balldontlie.io/v1";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function currentSeasonStartYear() {
  const now = new Date();
  // NBA season starts in October (month 9). If we're before Oct, it's last year's season-start.
  return now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

function firstDefined(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Accept multiple aliases so Safari tests "just work"
  const typeRaw = String(firstDefined(req.query.type, req.query.t, "") || "").toLowerCase();

  // aliases people naturally try
  const type =
    typeRaw === "players" ? "search"
    : typeRaw === "player" ? "search"
    : typeRaw === "search" ? "search"
    : typeRaw === "gamelogs" ? "gamelogs"
    : typeRaw === "player_games" ? "gamelogs"
    : typeRaw === "games" ? "gamelogs"
    : typeRaw === "logs" ? "gamelogs"
    : "";

  // q aliases: q, search, name
  const q = firstDefined(req.query.q, req.query.search, req.query.name);

  // player id aliases: player_id, playerId, id
  const player_id = firstDefined(req.query.player_id, req.query.playerId, req.query.id);

  // last_n aliases: last_n, lastN, n
  const last_n = firstDefined(req.query.last_n, req.query.lastN, req.query.n, "10");

  // optional season override:
  // expects season start year, e.g. 2025 for 2025-26 season
  const seasonParam = firstDefined(req.query.season, req.query.seasons);

  const apiKey = process.env.BALLDONTLIE_API_KEY;

  // IMPORTANT: BallDontLie expects Authorization to be the key (no "Bearer" needed)
  const hdrs = { Authorization: apiKey };

  try {
    // ---------- SEARCH ----------
    if (type === "search") {
      if (!q) return res.status(400).json({ error: "Missing ?q= (or ?search=)" });

      const upstreamUrl = `${API_BASE}/players?search=${encodeURIComponent(q)}&per_page=10`;
      const r = await fetch(upstreamUrl, { headers: hdrs });

      if (!r.ok) {
        return res.status(r.status).json({ error: await r.text(), upstreamUrl });
      }

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
      if (!player_id) return res.status(400).json({ error: "Missing ?player_id= (or ?playerId= or ?id=)" });

      const lastN = Math.min(Math.max(parseInt(last_n, 10) || 10, 1), 50);

      // 1) Player info (for team + opponent calc)
      const pUrl = `${API_BASE}/players/${player_id}`;
      const pRes = await fetch(pUrl, { headers: hdrs });

      if (!pRes.ok) {
        return res.status(pRes.status).json({ error: await pRes.text(), pUrl });
      }

      const pJson = await pRes.json();
      const teamId = pJson?.data?.team?.id;
      const teamAbbr = String(pJson?.data?.team?.abbreviation || "");

      if (!teamId) {
        return res.json({
          source: "balldontlie",
          type: "gamelogs",
          data: [],
          fetched_at: new Date().toISOString(),
        });
      }

      // 2) Determine seasons to query
      const seasonStart = seasonParam ? parseInt(seasonParam, 10) : currentSeasonStartYear();
      const seasonsToTry = seasonParam
        ? [seasonStart]                  // user forced a specific season
        : [seasonStart, seasonStart - 1]; // default: current + previous

      // 3) Fetch completed games for team
      let games = await fetchGames(teamId, seasonsToTry, hdrs);

      // Fallback: if no completed games (edge case), retry without season filter
      if (games.length === 0 && !seasonParam) {
        games = await fetchGames(teamId, [], hdrs);
      }

      games.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

      // We grab more games than needed because stats results can be missing for DNPs/etc
      const recentGames = games.slice(0, Math.min(lastN * 3, 150));

      if (recentGames.length === 0) {
        return res.json({
          source: "balldontlie",
          type: "gamelogs",
          data: [],
          fetched_at: new Date().toISOString(),
        });
      }

      // 4) Fetch stats for those games
      let statsUrl = `${API_BASE}/stats?player_ids[]=${player_id}&per_page=100`;
      for (const g of recentGames) statsUrl += `&game_ids[]=${g.id}`;

      const sRes = await fetch(statsUrl, { headers: hdrs });

      if (!sRes.ok) {
        return res.status(sRes.status).json({ error: await sRes.text(), statsUrl });
      }

      const sJson = await sRes.json();
      const allStats = sJson?.data || [];

      // 5) Sort by game date desc and take lastN
      allStats.sort((a, b) => String(b.game?.date || "").localeCompare(String(a.game?.date || "")));
      const top = allStats.slice(0, lastN);

      // 6) Map to clean objects
      const logs = top.map((s) => {
        const g = s.game || {};
        const hAbbr = g.home_team?.abbreviation || "";
        const vAbbr = g.visitor_team?.abbreviation || "";
        const opp = teamAbbr === hAbbr ? vAbbr : hAbbr;

        // min can be "37", "37:12", etc
        let minutes = 0;
        if (s.min != null) minutes = num(String(s.min).split(":")[0]);

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
        type: "gamelogs",
        player_id: String(player_id),
        season: seasonStart,
        last_n: lastN,
        data: logs,
        fetched_at: new Date().toISOString(),
      });
    }

    return res.status(400).json({
      error: `Unknown type "${typeRaw}". Use ?type=search or ?type=gamelogs`,
      hint: "Also accepts: type=players (search), type=player_games (gamelogs)",
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
