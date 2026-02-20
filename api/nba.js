// src/lib/api.ts

import { calculateProjection } from "./projectionEngine";

const PROXY_BASE = "https://slateranker-proxy.vercel.app/api/nba";

export async function searchPlayers(name: string) {
  const res = await fetch(
    `${PROXY_BASE}?type=search&q=${encodeURIComponent(name)}`
  );
  const json = await res.json();
  return json.data || [];
}

export async function fetchPlayerGameLogs(playerId: number) {
  const res = await fetch(
    `${PROXY_BASE}?type=gamelogs&player_id=${playerId}&last_n=20`
  );
  const json = await res.json();
  return json.data || [];
}

export async function analyzePlayer(
  playerName: string,
  statKey: string,
  propLine: number
) {
  const players = await searchPlayers(playerName);
  if (!players.length) return null;

  const playerId = players[0].id;
  const logs = await fetchPlayerGameLogs(playerId);

  if (!logs.length) return null;

  const result = calculateProjection(logs, statKey as any, propLine);

  if (!result) return null;

  return {
    playerId,
    logs,
    ...result,
  };
}
