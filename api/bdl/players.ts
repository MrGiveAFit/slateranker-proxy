// /api/bdl/players.ts

export default async function handler(req, res) {
  const { name } = req.query;

  if (!name) {
    return res.status(400).json({ error: "Missing name param" });
  }

  const API_KEY = process.env.BALLDONTLIE_API_KEY;

  try {
    const response = await fetch(
      `https://api.balldontlie.io/v1/players?search=${encodeURIComponent(name)}`,
      {
        headers: {
          Authorization: API_KEY,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Upstream error",
        status: response.status,
        details: data,
      });
    }

    return res.status(200).json({
      query: name,
      count: data.data?.length || 0,
      players: (data.data || []).map((p) => ({
        id: String(p.id),
        full_name: `${p.first_name} ${p.last_name}`,
        team: p.team?.abbreviation,
        position: p.position,
      })),
    });
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: String(err),
    });
  }
}
