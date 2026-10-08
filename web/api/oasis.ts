/**
 * /api/oasis - relay between the web app and the Oasis LMF runner (oasis/server.py).
 * Oasis needs a Linux worker (~740 MB installed), so it runs outside Vercel: on the Risk Forge laptop behind a free
 * Cloudflare tunnel (oasis/start_public.sh). The worker registers its current address here; visitors' runs are
 * forwarded to it with a shared secret, so the browser never talks to the worker directly.
 *
 *   GET  /api/oasis                         {online, oasislmf?, busy?}
 *   POST /api/oasis  {register: url}        worker heartbeat (header x-relay-secret)
 *   POST /api/oasis  {name, buildings, programme}   run on Oasis (rate-limited per visitor)
 */
import { timingSafeEqual } from "node:crypto";
import { getCache } from "@vercel/functions";
import { rateLimit, readJson } from "./_guard.js";

const store = () => getCache({ namespace: "riskforge-oasis" });
const KEY = "runner";
const TTL_S = 30 * 60; // the worker re-registers every few minutes; an address older than this is treated as gone

function secretOk(request: Request): boolean {
  const want = process.env.OASIS_RELAY_SECRET ?? "";
  const got = request.headers.get("x-relay-secret") ?? "";
  if (!want || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

async function runnerUrl(): Promise<string | null> {
  try {
    const v = (await store().get(KEY)) as { url?: string } | undefined;
    if (v?.url) return v.url;
  } catch {
    /* fall through to the configured address */
  }
  return process.env.OASIS_RUNNER_URL || null; // e.g. http://localhost:8765 in local development
}

const offline = () =>
  Response.json({ error: "The Oasis runner is offline right now. The figures shown are the precomputed Oasis run and the instant preview." }, { status: 503 });

export async function GET(): Promise<Response> {
  const url = await runnerUrl();
  if (!url) return Response.json({ online: false });
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    const h = (await r.json()) as { oasislmf?: string; busy?: boolean };
    return Response.json({ online: r.ok, oasislmf: h.oasislmf, busy: h.busy }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ online: false }, { headers: { "cache-control": "no-store" } });
  }
}

export async function POST(request: Request): Promise<Response> {
  const parsed = await readJson<{ register?: unknown; buildings?: unknown }>(request, 4_000_000);
  if ("error" in parsed) return parsed.error;
  const body = parsed.body;

  // worker heartbeat
  if (body.register !== undefined) {
    if (!secretOk(request)) return Response.json({ error: "forbidden" }, { status: 403 });
    const url = typeof body.register === "string" ? body.register.replace(/\/+$/, "") : "";
    if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$|^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
      return Response.json({ error: "unexpected runner address" }, { status: 400 });
    }
    await store().set(KEY, { url, at: Date.now() }, { ttl: TTL_S });
    return Response.json({ ok: true });
  }

  // a visitor's run
  const limited = await rateLimit(request, "oasis", 20);
  if (limited) return limited;
  const url = await runnerUrl();
  if (!url) return offline();
  try {
    const r = await fetch(`${url}/run`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-relay-secret": process.env.OASIS_RELAY_SECRET ?? "" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(280_000),
    });
    if (!(r.headers.get("content-type") ?? "").includes("json")) return offline(); // the tunnel is up but the worker is not
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (e) {
    if ((e as Error).name === "TimeoutError") return Response.json({ error: "Oasis took longer than expected; try a smaller portfolio." }, { status: 504 });
    return offline();
  }
}
