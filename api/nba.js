export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { type, q, player_id, last_n = 10 } = req.query;
  const API_KEY = process.env.BALLDONTLIE_API_KEY;

  const headers = {
    Authorization: API_KEY,
  };

  try {
    if (type === "search") {
      const response = await fetch(
        `https://api.balldontlie.io/v1/players?search=${q}`,
        { headers }
      );
      const data = await response.json();
      return res.status(200).json({
        source: "balldontlie",
        fetched_at: new Date().toISOString(),
        data: data.data,
      });
    }

    if (type === "gamelogs") {
      const response = await fetch(
        `https://api.balldontlie.io/v1/stats?player_ids[]=${player_id}&seasons[]=2025&per_page=${last_n}`,
        { headers }
      );
      const data = await response.json();
      return res.status(200).json({
        source: "balldontlie",
        fetched_at: new Date().toISOString(),
        data: data.data,
      });
    }

    return res.status(400).json({ error: "Invalid type" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
