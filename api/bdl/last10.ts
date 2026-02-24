import type { VercelRequest, VercelResponse } from "@vercel/node";

function nbaHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: "https://www.nba.com",
    Referer: "https://www.nba.com/",
    Connection: "keep-alive",
  };
}

function getSeasonString() {
  const date = new Date();
  const y = date.getFullYear();
  const m = date.getMonth();
  const startYear = m >= 9 ? y : y - 1;
  const endYear2 = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYear2}`;
}

function mean(arr: number[]) {
  return arr.length
    ? arr.reduce((s, v) => s + v, 0) / arr.length
    : 0;
}

function stddev(arr: number[]) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v =
    arr.reduce((s, x) => s + (x - m) ** 2, 0) /
    (arr.length - 1);
  return Math.sqrt(v);
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  try {
    const playerId = String(req.query.playerId || "").trim();
    if (!playerId) {
      return res.status(400).json({ error: "Missing ?playerId=" });
    }

    const season = getSeasonString();

    const url =
      "https://stats.nba.com/stats/playergamelog" +
      `?PlayerID=${playerId}` +
      `&Season=${season}` +
      `&SeasonType=Regular%20Season`;

    const response = await fetch(url, { headers: nbaHeaders() });
    if (!response.ok) {
      throw new Error(`NBAStats HTTP ${response.status}`);
    }

    const data = await response.json();
    const rs = data?.resultSets?.[0] || data?.resultSet;
    const headers = rs?.headers || [];
    const rows = rs?.rowSet || [];

    const idx = (h: string) => headers.indexOf(h);

    const iDate = idx("GAME_DATE");
    const iPts = idx("PTS");
    const iReb = idx("REB");
    const iAst = idx("AST");

    const games = rows
      .map((r: any[]) => ({
        date: r[iDate],
        pts: Number(r[iPts] || 0),
        reb: Number(r[iReb] || 0),
        ast: Number(r[iAst] || 0),
      }))
      .slice(0, 10);

    const ptsArr = games.map(g => g.pts);
    const rebArr = games.map(g => g.reb);
    const astArr = games.map(g => g.ast);

    return res.status(200).json({
      averages: {
        pts: Number(mean(ptsArr).toFixed(2)),
        reb: Number(mean(rebArr).toFixed(2)),
        ast: Number(mean(astArr).toFixed(2)),
        gamesAnalyzed: games.length,
      },
      volatility: {
        pts: Number(stddev(ptsArr).toFixed(2)),
        reb: Number(stddev(rebArr).toFixed(2)),
        ast: Number(stddev(astArr).toFixed(2)),
      },
      games,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
