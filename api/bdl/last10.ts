import type { VercelRequest, VercelResponse } from "@vercel/node";

const NBA_STATS_BASE = "https://stats.nba.com/stats";

function nbaHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: "https://www.nba.com",
    Referer: "https://www.nba.com/",
    Connection: "keep-alive",
  };
}

function currentSeason(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const startYear = m >= 10 ? y : y - 1;
  const endYY = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYY}`;
}

function mean(arr: number[]) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr: number[]) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) * (x - m), 0) / (arr.length - 1);
  return Math.sqrt(v);
}

// NBA Stats playergamelog rowSet columns include:
// GAME_DATE, MATCHUP, WL, MIN, FGM, FGA, FG_PCT, FG3M, ... REB, AST, STL, BLK, TOV, PF, PTS
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const playerId = String(req.query.playerId || "").trim();
    if (!playerId) {
      return res.status(400).json({ error: "Missing ?playerId=" });
    }

    const season = currentSeason();

    const url =
      `${NBA_STATS_BASE}/playergamelog` +
      `?LeagueID=00&Season=${encodeURIComponent(season)}` +
      `&SeasonType=Regular+Season&PlayerID=${encodeURIComponent(playerId)}`;

    const r = await fetch(url, { headers: nbaHeaders() });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res
        .status(500)
        .json({ error: `NBA Stats error ${r.status}`, detail: text.slice(0, 300) });
    }

    const json: any = await r.json();
    const rs = json?.resultSets?.[0] || json?.resultSet;
    const headers: string[] = rs?.headers || [];
    const rows: any[][] = rs?.rowSet || [];

    const idx = (h: string) => headers.indexOf(h);

    const iDate = idx("GAME_DATE");
    const iPts = idx("PTS");
    const iReb = idx("REB");
    const iAst = idx("AST");

    if (iDate === -1 || iPts === -1 || iReb === -1 || iAst === -1) {
      return res.status(500).json({
        error: "Unexpected NBA Stats response format (missing columns)",
        headers,
      });
    }

    const games = rows
      .map((row) => ({
        date: String(row[iDate]),
        pts: Number(row[iPts]) || 0,
        reb: Number(row[iReb]) || 0,
        ast: Number(row[iAst]) || 0,
      }))
      // NBA Stats returns most recent first, keep it that way
      .slice(0, 10);

    const ptsArr = games.map((g) => g.pts);
    const rebArr = games.map((g) => g.reb);
    const astArr = games.map((g) => g.ast);

    const averages = {
      pts: Number(mean(ptsArr).toFixed(1)),
      reb: Number(mean(rebArr).toFixed(1)),
      ast: Number(mean(astArr).toFixed(1)),
      gamesAnalyzed: games.length,
    };

    const volatility = {
      pts: Number(stdDev(ptsArr).toFixed(1)),
      reb: Number(stdDev(rebArr).toFixed(1)),
      ast: Number(stdDev(astArr).toFixed(1)),
    };

    return res.status(200).json({
      playerId,
      averages,
      volatility,
      games,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
