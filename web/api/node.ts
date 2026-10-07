/**
 * POST /api/node  - device endpoint for the Risk Forge river node (ESP32, see hardware/).
 *
 * The node posts a signed reading; we verify the HMAC-SHA256 signature and the timestamp, convert the level to
 * river stage and return period, and send back the alert level and the LED colour the node should show.
 * Forged or replayed readings are rejected - if a reading can trigger a payout, tampering is fraud.
 *
 * Body: { node, seq, ts (unix s), level_cm, sig }   sig = hex(HMAC_SHA256(NODE_SECRET, `${node}|${seq}|${ts}|${level_cm to 1 dp}`))
 * This prototype keeps no history (stateless); production stores readings in a Kenyan-hosted database.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const STAGE_PER_CM = 0.3; // demo tank: 1 cm of water = 0.3 m of river stage at Rwambwa (ASSUMPTION, display scale)
const MAX_SKEW_S = 300;
// stage (m) -> return period (years); ASSUMPTION anchored on the 2.8 m Rwambwa alert level. Mirrors river_node.json.
const STAGE_TABLE: [number, number][] = [[2.8, 2], [3.5, 5], [4.2, 10], [4.8, 20], [5.5, 50], [6.0, 100], [6.4, 200], [7.0, 500]];
const ALERTS: [number, string, string][] = [[5.5, "Danger", "red"], [4.2, "Warning", "red"], [2.8, "Alert", "amber"], [0, "Normal", "green"]];

function rpForStage(stage: number): number | null {
  if (stage < STAGE_TABLE[0][0]) return null;
  for (let i = 1; i < STAGE_TABLE.length; i++) {
    const [s1, r1] = STAGE_TABLE[i];
    const [s0, r0] = STAGE_TABLE[i - 1];
    if (stage <= s1) return Math.exp(Math.log(r0) + ((Math.log(r1) - Math.log(r0)) * (stage - s0)) / (s1 - s0));
  }
  return 500;
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
    return Response.json({ ok: false, verified: false, error: "Bad signature - reading rejected" }, { status: 401 });
  }
  if (Math.abs(Date.now() / 1000 - r.ts) > MAX_SKEW_S) {
    return Response.json({ ok: false, verified: true, error: "Stale timestamp - possible replay, reading rejected" }, { status: 409 });
  }
  const stage = Math.max(r.level_cm, 0) * STAGE_PER_CM;
  const rp = rpForStage(stage);
  const [, alert, led] = ALERTS.find(([min]) => stage >= min) ?? ALERTS[ALERTS.length - 1];
  return Response.json({ ok: true, verified: true, node: r.node, seq: r.seq, stage_m: Math.round(stage * 100) / 100, return_period: rp && Math.round(rp * 10) / 10, alert, led });
}

export function GET(): Response {
  return Response.json({ endpoint: "Risk Forge river node", method: "POST", body: "{ node, seq, ts, level_cm, sig }", signature: "hex HMAC-SHA256 of `${node}|${seq}|${ts}|${level_cm with one decimal}` with the shared NODE_SECRET" });
}
