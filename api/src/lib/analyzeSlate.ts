// src/lib/analyzeSlate.ts
import { monteCarloProject, PropDirection, ProjectionResult } from "./projections";

/**
 * HOW THIS WORKS (no code edits needed):
 * - If you have SUPABASE edge functions set, it will use them.
 * - Otherwise it falls back to your Vercel proxy:
 *   https://slateranker-proxy.vercel.app/api/nba
 *
 * Optional env vars (recommended):
 *   VITE_SUPABASE_URL=https://xxxx.supabase.co
 *   VITE_SUPABASE_ANON_KEY=xxxxx
 *
 * If you DON’T set them, it will still work via the Vercel proxy.
 */

type GameLog = {
  date: string;
  opponent?: string;

  // can be number or "37:12"
  minutes: number | string;

  pts: number;
  reb: number;
  ast: number;

  // Optional (depends on backend mapping)
  stl?: number;
  blk?: number;

  three_pm?: number; // 3PT made (some sources)
  fg3m?: number;     // 3PT made (balldontlie naming)
  fg3a?: number;     // 3PT attempted

  turnover?: number;
  tov?: number; // alternate naming

  // optional extras later
  dunks?: number;
};

export type SlateProp = {
  id: string;

  playerName: string;
  playerId?: string;

  statType:
    | "PTS"
    | "REB"
    | "AST"
    | "STL"
    | "BLK"
    | "3PM"
    | "3PA"
    | "TO"
    | "PRA"
    | "PR"
    | "PA"
    | "RA";

  line: number;
  pick: PropDirection; // "OVER" | "UNDER"
  lastN?: number;      // default 10
};

export type RankedProp = {
  prop: SlateProp;
  result: ProjectionResult;

  // optional extras you can use for better charts later
  series: number[];
  dates: string[];
  minutes: number[];
};

// ---------------------------
// Config (works out of the box)
// ---------------------------
const VERCEL_PROXY_BASE = "https://slateranker-proxy.vercel.app/api/nba";

// Supabase (optional, preferred)
const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;

// If you set Supabase, we call edge functions like:
//   `${SUPABASE_URL}/functions/v1/player-search?q=LeBron%20James`
//   `${SUPABASE_URL}/functions/v1/player-gamelogs?player_id=237&last_n=10`
const EDGE_SEARCH_FN = "player-search";
const EDGE_GAMELOGS_FN = "player-gamelogs";

function hasSupabase() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function supabaseHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    apikey: SUPABASE_ANON_KEY!,
  };
}

// ---------------------------
// Helpers
// ---------------------------
function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function minutesToNum(v: any) {
  // supports 36 or "36:12"
  if (typeof v === "string") return num(v.split(":")[0]);
  return num(v);
}

