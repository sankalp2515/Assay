// Structured JSON request logs for production processes.
// Logged: method, path without query string, status, latency, trace id, service.
// Never logged: headers (bearer tokens, cookies), bodies, query strings (PayPal return
// tokens arrive there), media bytes or provider URLs.
export function logOptions(service: string, enabled: boolean) {
  const level = process.env.LOG_LEVEL ?? "info";
  if (!enabled || level === "silent") return false as const;
  return {
    level,
    base: { service },
    redact: {
      paths: ["req.headers", "res.headers", "headers", "authorization", "cookie"],
      remove: true,
    },
    serializers: {
      req: (req: { id?: string; method?: string; url?: string }) => ({
        id: req.id,
        method: req.method,
        path: (req.url ?? "").split("?")[0],
      }),
      res: (res: { statusCode?: number }) => ({ status: res.statusCode }),
    },
  };
}
