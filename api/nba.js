// /api/nba.js (Vercel serverless function)
// Supports:
//  - ?type=search&q=lebron
//  - ?type=gamelogs&player_id=237&last_n=10
// Add &debug=1 to see upstream status + snippet (safe).

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

function buildAuthHeaders() {
  // Accept either env var name (in case one was set earlier)
  const key =
    process.env.BALLDONTLIE_API_KEY ||
    process.env.BALLDONTLIE_API_KEY ||
    "";

  // Do NOT log this key. We only ever reveal boolean presence in debug.
  // Some APIs want Authorization: <key>
  // Some want Authorization: Bearer <key>
  // Some want X-API-KEY / X-Api-Key
  const hdrs = {
    "Content-Type": "application/json",
  };

  if (key) {
    hdrs["Authorization"] = key;
    hdrs["X-API-KEY"] = key;
    hdrs["X-Api-Key"] = key;
    hdrs["Authorization-Bearer"] = `Bearer ${key}`; // harmless extra
    // NOTE: we do not overwrite Authorization with Bearer because your earlier tests succeeded.
  }

  return { hdrs, hasKey: Boolean(key) };
}

async function safeFetch(url, hdrs) {
  const r = await fetch(url, { headers: hdrs });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    // ignore
  }
  return { ok: r.ok, status: r.status, text, json };
}

async function fetchGames(teamId, seasons, hdrs) {
  let url = `${API_BASE}/games?team_ids[]=${teamId}&per_page=100`;
  for (const s of seasons) url += `&seasons[]=${s}`;

  const { ok, json } = await safeFetch(url, hdrs);
  if (!ok || !json) return [];
  return (json.data || []).filter((g) => g.status === "Final");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { type, q, player_id, last_n = "10", debug = "0" } = req.query;
  const { hdrs, hasKey } = buildAuthHeaders();
  const isDebug = String(debug) === "1";

  try {
    // ---------- SEARCH ----------
    if (type === "search") {
      if (!q) return res.status(400).json({ error: "Missing ?q=" });

      const url = `${API_BASE}/players?search=${encodeURIComponent(q)}&per_page=10`;
      const r = await safeFetch(url, hdrs);

      if (isDebug) {
        return res.json({
          debug: true,
          hasKey,
          upstream_url: url,
          upstream_status: r.status,
          upstream_ok: r.ok,
          upstream_snippet: r.text.slice(0, 220),
          parsed_has_data: Boolean(r.json && r.json.data),
          fetched_at: new Date().toISOString(),
        });
      }

      if (!r.ok) return res.status(r.status).json({ error: r.text });

      const players = (r.json?.data || []).map((p) => ({
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

      // 1) player -> team
      const pUrl = `${API_BASE}/players/${player_id}`;
      const pRes = await safeFetch(pUrl, hdrs);
      if (!pRes.ok) {
        if (isDebug) {
          return res.json({
            debug: true,
            step: "player_fetch",
            hasKey,
            upstream_url: pUrl,
            upstream_status: pRes.status,
            upstream_snippet: pRes.text.slice(0, 220),
            fetched_at: new Date().toISOString(),
          });
        }
        return res.status(pRes.status).json({ error: pRes.text });
      }

      const teamId = pRes.json?.data?.team?.id;
      const teamAbbr = String(pRes.json?.data?.team?.abbreviation || "");
      if (!teamId) {
        return res.json({ source: "balldontlie", data: [], fetched_at: new Date().toISOString() });
      }

      // 2) games: current + last season, fallback to unfiltered
      const season = currentSeason();
      let games = await fetchGames(teamId, [season, season - 1], hdrs);
      if (games.length === 0) games = await fetchGames(teamId, [], hdrs);

      games.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      const recent = games.slice(0, lastN * 2);
      if (recent.length === 0) {
        return res.json({ source: "balldontlie", data: [], fetched_at: new Date().toISOString() });
      }

      // 3) stats for those games
      let statsUrl = `${API_BASE}/stats?player_ids[]=${player_id}&per_page=100`;
      for (const g of recent) statsUrl += `&game_ids[]=${g.id}`;

      const sRes = await safeFetch(statsUrl, hdrs);

      if (isDebug) {
        return res.json({
          debug: true,
          step: "stats_fetch",
          hasKey,
          games_found: games.length,
          recent_games_used: recent.length,
          upstream_url: statsUrl.slice(0, 200) + (statsUrl.length > 200 ? "..." : ""),
          upstream_status: sRes.status,
          upstream_ok: sRes.ok,
          upstream_snippet: sRes.text.slice(0, 220),
          fetched_at: new Date().toISOString(),
        });
      }

      if (!sRes.ok) return res.status(sRes.status).json({ error: sRes.text });

      const allStats = sRes.json?.data || [];
      allStats.sort((a, b) => String(b.game?.date || "").localeCompare(String(a.game?.date || "")));
      const top = allStats.slice(0, lastN);

      const logs = top.map((s) => {
        const g = s.game || {};
        const hAbbr = g.home_team?.abbreviation || "";
        const vAbbr = g.visitor_team?.abbreviation || "";
        const opp = teamAbbr ? (teamAbbr === hAbbr ? vAbbr : hAbbr) : "";

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

      return res.json({ source: "balldontlie", data: logs, fetched_at: new Date().toISOString() });
    }

    return res.status(400).json({ error: "Unknown type. Use ?type=search or ?type=gamelogs" });
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
