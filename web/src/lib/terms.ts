/**
 * Financial engine terms (problem statement, Step 4): from ground-up damage to what each party pays.
 *
 *   ground-up loss       physical damage before any insurance rules
 *   - deductible         the owner's share of each risk's loss, per event
 *   - above the limit    what exceeds the most the policy pays for one risk
 *   = gross loss         the insurer's (cedant's) loss
 *   - quota share        the reinsurer's agreed % of every gross loss
 *   - cat excess of loss the reinsurer pays the cedant's retained event loss above an attachment, up to a limit
 *   = net loss           what stays with the cedant
 *
 * A "risk" is a policy: one building in the synthetic books, a whole site for a document-ingested offer (b.policy),
 * which can carry its own deductible and limit (b.ded, b.lim). Weights apply as everywhere else.
 */
import type { BuildingProps, RP } from "./types";
import { RPS } from "./types";
import { aal, buildingAt, KEY_RPS, valueOf, weightOf } from "./engine";

export interface Programme {
  /** KES per risk per event */
  deductible: number;
  /** KES per risk per event; 0 = up to the sum insured */
  limit: number;
  /** reinsurer's quota share of the gross loss, 0-1 */
  qs: number;
  /** cat XL on the cedant's retained event loss: attachment and limit in KES; limit 0 = no XL */
  xlAttach: number;
  xlLimit: number;
}

/** the books' default programme: per-building deductible, 25% quota share, a cat XL above the 1-in-10 retained loss */
export const BOOK_PROGRAMME: Programme = { deductible: 25_000, limit: 0, qs: 0.25, xlAttach: 4_000_000, xlLimit: 4_000_000 };

export interface Layers {
  rp: number;
  gu: number;
  /** deductibles plus anything above the policy limits: stays with the owners */
  owner: number;
  gross: number;
  qs: number;
  retained: number;
  xl: number;
  net: number;
  /** quota share + cat XL */
  reinsurer: number;
}

export function layersAt(buildings: BuildingProps[], rp: number, p: Programme): Layers {
  const risks = new Map<string, { gu: number; w: number; ded: number; lim: number }>();
  for (const b of buildings) {
    const w = weightOf(b);
    if (w <= 0) continue;
    const key = String(b.policy ?? b.id);
    const r = risks.get(key) ?? { gu: 0, w, ded: typeof b.ded === "number" ? b.ded : p.deductible, lim: typeof b.lim === "number" ? b.lim : p.limit };
    r.gu += buildingAt(b, rp).loss;
    risks.set(key, r);
  }
  let gu = 0;
  let gross = 0;
  for (const r of risks.values()) {
    gu += r.gu * r.w;
    gross += Math.min(Math.max(r.gu - r.ded, 0), r.lim > 0 ? r.lim : Infinity) * r.w;
  }
  const qs = gross * p.qs;
  const retained = gross - qs;
  const xl = p.xlLimit > 0 ? Math.min(Math.max(retained - p.xlAttach, 0), p.xlLimit) : 0;
  return { rp, gu, owner: gu - gross, gross, qs, retained, xl, net: retained - xl, reinsurer: qs + xl };
}

export interface ProgrammeResult {
  byRp: Record<number, Layers>;
  aal: { gu: number; gross: number; reinsurer: number; net: number };
  /** technical premium for the reinsurer's share: AAL + 10% cost of capital on (1-in-200 - AAL), 15% expenses */
  reinsurerPremium: number;
  value: number;
}

export function runProgramme(buildings: BuildingProps[], p: Programme): ProgrammeResult {
  const byRp: Record<number, Layers> = {};
  for (const r of KEY_RPS) byRp[r] = layersAt(buildings, r, p);
  const curve = (k: keyof Layers) => Object.fromEntries(RPS.map((r) => [r, byRp[r][k]])) as Record<RP, number>;
  const a = { gu: aal(curve("gu")), gross: aal(curve("gross")), reinsurer: aal(curve("reinsurer")), net: aal(curve("net")) };
  const risk = a.reinsurer + 0.1 * Math.max(byRp[200].reinsurer - a.reinsurer, 0);
  const value = buildings.reduce((s, b) => s + valueOf(b) * Math.max(weightOf(b), 0), 0);
  return { byRp, aal: a, reinsurerPremium: risk / 0.85, value };
}
