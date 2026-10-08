/**
 * Risk Forge financial engine (browser). Mirrors scripts/prepare_3d_data.py so the numbers can be checked against it.
 *
 * Step 1 hazard:        depth per building at each JRC return period (attached by the prep script, or looked up
 *                       from the flood grid for AI-added rows)
 * Step 2 vulnerability: DR = cap x Huizinga-Africa(k x depth), k and cap per housing class
 * Step 4 financial:     loss = DR x insured value; portfolio loss per return period; EP curve; AAL; PML
 *
 * Portfolio totals are weighted: each building carries w (the book's stratified sample weight - the flood plain is
 * over-sampled to study it, then weighted back to population; 1 for other rows; 0 = excluded, e.g. a starter row in
 * the lake). Counts are of buildings with w > 0, i.e. the squares on the map. Per-building figures are unweighted.
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

/** contents: ASSUMPTION - stock (grain, bagged goods) spoils in shallow water, machinery less so; the same JRC Africa
 *  shape at a steeper k. Where a site has its own claims, the whole site is calibrated against them (b.cal). */
export const CONTENTS_CURVES = {
  stock: { k: 2.0, cap: 0.95 },
  machinery: { k: 1.2, cap: 0.7 },
  other: { k: 1.0, cap: 0.8 },
} as const;
export type ContentsKind = keyof typeof CONTENTS_CURVES;

export function contentsDamage(kind: ContentsKind, depth: number): number {
  const c = CONTENTS_CURVES[kind];
  return depth > 0 ? c.cap * interp(depth * c.k, HUIZINGA_AFRICA) : 0;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** stock, machinery and other contents carried by a building (document-ingested risks); 0 for the synthetic books */
export const contentsOf = (b: BuildingProps) => ({ stock: num(b.cs), machinery: num(b.cm), other: num(b.co) });
/** everything insured at this building: the structure plus its contents */
export const valueOf = (b: BuildingProps) => {
  const c = contentsOf(b);
  return b.tiv + c.stock + c.machinery + c.other;
};

export const severity = (depth: number) => Math.min(Math.max(depth, 0) / SEVERITY_REF_M, 1);

/** a building's weight in portfolio totals (see the header); rows without one count once */
export const weightOf = (b: BuildingProps): number => (typeof b.w === "number" ? b.w : 1);

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
  /** water depth at the site */
  depth: number;
  /** depth above the ground floor (a raised floor keeps the first part of the water out) */
  eff: number;
  /** structure damage ratio */
  dr: number;
  /** contents damage ratio (stock), when the building holds contents */
  cdr: number;
  loss: number;
}

export function buildingAt(b: BuildingProps, rp: number): BuildingResult {
  const depth = depthAtRp(depthsOf(b), rp);
  const eff = Math.max(depth - num(b.floor), 0);
  const dr = damageRatio(b.cls, eff);
  const c = contentsOf(b);
  const contentsLoss = contentsDamage("stock", eff) * c.stock + contentsDamage("machinery", eff) * c.machinery + contentsDamage("other", eff) * c.other;
  const cal = typeof b.cal === "number" && b.cal > 0 ? b.cal : 1; // site calibration against its own claims
  return { b, depth, eff, dr, cdr: contentsDamage("stock", eff), loss: (dr * b.tiv + contentsLoss) * cal };
}

export interface ScenarioResult {
  rp: number;
  loss: number;
  /** sample buildings in the flood (the squares on the map) */
  wet: number;
  /** the same, weighted: how many buildings of the represented book are in the flood */
  wetW: number;
  tivWet: number;
  byClass: Record<HousingClass, { loss: number; wet: number }>;
}

export function scenario(buildings: BuildingProps[], rp: number): ScenarioResult {
  const byClass = Object.fromEntries(CLASSES.map((c) => [c, { loss: 0, wet: 0 }])) as ScenarioResult["byClass"];
  let loss = 0;
  let wet = 0;
  let wetW = 0;
  let tivWet = 0;
  for (const b of buildings) {
    const w = weightOf(b);
    if (w <= 0) continue;
    const r = buildingAt(b, rp);
    loss += r.loss * w;
    byClass[b.cls].loss += r.loss * w;
    if (r.depth > 0) {
      wet++;
      wetW += w;
      tivWet += valueOf(b) * w;
      byClass[b.cls].wet++;
    }
  }
  return { rp, loss, wet, wetW, tivWet, byClass };
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
  let count = 0;
  for (const b of buildings) {
    const own = Object.fromEntries(RPS.map((r) => [r, buildingAt(b, r).loss])) as Record<RP, number>;
    const a = aal(own);
    perBuildingAal.set(b.id, a); // the building's own AAL, unweighted
    const w = weightOf(b);
    if (w <= 0) continue;
    count++;
    byClass[b.cls].count++;
    byClass[b.cls].tiv += valueOf(b) * w;
    byClass[b.cls].aal += a * w;
    tiv += valueOf(b) * w;
  }
  return { count, tiv, byClass, scenarios, aal: aal(lossByRp), perBuildingAal };
}

