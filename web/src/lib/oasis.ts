/**
 * The financial (loss) calculation on Oasis LMF (oasis/riskforge_oasis.py, oasis/server.py).
 * Oasis needs a Linux worker (its install is ~740 MB, too big for a web function). The browser sends the portfolio to
 * the site's own /api/oasis relay, which forwards it to the worker (oasis/start_public.sh keeps it registered).
 * The book's Oasis results are precomputed and ship with the site (/data/oasis_book.json); other portfolios run when
 * someone presses "Run on Oasis LMF".
 */
import type { BuildingProps } from "./types";
import { RPS } from "./types";
import type { Programme, ProgrammeResult } from "./terms";

export interface OasisLayers {
  gu: number;
  owner: number;
  gross: number;
  reinsurer: number;
  net: number;
}

export interface OasisResult {
  engine: string;
  model: string;
  seconds: number;
  portfolio?: string;
  programme?: Programme;
  run: { locations: number; accounts: number; areaPerils: number; vulnerabilities: number; events: number; periods: number; footprintRows: number; reinsurance: string[] };
  aal: { gu: number; gross: number; reinsurer: number; net: number };
  byRp: Record<string, OasisLayers>;
  perLocationAal: Record<string, number>;
}

/** a runner called directly (VITE_OASIS_URL); by default the site's relay is used */
export const OASIS_URL: string = (import.meta.env.VITE_OASIS_URL as string | undefined) || "";
const RUN_URL = OASIS_URL ? `${OASIS_URL}/run` : "/api/oasis";

/** is a runner reachable right now (through the relay)? */
export async function oasisStatus(): Promise<{ online: boolean; oasislmf?: string; busy?: boolean }> {
  try {
    const r = await fetch(OASIS_URL ? `${OASIS_URL}/health` : "/api/oasis", { signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { online?: boolean; ok?: boolean; oasislmf?: string; busy?: boolean };
    return { online: !!(j.online ?? j.ok), oasislmf: j.oasislmf, busy: j.busy };
  } catch {
    return { online: false };
  }
}

const FIELDS = ["id", "cls", "tiv", "lat", "lon", "floor", "cs", "cm", "co", "cal", "w", "policy", "ded", "lim", ...RPS.map((r) => `d${r}`)];

/** only what the Oasis model reads */
function slim(b: BuildingProps) {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) if (b[k] !== undefined) out[k] = b[k];
  return out;
}

export async function runOasis(name: string, buildings: BuildingProps[], programme: Programme, signal?: AbortSignal): Promise<OasisResult> {
  let res: Response;
  try {
    res = await fetch(RUN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, buildings: buildings.map(slim), programme }),
      signal,
    });
  } catch {
    throw new Error("Could not reach Oasis. Check the connection and try again.");
  }
  // a tunnel or proxy in trouble answers with an HTML error page instead of JSON
  if (!(res.headers.get("content-type") ?? "").includes("json"))
    throw new Error(`Oasis answered unexpectedly (HTTP ${res.status}). Try again in a minute.`);
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as OasisResult;
}

let bookOnce: Promise<OasisResult | null> | null = null;
/** the book's precomputed Oasis run (null if it was not shipped) */
export function loadOasisBook(): Promise<OasisResult | null> {
  bookOnce ??= fetch("/data/oasis_book.json")
    .then((r) => (r.ok ? (r.json() as Promise<OasisResult>) : null))
    .catch(() => null);
  return bookOnce;
}

/** same terms? (a precomputed run only stands for the programme it was run with) */
export const sameProgramme = (a?: Programme, b?: Programme) =>
  !!a && !!b && (["deductible", "limit", "qs", "xlAttach", "xlLimit"] as const).every((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 1e-6);

/** Oasis vs the in-browser engine, as a signed share of the Oasis figure */
export function gap(oasis: number, engine: number) {
  if (oasis === 0 && engine === 0) return 0;
  return (engine - oasis) / Math.max(Math.abs(oasis), 1);
}

export type { ProgrammeResult };
