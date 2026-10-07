/**
 * Risk Forge financial engine (browser). Mirrors scripts/prepare_3d_data.py so the numbers can be checked against it.
 *
 * Step 1 hazard:        depth per building at each JRC return period (attached by the prep script, or looked up
 *                       from the flood grid for AI-added rows)
 * Step 2 vulnerability: DR = cap x Huizinga-Africa(k x depth), k and cap per housing class
 * Step 4 financial:     loss = DR x insured value; portfolio loss per return period; EP curve; AAL; PML
 */
import type { BuildingProps, HousingClass, RP } from "./types";
import { CLASSES, RPS } from "./types";

export const ONSET_RP = 2; // ASSUMPTION: losses start at the 1-in-2 flood (bankfull); dykes not modelled
export const SEVERITY_REF_M = 4; // depth that scores 1.0 on the 0-1 severity scale

/** Huizinga et al. (2017), JRC global depth-damage functions, Africa residential (depth m -> damage fraction) */
export const HUIZINGA_AFRICA: [number, number][] = [
  [0, 0], [0.5, 0.22], [1, 0.378], [1.5, 0.531], [2, 0.636], [3, 0.817], [4, 0.903], [5, 0.957], [6, 1.0],
];

/** class adaptation (after Englhardt et al. 2019): k scales depth, cap is the damage ceiling */
export const CURVES: Record<HousingClass, { k: number; cap: number; why: string }> = {
  informal_iron_sheet: { k: 1.6, cap: 0.95, why: "Light iron-sheet and mud walls fail at shallow depth; Englhardt's mud/wood class reaches total loss by ~2.5 m." },
  semi_permanent: { k: 1.25, cap: 0.9, why: "Between informal and masonry: timber or mud-block walls on a better floor slab." },
  permanent_masonry: { k: 1.0, cap: 0.85, why: "The Huizinga Africa residential curve as published, capped at 85% because foundations and land survive." },
  concrete_rcc: { k: 0.8, cap: 0.75, why: "Reinforced concrete resists more water; Englhardt's RC class plateaus near 65%, the brief asks for 80-95%, we use 75%." },
};

function interp(x: number, pts: [number, number][]): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x0, y0] = pts[i - 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}

export function damageRatio(cls: HousingClass, depth: number): number {
  const c = CURVES[cls];
  return depth > 0 ? c.cap * interp(depth * c.k, HUIZINGA_AFRICA) : 0;
}

export const severity = (depth: number) => Math.min(Math.max(depth, 0) / SEVERITY_REF_M, 1);

export function depthsOf(b: BuildingProps): Record<RP, number> {
  return Object.fromEntries(RPS.map((r) => [r, Number(b[`d${r}`]) || 0])) as Record<RP, number>;
}

/** depth at any return period: linear in log(RP) between the JRC maps; below 1-in-10 scaled to 0 at the onset */
export function depthAtRp(d: Record<RP, number>, rp: number): number {
  if (rp <= ONSET_RP) return 0;
  if (rp < RPS[0]) return (d[RPS[0]] * Math.log(rp / ONSET_RP)) / Math.log(RPS[0] / ONSET_RP);
  if (rp >= RPS[RPS.length - 1]) return d[RPS[RPS.length - 1]];
  for (let i = 0; i < RPS.length - 1; i++) {
    const a = RPS[i];
    const b = RPS[i + 1];
    if (rp >= a && rp <= b) return d[a] + (d[b] - d[a]) * (Math.log(rp / a) / Math.log(b / a));
  }
  return d[RPS[RPS.length - 1]];
}

export interface BuildingResult {
  b: BuildingProps;
  depth: number;
  dr: number;
  loss: number;
}

export function buildingAt(b: BuildingProps, rp: number): BuildingResult {
  const depth = depthAtRp(depthsOf(b), rp);
  const dr = damageRatio(b.cls, depth);
  return { b, depth, dr, loss: dr * b.tiv };
}

export interface ScenarioResult {
  rp: number;
  loss: number;
  wet: number;
  tivWet: number;
  byClass: Record<HousingClass, { loss: number; wet: number }>;
}

