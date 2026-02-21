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
  minutes: number;

  pts: number;
  reb: number;
  ast: number;

  // Optional (depends on backend mapping)
  stl?: number;
  blk?: number;

  three_pm?: number; // 3PT made
  fg3a?: number;     // 3PT attempted
  turnover?: number;

  // If you add more later, no problem.
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

function normalizeName(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreNameMatch(candidateFull: string, queryFull: string) {
  // Simple scoring:
  // - exact match gets huge boost
  // - contains all tokens gets medium
  const c = normalizeName(candidateFull);
  const q = normalizeName(queryFull);
  if (!c || !q) return 0;
  if (c === q) return 1000;

  const tokens = q.split(" ").filter(Boolean);
  let hits = 0;
  for (const t of tokens) if (c.includes(t)) hits += 1;

  // weighted: more token matches, plus slight preference for shorter names (less noise)
  return hits * 100 - Math.max(0, c.length - q.length);
}

function seriesFromLogs(logs: GameLog[], statType: SlateProp["statType"]) {
  // Ensure newest first
  const sorted = [...logs].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return sorted.map((g) => {
    const pts = num(g.pts);
    const reb = num(g.reb);
    const ast = num(g.ast);

    switch (statType) {
      case "PTS": return pts;
      case "REB": return reb;
      case "AST": return ast;

      case "STL": return num((g as any).stl);
      case "BLK": return num((g as any).blk);

      case "3PM": return num(g.three_pm);
      case "3PA": return num(g.fg3a);

      case "TO": return num(g.turnover);

      case "PRA": return pts + reb + ast;
      case "PR":  return pts + reb;
      case "PA":  return pts + ast;
      case "RA":  return reb + ast;

      default: return 0;
    }
  });
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
      if (!playerId) {
        // Skip this prop if we can't resolve the player
        continue;
      }
    }

    const logs = await fetchPlayerGameLogs(playerId, Math.max(10, lastN));
    const series = seriesFromLogs(logs, p.statType).slice(0, lastN);

    const result = monteCarloProject({
      series,
      line: p.line,
      direction: p.pick,
      simulations: 7000,
      clampMin: 0,
    });

    ranked.push({
      prop: { ...p, playerId }, // keep resolved id
      result,
    });
  }

  // Sort: confidence DESC then edge DESC
  ranked.sort((a, b) => {
    if (b.result.confidence !== a.result.confidence) return b.result.confidence - a.result.confidence;
    return b.result.edge - a.result.edge;
  });

  return ranked;
}
