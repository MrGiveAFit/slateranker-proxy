import type { VercelRequest, VercelResponse } from "@vercel/node";

const NBA_STATS_BASE = "https://stats.nba.com/stats";

// NBA Stats is picky about headers.
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

// Compute season like "2025-26"
function currentSeason(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-12
  // NBA season typically starts Oct. If we're before Oct, we're in prior season.
  const startYear = m >= 10 ? y : y - 1;
  const endYY = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYY}`;
}

type CommonAllPlayersRow = [
  number, // PERSON_ID
  string, // DISPLAY_LAST_COMMA_FIRST
  string, // DISPLAY_FIRST_LAST
  string, // ROSTERSTATUS
  string, // FROM_YEAR
  string, // TO_YEAR
  number, // PLAYER_CODE (sometimes)
  string, // TEAM_ID
  string, // TEAM_CITY
  string, // TEAM_NAME
  string, // TEAM_ABBREVIATION
  string // TEAM_CODE
];

function safeLower(s: string) {
  return (s || "").toLowerCase();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const name = String(req.query.name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "Missing ?name=" });
    }

    const season = currentSeason();

    const url =
      `${NBA_STATS_BASE}/commonallplayers` +
      `?LeagueID=00&Season=${encodeURIComponent(season)}&IsOnlyCurrentSeason=1`;

    const r = await fetch(url, { headers: nbaHeaders() });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res
        .status(500)
        .json({ error: `NBA Stats error ${r.status}`, detail: text.slice(0, 300) });
    }

    const json: any = await r.json();
    const rs = json?.resultSets?.[0] || json?.resultSet;
    const rows: CommonAllPlayersRow[] = rs?.rowSet || [];
    const q = safeLower(name);

    // Filter matches (contains)
    const matches = rows
      .map((row) => {
        const personId = row[0];
        const fullName = row[2];
        const teamAbbrev = row[10] || "";
        return { id: String(personId), full_name: fullName, team: teamAbbrev };
      })
      .filter((p) => safeLower(p.full_name).includes(q));

    // If no match, try last name only (helps "Victor Wembanyama" edge cases)
    let finalMatches = matches;
    if (!finalMatches.length) {
      const parts = name.split(/\s+/).filter(Boolean);
      const last = parts[parts.length - 1] || name;
      const q2 = safeLower(last);
      finalMatches = rows
        .map((row) => {
          const personId = row[0];
          const fullName = row[2];
          const teamAbbrev = row[10] || "";
          return { id: String(personId), full_name: fullName, team: teamAbbrev };
        })
        .filter((p) => safeLower(p.full_name).includes(q2));
    }

    // Return top 10
    const players = finalMatches.slice(0, 10).map((p) => ({
      id: p.id,
      full_name: p.full_name,
      team: p.team,
      position: undefined,
    }));

    return res.status(200).json({
      query: name,
      count: players.length,
      players,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
