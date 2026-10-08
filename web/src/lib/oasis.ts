/**
 * The financial (loss) calculation on Oasis LMF (oasis/riskforge_oasis.py, oasis/server.py).
 * Oasis needs a Linux worker (its install is ~740 MB, too big for a web function), so the browser sends the
 * portfolio to the runner and shows what Oasis returns. The book's Oasis results are precomputed and ship with the
 * site (/data/oasis_book.json); other portfolios run when someone presses "Run on Oasis LMF".
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

/** where the runner listens: VITE_OASIS_URL, else this machine (WSL forwards localhost) */
export const OASIS_URL: string = (import.meta.env.VITE_OASIS_URL as string | undefined) || "http://localhost:8765";

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
    res = await fetch(`${OASIS_URL}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, buildings: buildings.map(slim), programme }),
      signal,
    });
  } catch {
    throw new Error(`No Oasis runner at ${OASIS_URL}. Start it on the Linux worker: python oasis/server.py`);
  }
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
