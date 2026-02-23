// api/index.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    service: "slateranker-proxy",
    routes: ["/api/bdl/players?name=", "/api/bdl/last10?playerId="],
    timestamp: Date.now(),
  });
}
