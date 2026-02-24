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

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  try {
    const name = String(req.query.name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "Missing ?name=" });
    }

    const season = getSeasonString();
    const url =
      "https://stats.nba.com/stats/commonallplayers" +
      `?LeagueID=00&Season=${season}&IsOnlyCurrentSeason=1`;

    const response = await fetch(url, { headers: nbaHeaders() });
    if (!response.ok) {
      throw new Error(`NBAStats HTTP ${response.status}`);
    }

    const data = await response.json();
    const rs = data?.resultSets?.[0] || data?.resultSet;
    const headers = rs?.headers || [];
    const rows = rs?.rowSet || [];

    const idx = (h: string) => headers.indexOf(h);

    const iPlayerId = idx("PERSON_ID");
    const iName = idx("DISPLAY_FIRST_LAST");
    const iTeam = idx("TEAM_ABBREVIATION");

    const q = name.toLowerCase();

    const players = rows
      .map((r: any[]) => ({
        id: String(r[iPlayerId]),
        full_name: String(r[iName] || ""),
        team: String(r[iTeam] || ""),
        position: "",
      }))
      .filter((p: any) => p.full_name.toLowerCase().includes(q))
      .slice(0, 10);

    return res.status(200).json({
      query: name,
      count: players.length,
      players,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
