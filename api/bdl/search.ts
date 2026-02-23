// api/bdl/search.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const BDL_BASE = "https://api.balldontlie.io/v1";

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing BALLDONTLIE_API_KEY on server" });
  }

  const nameRaw = (req.query.name ?? "").toString().trim();
  if (!nameRaw) {
    return res.status(400).json({ error: "Missing query param: name" });
  }

  try {
    // BallDontLie players endpoint supports search
    const url = `${BDL_BASE}/players?search=${encodeURIComponent(nameRaw)}&per_page=10`;
    const r = await fetch(url, {
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
    });

    const text = await r.text();
    if (!r.ok) {
      return res.status(r.status).json({
        error: "BallDontLie error",
        status: r.status,
        body: text,
      });
    }

    const json = JSON.parse(text);

    // Normalize to a small payload your app can use easily
    const players = (json?.data ?? []).map((p: any) => ({
      id: String(p.id),
      first_name: p.first_name,
      last_name: p.last_name,
      full_name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      team: p.team?.abbreviation ?? null,
      position: p.position ?? null,
    }));

    return res.status(200).json({
      query: nameRaw,
      count: players.length,
      players,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: "Server exception",
      message: err?.message ?? String(err),
    });
  }
}
