// api/bdl/players.ts
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

async function bdlFetch(url: string) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, status: 401, json: { error: "Missing BALLDONTLIE_API_KEY", status: 401 } };
  }

  // Try common auth styles (some accounts use raw key, some use Bearer)
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

      // If unauthorized, try next style
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

async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const name = String(req.query.name || "").trim();
  if (!name) {
    return res.status(400).json({ error: "Missing ?name=", status: 400 });
  }

  // BallDontLie uses `search` for players
  const url = `${BDL_BASE}/players?search=${encodeURIComponent(name)}&per_page=25`;

  const result = await bdlFetch(url);
  if (!result.ok) return res.status(result.status).json(result.json);

  const data = result.json as any;

  const players = Array.isArray(data?.data)
    ? data.data.map((p: any) => ({
        id: String(p.id),
        full_name: String(p.first_name && p.last_name ? `${p.first_name} ${p.last_name}` : p.name || "Unknown"),
        team: p.team?.abbreviation ? String(p.team.abbreviation) : undefined,
        position: p.position ? String(p.position) : undefined,
      }))
    : [];

  return res.status(200).json({
    query: name,
    count: players.length,
    players,
  });
}
