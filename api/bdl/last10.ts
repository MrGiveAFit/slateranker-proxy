// api/bdl/last10.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

type StatRow = {
  pts?: number;
  reb?: number;
  ast?: number;
  // balldontlie sometimes uses these:
  game?: { date?: string; datetime?: string };
  game_id?: number;
  // fallback fields we might see in some payloads
  date?: string;
  min?: string;
};

function isNumber(x: any): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function toISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// NBA "season" in balldontlie v1 is the season start year
// Example: 2024-10-22 is season 2024.
function currentSeasonStartYear(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-12
  return m >= 10 ? y : y - 1;
}

function mean(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stddev(nums: number[]) {
  if (nums.length <= 1) return 0;
  const m = mean(nums);
  const v = nums.reduce((acc, n) => acc + (n - m) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(v);
}

function pickDate(s: any): string {
  // Try common shapes
  const d =
    s?.game?.date ||
    s?.game?.datetime ||
    s?.date ||
    null;

  if (!d) return "";
  // If datetime, keep YYYY-MM-DD
  if (typeof d === "string" && d.includes("T")) return d.slice(0, 10);
  return String(d);
}

async function bdlFetch(url: string) {
  const apiKey = process.env.BDL_API_KEY;
  if (!apiKey) {
    throw new Error("Missing BDL_API_KEY env var on Vercel");
  }

  const res = await fetch(url, {
    headers: {
      Authorization: apiKey,
    },
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keep null
  }

  if (!res.ok) {
    const msg =
      json?.error ||
      json?.message ||
      `BDL request failed (${res.status})`;
    const err = new Error(msg);
    (err as any).status = res.status;
    (err as any).payload = json ?? text;
    throw err;
  }

  return json;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const playerId = req.query.playerId;
    if (!playerId) {
      return res.status(400).json({ error: "Missing playerId query param" });
    }

    const pid = String(playerId);

    // We’ll pull enough rows to safely find 10 *recent* games.
    // Use current season and a date window to avoid ancient junk.
    const season = currentSeasonStartYear(new Date());

    // Look back ~140 days (covers most of the “last 10 games” idea even with breaks)
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 140);

    const startDate = toISODate(start);
    const endDate = toISODate(end);

    // Cursor pagination (max per_page = 100)
    // Stats endpoint expects arrays: player_ids[]=X, seasons[]=YYYY
    let cursor: string | number | undefined = undefined;
    const collected: StatRow[] = [];

    // Hard stop to avoid runaway loops
    for (let i = 0; i < 6; i++) {
      const params = new URLSearchParams();
      params.set("per_page", "100");
      params.append("player_ids[]", pid);
      params.append("seasons[]", String(season));
      params.set("start_date", startDate);
      params.set("end_date", endDate);
      // period=0 full game stats (docs: 0 default, but we’ll be explicit)
      params.set("period", "0");
      if (cursor != null) params.set("cursor", String(cursor));

      const url = `https://api.balldontlie.io/v1/stats?${params.toString()}`;
      const json = await bdlFetch(url);

      const rows: StatRow[] = Array.isArray(json?.data) ? json.data : [];
      collected.push(...rows);

      const next = json?.meta?.next_cursor;
      if (!next) break;
      cursor = next;

      // If we already have plenty, stop early
      if (collected.length >= 250) break;
    }

    // Sort newest first by date if we can read it
    const withDates = collected
      .map((s) => ({ s, date: pickDate(s) }))
      .filter((x) => x.date); // keep ones with dates

    withDates.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    // Take last 10 games with valid box score numbers
    const last10 = withDates
      .map((x) => x.s)
      .filter((s) => isNumber(s.pts) && isNumber(s.reb) && isNumber(s.ast))
      .slice(0, 10);

    const ptsArr = last10.map((g) => Number(g.pts));
    const rebArr = last10.map((g) => Number(g.reb));
    const astArr = last10.map((g) => Number(g.ast));

    const games = last10.map((g) => ({
      date: pickDate(g),
      pts: Number(g.pts ?? 0),
      reb: Number(g.reb ?? 0),
      ast: Number(g.ast ?? 0),
    }));

    return res.status(200).json({
      playerId: pid,
      averages: {
        pts: Number(mean(ptsArr).toFixed(2)),
        reb: Number(mean(rebArr).toFixed(2)),
        ast: Number(mean(astArr).toFixed(2)),
        gamesAnalyzed: last10.length,
      },
      volatility: {
        pts: Number(stddev(ptsArr).toFixed(2)),
        reb: Number(stddev(rebArr).toFixed(2)),
        ast: Number(stddev(astArr).toFixed(2)),
      },
      games,
      meta: {
        season,
        startDate,
        endDate,
        totalRowsFetched: collected.length,
      },
    });
  } catch (e: any) {
    const status = e?.status && Number.isFinite(e.status) ? e.status : 500;
    return res.status(status).json({
      error: e?.message || "Unknown error",
      details: e?.payload || null,
    });
  }
}
