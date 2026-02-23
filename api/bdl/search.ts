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

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Missing BALLDONTLIE_API_KEY" });

  const nameRaw = (req.query.name ?? "").toString().trim();
  if (!nameRaw) return res.status(400).json({ error: "Missing name query param" });

  try {
    // Goat version uses this format:
    const url = `${BDL_BASE}/players?first_name=${encodeURIComponent(
      nameRaw.split(" ")[0]
    )}&last_name=${encodeURIComponent(nameRaw.split(" ")[1] ?? "")}`;

    const r = await fetch(url, {
      headers: {
        Authorization: apiKey,
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

    const players = (json?.data ?? []).map((p: any) => ({
      id: String(p.id),
      full_name: `${p.first_name} ${p.last_name}`,
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
