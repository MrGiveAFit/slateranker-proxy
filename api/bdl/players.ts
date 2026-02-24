import type { VercelRequest, VercelResponse } from "@vercel/node";

const BDL_BASE = "https://www.balldontlie.io/api/v1";

async function searchPlayers(query: string) {
  const res = await fetch(`${BDL_BASE}/players?search=${encodeURIComponent(query)}&per_page=25`);
  if (!res.ok) {
    throw new Error(`BDL error ${res.status}`);
  }
  const json = await res.json();
  return json?.data || [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const name = String(req.query.name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "Missing name parameter" });
    }

    // 1️⃣ Try full name first
    let players = await searchPlayers(name);

    // 2️⃣ If nothing found, try splitting
    if (!players.length && name.includes(" ")) {
      const parts = name.split(" ");
      const lastName = parts[parts.length - 1];
      players = await searchPlayers(lastName);
    }

    // 3️⃣ Still nothing? Try first name
    if (!players.length && name.includes(" ")) {
      const firstName = name.split(" ")[0];
      players = await searchPlayers(firstName);
    }

    return res.status(200).json({
      query: name,
      count: players.length,
      players: players.map((p: any) => ({
        id: String(p.id),
        full_name: `${p.first_name} ${p.last_name}`,
        team: p.team?.abbreviation,
        position: p.position
      }))
    });

  } catch (err: any) {
    return res.status(500).json({
      error: err.message || "Unknown error"
    });
  }
}
