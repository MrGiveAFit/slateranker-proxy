// api/bdl/last10.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const BDL_BASE = "https://api.balldontlie.io/v1";

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function getApiKey() {
  return process.env.BALLDONTLIE_API_KEY || "";
}

async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function bdlFetch(url: string) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, status: 401, json: { error: "Missing BALLDONTLIE_API_KEY", status: 401 } };
  }

  const tries: Array<Record<string, string>> = [
    { Authorization: apiKey },
    { Authorization: `Bearer ${apiKey}` },
    { "X-API-KEY": apiKey } as any,
  ];

  let lastErr: any = null;

  for (const headers of tries) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) return { ok: true, status: res.status, json: await res.json() };

      if (res.status === 401 || res.status === 403) {
        lastErr = { error: "Upstream auth error", status: res.status, detail: await safeText(res) };
        continue;
      }

      return { ok: false, status: res.status, json: { error: "Upstream error", status: res.status, detail: await safeText(res) } };
    } catch (e: any) {
      lastErr = { error: "Fetch failed", status: 500, detail: String(e?.message || e) };
    }
  }

  return { ok: false, status: lastErr?.status || 500, json: lastErr || { error: "Fetch failed", status: 500 } };
}

function toISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function mean(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stddev(nums: number[]) {
  if (nums.length <= 1) return 0;
  const m = mean(nums);
  const v = mean(nums.map((x) => (x - m) ** 2));
  return Math.sqrt(v);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const playerId = String(req.query.playerId || "").trim();
  if (!playerId) {
    return res.status(400).json({ error: "Missing ?playerId=", status: 400 });
  }

  // Pull a wider window, then slice to last 10 actual games.
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 180); // last ~6 months

  // BDL stats endpoint supports player_ids[] and date range
  const url =
    `${BDL_BASE}/stats?player_ids[]=${encodeURIComponent(playerId)}` +
    `&start_date=${encodeURIComponent(toISODate(start))}` +
    `&end_date=${encodeURIComponent(toISODate(end))}` +
    `&per_page=100&postseason=false`;

  const result = await bdlFetch(url);
  if (!result.ok) return res.status(result.status).json(result.json);

  const raw = result.json as any;
  const rows: any[] = Array.isArray(raw?.data) ? raw.data : [];

  // Convert to our simplified game list.
  // Some BDL payloads have game.date; some have game?.date or game?.start_time.
  const games = rows
    .map((s) => {
      const dateStr = String(s?.game?.date || s?.game?.start_time || s?.game?.startTime || "");
      const dateIso = dateStr ? dateStr.slice(0, 10) : "";
      return {
        date: dateIso || "unknown",
        pts: Number(s?.pts ?? 0),
        reb: Number(s?.reb ?? 0),
        ast: Number(s?.ast ?? 0),
      };
    })
    .filter((g) => g.date !== "unknown");

  // Sort newest first, take last 10
  games.sort((a, b) => (a.date < b.date ? 1 : -1));
  const last10 = games.slice(0, 10);

  const ptsArr = last10.map((g) => g.pts);
  const rebArr = last10.map((g) => g.reb);
  const astArr = last10.map((g) => g.ast);

  const response = {
    playerId,
    averages: {
      pts: Number(mean(ptsArr).toFixed(1)),
      reb: Number(mean(rebArr).toFixed(1)),
      ast: Number(mean(astArr).toFixed(1)),
      gamesAnalyzed: last10.length,
    },
    volatility: {
      pts: Number(stddev(ptsArr).toFixed(2)),
      reb: Number(stddev(rebArr).toFixed(2)),
      ast: Number(stddev(astArr).toFixed(2)),
    },
    games: last10
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : 1)), // show oldest -> newest
  };

  return res.status(200).json(response);
}