function normalizeName(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreNameMatch(candidateFull: string, queryFull: string) {
  const c = normalizeName(candidateFull);
  const q = normalizeName(queryFull);
  if (!c || !q) return 0;
  if (c === q) return 1000;

  const tokens = q.split(" ").filter(Boolean);
  let hits = 0;
  for (const t of tokens) if (c.includes(t)) hits += 1;

  return hits * 100 - Math.max(0, c.length - q.length);
}

function getThreePM(g: GameLog) {
  // support both three_pm and fg3m
  return num((g as any).three_pm ?? (g as any).fg3m);
}

function getTurnovers(g: GameLog) {
  // support turnover or tov
  return num((g as any).turnover ?? (g as any).tov);
}

/**
 * IMPORTANT QUALITY FIX:
 * Remove “0 minute” games (DNP / inactive / not in rotation).
 * These destroy averages/projections, especially for rookies.
 */
function filterPlayableLogs(logs: GameLog[]) {
  return (logs || []).filter((g) => minutesToNum((g as any).minutes) > 0);
}

function seriesFromLogs(logsRaw: GameLog[], statType: SlateProp["statType"]) {
  // 1) filter out DNPs / 0-minute games
  const logs = filterPlayableLogs(logsRaw);

  // 2) newest first
  const sorted = [...logs].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const series: number[] = [];
  const dates: string[] = [];
  const minutes: number[] = [];

  for (const g of sorted) {
    const pts = num(g.pts);
    const reb = num(g.reb);
    const ast = num(g.ast);

    let value = 0;

    switch (statType) {
      case "PTS": value = pts; break;
      case "REB": value = reb; break;
      case "AST": value = ast; break;

      case "STL": value = num((g as any).stl); break;
      case "BLK": value = num((g as any).blk); break;

      case "3PM": value = getThreePM(g); break;
      case "3PA": value = num((g as any).fg3a); break;

      case "TO": value = getTurnovers(g); break;

      case "PRA": value = pts + reb + ast; break;
      case "PR":  value = pts + reb; break;
      case "PA":  value = pts + ast; break;
      case "RA":  value = reb + ast; break;

      default: value = 0;
    }

    series.push(value);
    dates.push(String(g.date || "").slice(0, 10));
    minutes.push(minutesToNum((g as any).minutes));
  }

  return { series, dates, minutes };
}

// ---------------------------
// API calls (Edge preferred, Proxy fallback)
// ---------------------------
async function searchPlayersByName(playerName: string): Promise<Array<{ id: string; full_name: string }>> {
  const q = playerName.trim();
  if (!q) return [];

  // 1) Prefer Supabase Edge
  if (hasSupabase()) {
    const url = `${SUPABASE_URL}/functions/v1/${EDGE_SEARCH_FN}?q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: supabaseHeaders() });
    if (!res.ok) throw new Error(`player-search failed: ${res.status} ${await res.text()}`);

    const json = await res.json();
    const data = (json?.data || []) as any[];

    return data.map((p) => ({
      id: String(p.id),
      full_name: `${p.first_name || ""} ${p.last_name || ""}`.trim(),
    }));
  }

  // 2) Fallback: Vercel proxy
  const url = `${VERCEL_PROXY_BASE}?type=search&q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`proxy search failed: ${res.status} ${await res.text()}`);

  const json = await res.json();
  const data = (json?.data || []) as any[];

  return data.map((p) => ({
    id: String(p.id),
    full_name: `${p.first_name || ""} ${p.last_name || ""}`.trim(),
  }));
}

async function resolvePlayerId(playerName: string): Promise<string | null> {
  const candidates = await searchPlayersByName(playerName);
  if (!candidates.length) return null;

  let best = candidates[0];
  let bestScore = scoreNameMatch(best.full_name, playerName);

  for (const c of candidates) {
    const s = scoreNameMatch(c.full_name, playerName);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }

  return best?.id ?? null;
}

async function fetchPlayerGameLogs(playerId: string, lastN: number): Promise<GameLog[]> {
  const n = Math.min(Math.max(lastN || 10, 1), 50);

  // 1) Prefer Supabase Edge
  if (hasSupabase()) {
    const url =
      `${SUPABASE_URL}/functions/v1/${EDGE_GAMELOGS_FN}` +
      `?player_id=${encodeURIComponent(playerId)}` +
      `&last_n=${encodeURIComponent(String(n))}`;

    const res = await fetch(url, { headers: supabaseHeaders() });
    if (!res.ok) throw new Error(`player-gamelogs failed: ${res.status} ${await res.text()}`);

    const json = await res.json();
    return (json?.data || []) as GameLog[];
  }

  // 2) Fallback: Vercel proxy
  const url =
    `${VERCEL_PROXY_BASE}?type=gamelogs` +
    `&player_id=${encodeURIComponent(playerId)}` +
    `&last_n=${encodeURIComponent(String(n))}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`proxy gamelogs failed: ${res.status} ${await res.text()}`);

  const json = await res.json();
  return (json?.data || []) as GameLog[];
}

// ---------------------------
// Main
// ---------------------------
export async function analyzeSlate(props: SlateProp[]): Promise<RankedProp[]> {
  const ranked: RankedProp[] = [];

  for (const p of props) {
    const lastN = p.lastN ?? 10;

    // Ensure we have playerId
    let playerId = p.playerId;
    if (!playerId) {
      playerId = await resolvePlayerId(p.playerName);
      if (!playerId) continue;
    }

    // Grab extra because we may filter out 0-minute games
    const logsRaw = await fetchPlayerGameLogs(playerId, Math.min(50, Math.max(15, lastN + 10)));

    const { series, dates, minutes } = seriesFromLogs(logsRaw, p.statType);

    // after filtering, take lastN
    const slicedSeries = series.slice(0, lastN);

    // If player has too few playable games, skip
    if (slicedSeries.length < Math.min(5, lastN)) continue;

    const result = monteCarloProject({
      series: slicedSeries,
      line: p.line,
      direction: p.pick,
      simulations: 7000,
      clampMin: 0,
    });

    ranked.push({
      prop: { ...p, playerId },
      result,
      series: slicedSeries,
      dates: dates.slice(0, lastN),
      minutes: minutes.slice(0, lastN),
    });
  }

  // Sort: confidence DESC then edge DESC
  ranked.sort((a, b) => {
    if (b.result.confidence !== a.result.confidence) return b.result.confidence - a.result.confidence;
    return b.result.edge - a.result.edge;
  });

  return ranked;
}
