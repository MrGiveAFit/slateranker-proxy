import type { VercelRequest, VercelResponse } from "@vercel/node";

const BDL_BASE = "https://api.balldontlie.io/v1";

function bdlHeaders() {
  const key = process.env.BDL_API_KEY;
  return {
    Authorization: key ? key : "",
    Accept: "application/json",
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const name = String(req.query.name || "").trim();
    if (!name) return res.status(400).json({ error: "Missing ?name=" });

    if (!process.env.BDL_API_KEY) {
      return res.status(500).json({ error: "Missing BDL_API_KEY env var on Vercel." });
    }

    // BallDontLie v1 player search uses `search`
    const url = `${BDL_BASE}/players?search=${encodeURIComponent(name)}&per_page=10`;

    const r = await fetch(url, { headers: bdlHeaders() });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(500).json({ error: `BDL error ${r.status}`, detail: text.slice(0, 300) });
    }

    const json: any = await r.json();
    const data: any[] = Array.isArray(json?.data) ? json.data : [];

    const players = data.slice(0, 10).map((p) => ({
      id: String(p.id),
      full_name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      team: p.team?.abbreviation || "",
      position: p.position || "",
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