/** a building's AAL as it counts in the book: its own AAL times its weight */
export const aalInBook = (res: PortfolioResult, b: BuildingProps) => (res.perBuildingAal.get(b.id) ?? 0) * weightOf(b);

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
  /** permanent water (river channel, lake edge): >= 3.5 m deep at 1-in-10, never a building's own hazard */
  water: Set<string>;
}

export function buildFloodGrid(fc: { features: { properties: Record<string, number>; geometry: { coordinates: number[][][] } }[] }): FloodGrid {
  const x0 = 33.7;
  const y0 = 1.3;
  const d = 1 / 120; // 30 arc-seconds
  const cells = new Map<string, Record<RP, number>>();
  const water = new Set<string>();
  for (const f of fc.features) {
    const [lon, lat] = f.geometry.coordinates[0][0]; // north-west corner
    const k = `${Math.round((y0 - lat) / d)},${Math.round((lon - x0) / d)}`;
    if (f.properties.pw) water.add(k);
    else cells.set(k, Object.fromEntries(RPS.map((r) => [r, f.properties[`d${r}`] ?? 0])) as Record<RP, number>);
  }
  return { x0, y0, d, cells, water };
}

const DRY = Object.fromEntries(RPS.map((r) => [r, 0])) as Record<RP, number>;

export const onWater = (grid: FloodGrid, lon: number, lat: number) =>
  grid.water.has(`${Math.floor((grid.y0 - lat) / grid.d)},${Math.floor((lon - grid.x0) / grid.d)}`);

/** shallowest and deepest land cell within km of a point at one return period (dry cells count as 0) - how much
 *  the answer depends on exactly where in a village the building stands */
export function depthRangeNear(grid: FloodGrid, lon: number, lat: number, rp: RP = 100, km = 2) {
  const col = Math.floor((lon - grid.x0) / grid.d);
  const row = Math.floor((grid.y0 - lat) / grid.d);
  const reach = Math.ceil(km / (grid.d * 111.32)) + 1;
  let min = Infinity;
  let max = 0;
  for (let dr = -reach; dr <= reach; dr++)
    for (let dc = -reach; dc <= reach; dc++) {
      const key = `${row + dr},${col + dc}`;
      if (grid.water.has(key)) continue;
      const cx = grid.x0 + (col + dc + 0.5) * grid.d;
      const cy = grid.y0 - (row + dr + 0.5) * grid.d;
      if (Math.hypot((cx - lon) * Math.cos((lat * Math.PI) / 180), cy - lat) * 111.32 > km) continue;
      const depth = grid.cells.get(key)?.[rp] ?? 0;
      min = Math.min(min, depth);
      max = Math.max(max, depth);
    }
  return { min: Number.isFinite(min) ? min : 0, max };
}

/** flood depths for a new location; a point on permanent water takes the nearest land cell (the bank) instead */
export function hazardAt(grid: FloodGrid, lon: number, lat: number): Record<RP, number> {
  const col = Math.floor((lon - grid.x0) / grid.d);
  const row = Math.floor((grid.y0 - lat) / grid.d);
  if (!grid.water.has(`${row},${col}`)) return grid.cells.get(`${row},${col}`) ?? DRY;
  let best: { dist: number; key: string } | null = null;
  for (let dr = -3; dr <= 3; dr++)
    for (let dc = -3; dc <= 3; dc++) {
      const key = `${row + dr},${col + dc}`;
      if (grid.water.has(key)) continue;
      const cx = grid.x0 + (col + dc + 0.5) * grid.d;
      const cy = grid.y0 - (row + dr + 0.5) * grid.d;
      const dist = Math.hypot(cx - lon, cy - lat);
      if (!best || dist < best.dist) best = { dist, key };
    }
  return (best && grid.cells.get(best.key)) || DRY;
}