export function scenario(buildings: BuildingProps[], rp: number): ScenarioResult {
  const byClass = Object.fromEntries(CLASSES.map((c) => [c, { loss: 0, wet: 0 }])) as ScenarioResult["byClass"];
  let loss = 0;
  let wet = 0;
  let tivWet = 0;
  for (const b of buildings) {
    const r = buildingAt(b, rp);
    loss += r.loss;
    byClass[b.cls].loss += r.loss;
    if (r.depth > 0) {
      wet++;
      tivWet += b.tiv;
      byClass[b.cls].wet++;
    }
  }
  return { rp, loss, wet, tivWet, byClass };
}

/** area under the EP curve: trapezoid in annual exceedance probability, onset at zero, flat tail past 1-in-500 */
export function aal(lossByRp: Record<RP, number>, onset = ONSET_RP): number {
  const pts: [number, number][] = [[1 / onset, 0], ...RPS.map((r): [number, number] => [1 / r, lossByRp[r]])];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += ((pts[i - 1][0] - pts[i][0]) * (pts[i - 1][1] + pts[i][1])) / 2;
  return total + lossByRp[RPS[RPS.length - 1]] / RPS[RPS.length - 1];
}

export const KEY_RPS = [10, 20, 50, 100, 200, 250, 500] as const;

export interface PortfolioResult {
  count: number;
  tiv: number;
  byClass: Record<HousingClass, { count: number; tiv: number; aal: number }>;
  scenarios: Record<number, ScenarioResult>; // the six JRC maps plus 1-in-250
  aal: number;
  perBuildingAal: Map<string, number>;
}

export function runPortfolio(buildings: BuildingProps[]): PortfolioResult {
  const scenarios: Record<number, ScenarioResult> = {};
  for (const r of KEY_RPS) scenarios[r] = scenario(buildings, r);
  const lossByRp = Object.fromEntries(RPS.map((r) => [r, scenarios[r].loss])) as Record<RP, number>;
  const perBuildingAal = new Map<string, number>();
  const byClass = Object.fromEntries(CLASSES.map((c) => [c, { count: 0, tiv: 0, aal: 0 }])) as PortfolioResult["byClass"];
  let tiv = 0;
  for (const b of buildings) {
    const own = Object.fromEntries(RPS.map((r) => [r, buildingAt(b, r).loss])) as Record<RP, number>;
    const a = aal(own);
    perBuildingAal.set(b.id, a);
    byClass[b.cls].count++;
    byClass[b.cls].tiv += b.tiv;
    byClass[b.cls].aal += a;
    tiv += b.tiv;
  }
  return { count: buildings.length, tiv, byClass, scenarios, aal: aal(lossByRp), perBuildingAal };
}

/** illustrative technical premium: AAL + cost of capital x (1-in-200 loss - AAL), plus an expense load */
export function technicalPremium(p: PortfolioResult, costOfCapital = 0.1, expenseLoad = 0.15) {
  const risk = p.aal + costOfCapital * Math.max(p.scenarios[200].loss - p.aal, 0);
  return { risk, gross: risk / (1 - expenseLoad), rateOnTiv: risk / (1 - expenseLoad) / Math.max(p.tiv, 1) };
}

// ---------- hazard lookup for new locations (AI-ingested rows) ----------
export interface FloodGrid {
  x0: number;
  y0: number;
  d: number;
  cells: Map<string, Record<RP, number>>;
}

export function buildFloodGrid(fc: { features: { properties: Record<string, number>; geometry: { coordinates: number[][][] } }[] }): FloodGrid {
  const x0 = 33.7;
  const y0 = 1.3;
  const d = 1 / 120; // 30 arc-seconds
  const cells = new Map<string, Record<RP, number>>();
  for (const f of fc.features) {
    const [lon, lat] = f.geometry.coordinates[0][0]; // north-west corner
    const col = Math.round((lon - x0) / d);
    const row = Math.round((y0 - lat) / d);
    cells.set(`${row},${col}`, Object.fromEntries(RPS.map((r) => [r, f.properties[`d${r}`] ?? 0])) as Record<RP, number>);
  }
  return { x0, y0, d, cells };
}

export function hazardAt(grid: FloodGrid, lon: number, lat: number): Record<RP, number> {
  const col = Math.floor((lon - grid.x0) / grid.d);
  const row = Math.floor((grid.y0 - lat) / grid.d);
  return grid.cells.get(`${row},${col}`) ?? (Object.fromEntries(RPS.map((r) => [r, 0])) as Record<RP, number>);
}
