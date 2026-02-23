// api/bdl/last10.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

type StatRow = {
  pts: number | null;
  reb: number | null;
  ast: number | null;
  game?: { date?: string };
};

function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function avg(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stdev(nums: number[]) {
  if (nums.length < 2) return 0;
  const m = avg(nums);
  const variance = avg(nums.map((x) => (x - m) ** 2));
  return Math.sqrt(variance);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const playerId = String(req.query.playerId ?? "").trim();
    const n = Math.min(Math.max(toNum(req.query.n ?? 10), 1), 25);

    if (!playerId) {
      return res.status(400).json({ error: "Missing ?playerId=" });
    }

    const apiKey = process.env.BALLDONTLIE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing BALLDONTLIE_API_KEY env var" });
    }

    // BDL v1 "stats" endpoint (most common). We try with sort param first; if it fails, retry without it.
    const base = "https://api.balldontlie.io/v1/stats";
    const urlWithSort = `${base}?player_ids[]=${encodeURIComponent(playerId)}&per_page=${n}&sort=-game.date`;
    const urlNoSort = `${base}?player_ids[]=${encodeURIComponent(playerId)}&per_page=${n}`;

    const doFetch = async (url: string) => {
      const r = await fetch(url, {
        headers: {
          // BDL commonly uses Authorization: <key>
          Authorization: apiKey,
          // Some APIs accept x-api-key; harmless to include
          "x-api-key": apiKey,
        },
      });
      const text = await r.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
      return { ok: r.ok, status: r.status, json };
    };

    let out = await doFetch(urlWithSort);
    if (!out.ok) out = await doFetch(urlNoSort);

    if (!out.ok) {
      return res.status(out.status).json({
        error: "BDL request failed",
        status: out.status,
        details: out.json,
      });
    }

    const rows: StatRow[] = Array.isArray(out.json?.data) ? out.json.data : [];
    const games = rows.slice(0, n).map((r) => ({
      date: r.game?.date ?? null,
      pts: toNum(r.pts),
      reb: toNum(r.reb),
      ast: toNum(r.ast),
    }));

    const ptsArr = games.map((g) => g.pts);
    const rebArr = games.map((g) => g.reb);
    const astArr = games.map((g) => g.ast);

    const averages = {
      pts: Number(avg(ptsArr).toFixed(1)),
      reb: Number(avg(rebArr).toFixed(1)),
      ast: Number(avg(astArr).toFixed(1)),
      gamesAnalyzed: games.length,
    };

    const volatility = {
      pts: Number(stdev(ptsArr).toFixed(2)),
      reb: Number(stdev(rebArr).toFixed(2)),
      ast: Number(stdev(astArr).toFixed(2)),
    };

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ playerId, averages, volatility, games });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Unknown error" });
  }
}
