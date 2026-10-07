/**
 * /api/node - device endpoint for the Risk Forge river node (ESP32, see hardware/).
 *
 * POST: the node sends a signed reading. We verify the HMAC-SHA256 signature, the timestamp and the order, convert
 * the level to river stage and return period, keep it as the node's latest state, and send back the alert level and
 * LED colour. Forged or replayed readings are rejected (and counted) - if a reading can trigger a payout, tampering is fraud.
 *   Body: { node, seq, ts (unix s), level_cm, sig }   sig = hex(HMAC_SHA256(NODE_SECRET, `${node}|${seq}|${ts}|${level_cm to 1 dp}`))
 *
 * GET ?node=RF-NZ-01: the node's live state for the dashboard (latest verified reading, recent history, rejected count).
 *
 * State lives in Vercel's Runtime Cache (regional, ephemeral, hours) - enough for a live demo; production keeps the
 * full record in a Kenyan-hosted database.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { getCache } from "@vercel/functions";

const STAGE_PER_CM = 0.3; // demo tank: 1 cm of water = 0.3 m of river stage at Rwambwa (ASSUMPTION, display scale)
const MAX_SKEW_S = 300;
const HISTORY = 120; // readings kept for the dashboard trace (6 minutes at one every 3 s)
const STATE_TTL_S = 6 * 3600;
// stage (m) -> return period (years); ASSUMPTION anchored on the 2.8 m Rwambwa alert level. Mirrors river_node.json.
const STAGE_TABLE: [number, number][] = [[2.8, 2], [3.5, 5], [4.2, 10], [4.8, 20], [5.5, 50], [6.0, 100], [6.4, 200], [7.0, 500]];
const ALERTS: [number, string, string][] = [[5.5, "Danger", "red"], [4.2, "Warning", "red"], [2.8, "Alert", "amber"], [0, "Normal", "green"]];

interface Reading {
  node: string;
  seq: number;
  ts: number;
  level_cm: number;
  stage_m: number;
  return_period: number | null;
  alert: string;
  led: string;
  received: number; // server time, ms
}
interface NodeState {
  latest: Reading | null;
  history: [number, number][]; // [received ms, level_cm]
  rejected: number;
  lastRejected: { at: number; reason: string } | null;
}

function rpForStage(stage: number): number | null {
  if (stage < STAGE_TABLE[0][0]) return null;
  for (let i = 1; i < STAGE_TABLE.length; i++) {
    const [s1, r1] = STAGE_TABLE[i];
    const [s0, r0] = STAGE_TABLE[i - 1];
    if (stage <= s1) return Math.exp(Math.log(r0) + ((Math.log(r1) - Math.log(r0)) * (stage - s0)) / (s1 - s0));
  }
  return 500;
}

const store = () => getCache({ namespace: "riskforge-node" });
const keyFor = (node: string) => `state:${node.slice(0, 32)}`;

async function load(node: string): Promise<NodeState> {
  const s = (await store().get(keyFor(node))) as NodeState | undefined | null;
  return s ?? { latest: null, history: [], rejected: 0, lastRejected: null };
}
async function save(node: string, s: NodeState) {
  await store().set(keyFor(node), s, { ttl: STATE_TTL_S });
}

/** count a rejected reading against the node it claims to be, so the dashboard can show attempted tampering */
async function reject(node: unknown, status: number, error: string, verified: boolean): Promise<Response> {
  if (typeof node === "string" && node) {
    try {
      const s = await load(node);
      s.rejected += 1;
      s.lastRejected = { at: Date.now(), reason: error };
      await save(node, s);
    } catch {
      /* the cache is best-effort; the rejection itself still stands */
    }
  }
  return Response.json({ ok: false, verified, error }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.NODE_SECRET;
  if (!secret) return Response.json({ ok: false, error: "NODE_SECRET not configured" }, { status: 503 });
  let r: { node?: unknown; seq?: unknown; ts?: unknown; level_cm?: unknown; sig?: unknown };
  try {
    r = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  if (typeof r.node !== "string" || typeof r.seq !== "number" || typeof r.ts !== "number" || typeof r.level_cm !== "number" || typeof r.sig !== "string") {
    return Response.json({ ok: false, error: "Expected { node, seq, ts, level_cm, sig }" }, { status: 400 });
  }
  // canonical message: level always with one decimal, so "9.0" on the ESP32 and 9 in JSON sign the same way
  const expected = createHmac("sha256", secret).update(`${r.node}|${r.seq}|${r.ts}|${r.level_cm.toFixed(1)}`).digest();
  const given = Buffer.from(r.sig, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return reject(r.node, 401, "Bad signature - reading rejected", false);
  }
  if (Math.abs(Date.now() / 1000 - r.ts) > MAX_SKEW_S) {
    return reject(r.node, 409, "Stale timestamp - possible replay, reading rejected", true);
  }
  const state = await load(r.node);
  const last = state.latest;
  // a copy of an earlier genuine reading carries a valid signature: refuse anything not newer than the last one accepted
  if (last && (r.ts < last.ts || (r.ts === last.ts && r.seq <= last.seq))) {
    return reject(r.node, 409, "Older than the last accepted reading - possible replay, rejected", true);
  }

  const stage = Math.max(r.level_cm, 0) * STAGE_PER_CM;
  const rp = rpForStage(stage);
  const [, alert, led] = ALERTS.find(([min]) => stage >= min) ?? ALERTS[ALERTS.length - 1];
  const reading: Reading = {
    node: r.node,
    seq: r.seq,
    ts: r.ts,
    level_cm: Math.round(r.level_cm * 10) / 10,
    stage_m: Math.round(stage * 100) / 100,
    return_period: rp && Math.round(rp * 10) / 10,
    alert,
    led,
    received: Date.now(),
  };
  state.latest = reading;
  state.history = [...state.history, [reading.received, reading.level_cm] as [number, number]].slice(-HISTORY);
  let stored = true;
  try {
    await save(r.node, state);
  } catch {
    stored = false; // the node still gets its verdict and LED colour
  }
  return Response.json({ ok: true, verified: true, stored, ...reading });
}

export async function GET(request: Request): Promise<Response> {
  const node = new URL(request.url).searchParams.get("node");
  if (!node) {
    return Response.json({
      endpoint: "Risk Forge river node",
      post: "{ node, seq, ts, level_cm, sig }",
      signature: "hex HMAC-SHA256 of `${node}|${seq}|${ts}|${level_cm with one decimal}` with the shared NODE_SECRET",
      live_state: "GET /api/node?node=RF-NZ-01",
    });
  }
  const s = await load(node);
  const now = Date.now();
  return Response.json(
    {
      node,
      now,
      age_s: s.latest ? Math.round((now - s.latest.received) / 100) / 10 : null,
      latest: s.latest,
      history: s.history,
      rejected: s.rejected,
      last_rejected: s.lastRejected,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
