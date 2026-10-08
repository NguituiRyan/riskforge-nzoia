/**
 * Shared protection for the AI endpoints (files starting with "_" are not routes on Vercel).
 * - rate limit per client IP, kept in the Runtime Cache: the AI costs money per call, so one visitor can't drain it
 * - body size cap before parsing
 * Nothing about the request body is logged or stored.
 */
import { getCache } from "@vercel/functions";

const WINDOW_S = 3600;

export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
}

/** null when allowed; otherwise a 429 response saying when to come back */
export async function rateLimit(request: Request, bucket: string, perHour: number): Promise<Response | null> {
  const key = `rl:${bucket}:${clientIp(request)}:${Math.floor(Date.now() / 1000 / WINDOW_S)}`;
  try {
    const cache = getCache({ namespace: "riskforge-guard" });
    const used = Number((await cache.get(key)) ?? 0);
    if (used >= perHour) {
      return Response.json({ error: `Limit reached: ${perHour} AI requests an hour from one address. Try again later.` }, { status: 429 });
    }
    await cache.set(key, used + 1, { ttl: WINDOW_S });
  } catch {
    /* the cache is best-effort: never block a request because the counter is unavailable */
  }
  return null;
}

/** read a JSON body no bigger than maxBytes */
export async function readJson<T>(request: Request, maxBytes: number): Promise<{ body: T } | { error: Response }> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return { error: Response.json({ error: "Request too large" }, { status: 413 }) };
  const raw = await request.text();
  if (raw.length > maxBytes) return { error: Response.json({ error: "Request too large" }, { status: 413 }) };
  try {
    return { body: JSON.parse(raw) as T };
  } catch {
    return { error: Response.json({ error: "Body must be JSON" }, { status: 400 }) };
  }
}
