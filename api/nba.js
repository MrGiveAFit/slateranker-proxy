// /api/nba.js (Vercel serverless function)
// BallDontLie proxy for SlateRanker
//
// Supported:
// 1) Player search:
//    /api/nba?type=players&q=Kevin%20Durant
//    (also accepts `search=` as an alias for `q=`)
//
// 2) Player game logs (season):
//    /api/nba?type=gamelogs&playerId=140&season=2025
//
// Optional:
//    &per_page=10
//    &debug=1

const API_BASE = "https://api.balldontlie.io/v1";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.end();
  }

  try {
    const { type, q, search, playerId, season, per_page, debug } = req.query;

    // Auth (BallDontLie GOAT key lives in Vercel env var)
    const apiKey =
      process.env.BALLDONTLIE_API_KEY ||
      process.env.BALLDONTLIE_KEY ||
      process.env.BDL_API_KEY;

    if (!apiKey) {
      return json(res, 500, {
        error:
          "Missing BallDontLie API key. Add BALLDONTLIE_API_KEY in Vercel Environment Variables.",
      });
    }

    const wantsDebug = String(debug) === "1" || String(debug) === "true";

    // Normalize inputs
    const normalizedType = (type || "").toString().trim().toLowerCase();
    const queryQ = (q || search || "").toString().trim(); // accept q or search
    const pid = (playerId || "").toString().trim();
    const yr = season ? num(season) : null;
    const perPage = per_page ? Math.min(Math.max(num(per_page), 1), 100) : 10;

    // If user forgets type but provides q/search, assume players search
    // If user forgets type but provides playerId, assume gamelogs
    const inferredType =
      normalizedType ||
      (queryQ ? "players" : pid ? "gamelogs" : "");

    if (!inferredType) {
      return json(res, 400, {
        error:
          "Missing `type`. Use type=players&q=NAME or type=gamelogs&playerId=ID&season=2025",
      });
    }

    let upstreamUrl = "";
    let upstreamRes;
    let upstreamText = "";

    // Helper: call upstream with Bearer token
    async function fetchUpstream(url) {
      const r = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      });
      const t = await r.text();
      return { r, t };
    }

    if (inferredType === "players") {
      if (!queryQ) {
        return json(res, 400, { error: "Missing ?q= (player search query)" });
      }

      upstreamUrl =
        `${API_BASE}/players?search=` +
        encodeURIComponent(queryQ) +
        `&per_page=${perPage}`;

      const { r, t } = await fetchUpstream(upstreamUrl);
      upstreamRes = r;
      upstreamText = t;

      if (!upstreamRes.ok) {
        return json(res, 502, {
          error: "Upstream error from BallDontLie",
          upstream_status: upstreamRes.status,
          ...(wantsDebug ? { upstream_url: upstreamUrl, upstream_body: upstreamText } : {}),
        });
      }

      const parsed = JSON.parse(upstreamText);
      return json(res, 200, {
        source: "balldontlie",
        data: parsed?.data ?? [],
        fetched_at: new Date().toISOString(),
        ...(wantsDebug
          ? {
              debug: true,
              hasKey: true,
              upstream_url: upstreamUrl,
              upstream_status: upstreamRes.status,
            }
          : {}),
      });
    }

    if (inferredType === "gamelogs") {
      if (!pid) {
        return json(res, 400, { error: "Missing playerId=" });
      }
      if (!yr) {
        return json(res, 400, { error: "Missing season= (example: season=2025)" });
      }

      // BallDontLie v1 stats endpoint supports season + player_ids[]
      upstreamUrl =
        `${API_BASE}/stats?seasons[]=` +
        encodeURIComponent(String(yr)) +
        `&player_ids[]=` +
        encodeURIComponent(pid) +
        `&per_page=100`;

      const { r, t } = await fetchUpstream(upstreamUrl);
      upstreamRes = r;
      upstreamText = t;

      if (!upstreamRes.ok) {
        return json(res, 502, {
          error: "Upstream error from BallDontLie",
          upstream_status: upstreamRes.status,
          ...(wantsDebug ? { upstream_url: upstreamUrl, upstream_body: upstreamText } : {}),
        });
      }

      const parsed = JSON.parse(upstreamText);

      // Normalize to the fields SlateRanker expects
      // Sort most recent first if we can infer a date
      const rows = (parsed?.data ?? []).map((s) => ({
        date: s?.game?.date || s?.game?.start_time || "",
        opponent: "", // optional, can be enriched later
        minutes: num(s?.min),
        pts: num(s?.pts),
        reb: num(s?.reb),
        ast: num(s?.ast),
        three_pm: num(s?.fg3m),
        fgm: num(s?.fgm),
        fga: num(s?.fga),
        fg3a: num(s?.fg3a),
        ftm: num(s?.ftm),
        fta: num(s?.fta),
        turnover: num(s?.turnover),
        pf: num(s?.pf),
        plus_minus: num(s?.plus_minus),
        pra: num(s?.pts) + num(s?.reb) + num(s?.ast),
      }));

      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));

      return json(res, 200, {
        source: "balldontlie",
        data: rows,
        fetched_at: new Date().toISOString(),
        ...(wantsDebug
          ? {
              debug: true,
              hasKey: true,
              upstream_url: upstreamUrl,
              upstream_status: upstreamRes.status,
              parsed_count: rows.length,
            }
          : {}),
      });
    }

    return json(res, 400, {
      error: `Unknown type "${inferredType}". Use type=players or type=gamelogs`,
    });
  } catch (err) {
    return json(res, 500, {
      error: "Server error",
      message: err?.message || String(err),
    });
  }
}
