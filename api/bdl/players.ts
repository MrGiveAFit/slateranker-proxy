// api/bdl/players.ts
const API_BASE = "https://api.balldontlie.io/v1";

function getApiKey() {
  return process.env.BALLDONTLIE_API_KEY || process.env.BALLDONTLIE_KEY || "";
}

function splitName(full: string) {
  const cleaned = full.trim().replace(/\s+/g, " ");
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length >= 2) {
    return { first_name: parts[0], last_name: parts[parts.length - 1] };
  }
  return { search: cleaned };
}

export default async function handler(req: any, res: any) {
  try {
    const name = String(req.query?.name || "").trim();
    const team = String(req.query?.team || "").trim().toUpperCase();

    if (!name) return res.status(400).json({ error: "Missing name query param" });

    const apiKey = getApiKey();
    if (!apiKey) return res.status(500).json({ error: "Missing BALLDONTLIE_API_KEY in Vercel env" });

    const parts = splitName(name);
    const qs = new URLSearchParams();
    qs.set("per_page", "100");

    if ("first_name" in parts) {
      qs.set("first_name", parts.first_name);
      qs.set("last_name", parts.last_name);
    } else {
      qs.set("search", parts.search);
    }

    const url = `${API_BASE}/players?${qs.toString()}`;

    const upstream = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: apiKey,
      },
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: "Upstream error",
        status: upstream.status,
        upstream: text.slice(0, 800),
      });
    }

    const json = JSON.parse(text);

    const players = (json?.data || []).map((p: any) => ({
      id: String(p.id),
      full_name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      team: p?.team?.abbreviation ? String(p.team.abbreviation).toUpperCase() : undefined,
      position: p?.position ? String(p.position) : undefined,
    }));

    let filtered = players;
    if (team) {
      const matchTeam = players.filter((p: any) => (p.team || "").toUpperCase() === team);
      if (matchTeam.length) filtered = matchTeam;
    }

    return res.status(200).json({
      query: name,
      team: team || undefined,
      count: filtered.length,
      players: filtered,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Server error", message: String(err?.message || err) });
  }
}
