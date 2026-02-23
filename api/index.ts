// api/index.ts
export default function handler(_req: any, res: any) {
  res.status(200).json({
    ok: true,
    service: "slateranker-proxy",
    routes: ["/api/bdl/players?name=", "/api/bdl/last10?playerId="],
    timestamp: Date.now(),
  });
}
