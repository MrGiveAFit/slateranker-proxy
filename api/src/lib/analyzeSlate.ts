// src/lib/analyzeSlate.ts
import { monteCarloProject, PropDirection, ProjectionResult } from "./projections";

// IMPORTANT:
// This file assumes you already have a function that fetches game logs for a player.
// If your project already has something like `fetchPlayerGameLogs(...)`, plug it in below.

type GameLog = {
  date: string;
  minutes: number;
  pts: number;
  reb: number;
  ast: number;
  three_pm?: number;
  fg3a?: number;
  turnover?: number;
  stl?: number;
  blk?: number;
  // add more fields as your API supports them
};

// Your prop as stored in the app
export type SlateProp = {
  id: string;
  playerName: string;
  playerId?: string; // if you already store it, great
  statType:
    | "PTS"
    | "REB"
    | "AST"
    | "STL"
    | "BLK"
    | "3PM"
    | "3PA"
    | "TO"
    | "PRA"; // points+reb+ast
  line: number;
  pick: PropDirection; // OVER or UNDER
  lastN?: number;      // default 10
};

export type RankedProp = {
  prop: SlateProp;
  result: ProjectionResult;
};

// Replace this with YOUR existing API call.
// It should return the most recent games first or any order, we handle either way.
async function fetchPlayerGameLogs(playerId: string, lastN: number): Promise<GameLog[]> {
  // OPTION A: call your proxy / edge function endpoint:
  // const url = `https://slateranker-proxy.vercel.app/api/nba?type=gamelogs&player_id=${playerId}&last_n=${lastN}`;
  // const res = await fetch(url);
  // const json = await res.json();
  // return json.data as GameLog[];

  // Placeholder so TypeScript doesn’t complain.
  // YOU MUST REPLACE THIS with your real implementation.
  throw new Error("fetchPlayerGameLogs() not wired. Plug in your real API call here.");
}

function seriesFromLogs(logs: GameLog[], statType: SlateProp["statType"]) {
  // sort desc by date just in case
  const sorted = [...logs].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return sorted.map((g) => {
    switch (statType) {
      case "PTS": return g.pts ?? 0;
      case "REB": return g.reb ?? 0;
      case "AST": return g.ast ?? 0;

      // If your API doesn’t provide these yet, they’ll be 0 until we add them to the backend mapping.
      case "STL": return (g.stl ?? 0);
      case "BLK": return (g.blk ?? 0);
      case "3PM": return (g.three_pm ?? 0);
      case "3PA": return (g.fg3a ?? 0);
      case "TO":  return (g.turnover ?? 0);

      case "PRA": return (g.pts ?? 0) + (g.reb ?? 0) + (g.ast ?? 0);
      default: return 0;
    }
  });
}

export async function analyzeSlate(props: SlateProp[]): Promise<RankedProp[]> {
  const ranked: RankedProp[] = [];

  for (const p of props) {
    if (!p.playerId) {
      // If you don’t have playerId stored yet, the next improvement is:
      // - resolve playerId from name once, then cache it in the prop.
      // For now, we must have playerId to run.
      continue;
    }

    const lastN = p.lastN ?? 10;
    const logs = await fetchPlayerGameLogs(p.playerId, Math.max(10, lastN));
    const series = seriesFromLogs(logs, p.statType).slice(0, lastN);

    const result = monteCarloProject({
      series,
      line: p.line,
      direction: p.pick,
      simulations: 7000, // good default: accurate but not slow
      clampMin: 0,
    });

    ranked.push({ prop: p, result });
  }

  // Sort: best confidence first, then best edge
  ranked.sort((a, b) => {
    if (b.result.confidence !== a.result.confidence) {
      return b.result.confidence - a.result.confidence;
    }
    return b.result.edge - a.result.edge;
  });

  return ranked;
}
