// api/bdl/players.ts
// Vercel Serverless Function (Node 18+)

function setCors(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function fullName(p: any) {
  const first = (p?.first_name || "").trim();
  const last = (p?.last_name || "").trim();
  return `${first} ${last}`.trim() || p?.name || "Unknown";
}

export default async function handler(req: any, res: any) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const name = String(req.query?.name || "").trim();
  if (!name) {
    return res.status(400).json({ error: "Missing name query param" });
  }

  try {
    // BallDontLie v1 players search
    const url = `https://www.balldontlie.io/api/v1/players?per_page=100&search=${encodeURIComponent(
      name
    )}`;

    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(502).json({ error: "Upstream error", status: upstream.status });
    }

    const data = await upstream.json();

    const players = (data?.data || []).map((p: any) => ({
      id: String(p.id),
      full_name: fullName(p),
      team: p?.team?.abbreviation || "",
      position: p?.position || "",
    }));

    return res.status(200).json({
      query: name,
      count: players.length,
      players,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Server error", detail: String(err?.message || err) });
  }
}
