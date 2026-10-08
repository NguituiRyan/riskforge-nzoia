/**
 * Offer document -> CAT model run. Risk Forge AI reads the broker's document (api/offer.ts); everything below is deterministic:
 *   0. accuracy  every extracted number must come with a quote that is found in the document
 *   1. exposure  buildings and contents become exposure rows (CSV in the shape of exposure_nzoia_synthetic.csv)
 *   2. hazard    JRC depth at the site; if the JRC map is dry there but the document reports floods, a site curve
 *                anchored on the reported flood depths, shaped by the basin's JRC depth-growth curve
 *   3. vulnerability  class curves + contents curves + raised floors, calibrated against the site's own claims
 *   4. financial engine  ground-up -> deductible -> limit -> gross -> reinsurer's share (terms.ts)
 *   5. decision  offered premium vs technical premium, with the facts behind it
 */
import type { BuildingProps, HousingClass, Place, RP } from "./types";
import { RPS } from "./types";
import { buildingAt, hazardAt, valueOf, weightOf, type FloodGrid } from "./engine";
import { runProgramme, type Programme, type ProgrammeResult } from "./terms";

export interface OfferExtract {
  insured: string;
  reference: string | null;
  occupancy: string;
  site: { lat: number | null; lon: number | null; place: string; river_distance_km: number | null };
  sum_insured_kes: number | null;
  buildings: { name: string; construction: string; housing_class: HousingClass; floor_area_m2: number | null; floor_height_m: number; value_kes: number | null; condition: "good" | "fair" | "poor" | "unknown" }[];
  contents: { name: string; kind: "stock" | "machinery" | "other"; value_kes: number; building: string }[];
  flood_history: { year: number; depth_m: number | null; loss_kes: number | null }[];
  record_years: number | null;
  terms: { flood_deductible_kes: number | null; flood_limit_kes: number | null; reinsurer_share_pct: number | null; flood_premium_kes: number | null; retention_max_kes: number | null };
  conditions: string[];
  broker_recommendation: string | null;
  facts: { field: string; value: number; quote: string }[];
  data_gaps: string[];
  warnings: string[];
}

/** typical floor area (m2) and cost (KES/m2) per class: mid-points of the dataset metadata ranges */
export const TYPICAL: Record<HousingClass, { area: number; cost: number }> = {
  informal_iron_sheet: { area: 14, cost: 7_500 },
  semi_permanent: { area: 38, cost: 12_000 },
  permanent_masonry: { area: 100, cost: 50_000 },
  concrete_rcc: { area: 350, cost: 67_500 },
};

// ---------------- 0. accuracy ----------------
export interface FactCheck {
  field: string;
  value: number;
  quote: string;
  /** the quote appears in the document */
  found: boolean;
  /** the number appears in the quote */
  matches: boolean;
}

const norm = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();

/** numbers written in a quote, raw and with their unit applied ("1.2m" -> 1.2 and 1,200,000; "KES 15,000,000" -> 15000000) */
function numbersIn(q: string): number[] {
  const out: number[] = [];
  for (const m of q.matchAll(/(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(bn|billion|million|m\b|k\b)?/gi)) {
    const v = Number(m[1].replace(/,/g, ""));
    out.push(v);
    const u = (m[2] ?? "").toLowerCase();
    if (u === "bn" || u === "billion") out.push(v * 1e9);
    else if (u === "m" || u === "million") out.push(v * 1e6);
    else if (u === "k") out.push(v * 1e3);
  }
  return out;
}

export function verifyFacts(x: OfferExtract, text: string): FactCheck[] {
  const doc = norm(text);
  return x.facts.map((f) => ({
    ...f,
    found: doc.includes(norm(f.quote)),
    matches: numbersIn(f.quote).some((n) => Math.abs(n - f.value) <= Math.max(Math.abs(f.value) * 0.005, 1e-6)),
  }));
}

// ---------------- 1. exposure ----------------
export interface ExposureRow {
  id: string;
  name: string;
  cls: HousingClass;
  area: number;
  areaBasis: "stated" | "typical";
  floor: number;
  structure: number;
  valueBasis: "stated" | "allocated" | "typical";
  stock: number;
  machinery: number;
  other: number;
  condition: string;
  lat: number;
  lon: number;
}

const tokens = (s: string) => new Set(s.toLowerCase().replace(/unit/g, "").match(/[a-z]+|\d+/g) ?? []);
function bestBuilding(rows: ExposureRow[], name: string, kind: string): ExposureRow {
  const want = tokens(name);
  let best: { row: ExposureRow; score: number } | null = null;
  for (const row of rows) {
    const have = tokens(row.name);
    let score = 0;
    for (const t of want) if (have.has(t)) score += /\d/.test(t) ? 3 : 1; // "#2" must match "#2"
    if (!best || score > best.score) best = { row, score };
  }
  if (best && best.score >= 2) return best.row;
  // no clear match: stock goes to the largest store, anything else to the largest building
  const stores = rows.filter((r) => /ware|store|silo|godown/i.test(r.name));
  const pool = kind === "stock" && stores.length ? stores : rows;
  return pool.reduce((a, b) => (b.area > a.area ? b : a));
}

// ---------------- 2. hazard ----------------
export interface HazardStage {
  source: "jrc" | "site";
  jrc: Record<RP, number>;
  site: Record<RP, number> | null;
  /** reported floods with their empirical return period (Weibull plotting position over the record) */
  events: { year: number; depth: number; rp: number }[];
  recordYears: number | null;
  jrcDry: boolean;
}

/** depth-frequency at the site from its own reported floods: depth = a + b ln(RP) fitted to the events, read at
 *  1-in-10 (inside the record), then shaped to rarer floods by the basin's median JRC growth curve */
function siteCurve(history: OfferExtract["flood_history"], recordYears: number | null, growth: Record<string, number>) {
  const ev = history.filter((e) => typeof e.depth_m === "number" && e.depth_m! > 0).map((e) => ({ year: e.year, depth: e.depth_m! }));
  if (ev.length < 2) return null;
  const years = recordYears && recordYears > 0 ? recordYears : Math.max(...ev.map((e) => e.year)) - Math.min(...ev.map((e) => e.year)) + 1;
  const sorted = [...ev].sort((a, b) => b.depth - a.depth).map((e, i) => ({ ...e, rp: (years + 1) / (i + 1) }));
  const xs = sorted.map((e) => Math.log(e.rp));
  const ys = sorted.map((e) => e.depth);
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  const sxx = xs.reduce((s, v) => s + (v - mx) ** 2, 0);
  const slope = sxx > 0 ? xs.reduce((s, v, i) => s + (v - mx) * (ys[i] - my), 0) / sxx : 0;
  const d10 = Math.max(slope > 0 ? my + slope * (Math.log(10) - mx) : Math.max(...ys), 0.05);
  const depths = Object.fromEntries(RPS.map((r) => [r, Math.round(d10 * (growth[String(r)] ?? 1) * 100) / 100])) as Record<RP, number>;
  return { depths, events: sorted, years };
}

// ---------------- 3. vulnerability ----------------
export interface VulnStage {
  factor: number;
  applied: boolean;
  r2: number | null;
  events: { year: number; depth: number; claim: number; prior: number; calibrated: number }[];
}

/** the whole site's loss if the water stands at `depth` (before calibration) */
function siteLossAtDepth(buildings: BuildingProps[], depth: number) {
  return buildings.reduce((s, b) => {
    const flat = { ...b, cal: 1 } as BuildingProps;
    for (const r of RPS) flat[`d${r}`] = depth;
    return s + buildingAt(flat, 100).loss;
  }, 0);
}

// ---------------- 5. decision ----------------
export interface Decision {
  verdict: "APPROVE" | "APPROVE WITH CONDITIONS" | "DECLINE AT OFFERED TERMS" | "REFER";
  offered: number | null;
  technical: number;
  ratio: number | null;
  /** the deductible at which the offered premium would cover the modelled cost (null if none up to the limit) */
  breakEvenDeductible: number | null;
  reasons: { text: string; tone: "good" | "bad" | "warn" }[];
  conditions: string[];
}

export interface OfferRun {
  id: string;
  insured: string;
  site: { lat: number; lon: number; located: "coordinates" | "place" };
  rows: ExposureRow[];
  buildings: BuildingProps[];
  hazard: HazardStage;
  vuln: VulnStage;
  programme: Programme;
  financial: ProgrammeResult;
  experience: { claims: number; events: number; years: number | null; aal: number | null; toReinsurer: number | null };
  decision: Decision;
}

const BBOX = { w: 33.9, s: -4.75, e: 41.95, n: 5.05 }; // Kenya: the JRC hazard grid now covers the whole country
const kes = (n: number) => (n >= 1e9 ? `KES ${(n / 1e9).toFixed(2)} bn` : n >= 1e6 ? `KES ${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : n >= 1e3 ? `KES ${Math.round(n / 1e3)}K` : `KES ${Math.round(n)}`);

export function runOffer(
  x: OfferExtract,
  opts: {
    gazetteer: Place[];
    grid: FloodGrid;
    /** depth growth with rarity for the site's region (Nzoia's, or the 1-degree tile's elsewhere in Kenya) */
    growth: (lon: number, lat: number) => Record<string, number>;
    hazardSource: "auto" | "jrc" | "site";
    calibrate: boolean;
    batch: number;
    book?: BuildingProps[];
  },
): OfferRun {
  const id = `OFR-${opts.batch}`;
  // site: stated coordinates inside the hazard grid, else the named place
  const place = opts.gazetteer.find((g) => g.name === x.site.place);
  const coordsOk = x.site.lat !== null && x.site.lon !== null && x.site.lon > BBOX.w && x.site.lon < BBOX.e && x.site.lat > BBOX.s && x.site.lat < BBOX.n;
  if (!coordsOk && !place) throw new Error("The document gives no location in Kenya (coordinates or a known place).");
  const site = coordsOk ? { lat: x.site.lat!, lon: x.site.lon!, located: "coordinates" as const } : { lat: place!.lat, lon: place!.lon, located: "place" as const };

  // ---- exposure rows ----
  const src = x.buildings.length ? x.buildings : [{ name: "Main building", construction: "not stated", housing_class: "permanent_masonry" as HousingClass, floor_area_m2: null, floor_height_m: 0, value_kes: null, condition: "unknown" as const }];
  const contentsTotal = x.contents.reduce((s, c) => s + Math.max(c.value_kes, 0), 0);
  const statedStructures = src.reduce((s, b) => s + (b.value_kes ?? 0), 0);
  const pool = x.sum_insured_kes !== null ? Math.max(x.sum_insured_kes - contentsTotal - statedStructures, 0) : null;
  const areaOf = (b: (typeof src)[number]) => (b.floor_area_m2 && b.floor_area_m2 > 0 ? b.floor_area_m2 : TYPICAL[b.housing_class].area);
  const weightOfB = (b: (typeof src)[number]) => areaOf(b) * TYPICAL[b.housing_class].cost;
  const unvaluedWeight = src.filter((b) => b.value_kes === null).reduce((s, b) => s + weightOfB(b), 0);
  const cols = Math.ceil(Math.sqrt(src.length));
  const rowsN = Math.ceil(src.length / cols);
  const rows: ExposureRow[] = src.map((b, i) => {
    // schematic site layout: a grid at 150 m spacing round the site point (the document gives no plan)
    const dx = ((i % cols) - (cols - 1) / 2) * 150;
    const dy = ((rowsN - 1) / 2 - Math.floor(i / cols)) * 150;
    const structure = b.value_kes ?? (pool !== null && unvaluedWeight > 0 ? (pool * weightOfB(b)) / unvaluedWeight : weightOfB(b));
    return {
      id: `${id}-${String(i + 1).padStart(2, "0")}`,
      name: b.name,
      cls: b.housing_class,
      area: areaOf(b),
      areaBasis: b.floor_area_m2 ? "stated" : "typical",
      floor: Math.max(b.floor_height_m || 0, 0),
      structure: Math.round(structure),
      valueBasis: b.value_kes !== null ? "stated" : pool !== null ? "allocated" : "typical",
      stock: 0,
      machinery: 0,
      other: 0,
      condition: b.condition,
      lat: site.lat + dy / 111_320,
      lon: site.lon + dx / (111_320 * Math.cos((site.lat * Math.PI) / 180)),
    };
  });
  for (const c of x.contents) bestBuilding(rows, c.building, c.kind)[c.kind] += Math.max(c.value_kes, 0);

  // ---- hazard ----
  const jrc = hazardAt(opts.grid, site.lon, site.lat);
  const jrcDry = RPS.every((r) => !jrc[r]);
  const sc = siteCurve(x.flood_history, x.record_years, opts.growth(site.lon, site.lat));
  const source: "jrc" | "site" = opts.hazardSource === "jrc" || !sc ? "jrc" : opts.hazardSource === "site" ? "site" : jrcDry ? "site" : "jrc";
  const depths = source === "site" && sc ? sc.depths : jrc;
  const hazard: HazardStage = { source, jrc, site: sc?.depths ?? null, events: sc?.events ?? [], recordYears: sc?.years ?? x.record_years, jrcDry };

  // ---- buildings for the engine ----
  const ded = x.terms.flood_deductible_kes ?? 0;
  const lim = x.terms.flood_limit_kes ?? 0;
  const make = (r: ExposureRow): BuildingProps => {
    const b: BuildingProps = {
      id: r.id,
      name: r.name,
      cls: r.cls,
      area: Math.round(r.area),
      cost: Math.round(r.structure / Math.max(r.area, 1)),
      tiv: r.structure,
      tivCsv: r.structure,
      lat: Math.round(r.lat * 1e6) / 1e6,
      lon: Math.round(r.lon * 1e6) / 1e6,
      where: "KE",
      settlement: x.insured,
      src: "ai",
      confidence: 0.9,
      placed: site.located === "coordinates" ? "exact" : "approx",
      batch: opts.batch,
      half: Math.min(Math.max(Math.sqrt(r.area) / 2 + 20, 45), 70),
      floor: r.floor,
      cs: r.stock,
      cm: r.machinery,
      co: r.other,
      policy: id,
      ded,
      lim,
      hz: source,
      doc: 1,
    };
    for (const rp of RPS) b[`d${rp}`] = depths[rp];
    return b;
  };
  const priorBuildings = rows.map(make);

  // ---- vulnerability: calibrate against the site's own claims ----
  const claimEvents = x.flood_history.filter((e) => typeof e.depth_m === "number" && e.depth_m! > 0 && typeof e.loss_kes === "number" && e.loss_kes! > 0);
  const modelled = claimEvents.map((e) => siteLossAtDepth(priorBuildings, e.depth_m!));
  const smm = modelled.reduce((s, m) => s + m * m, 0);
  const smc = modelled.reduce((s, m, i) => s + m * claimEvents[i].loss_kes!, 0);
  const canCalibrate = claimEvents.length >= 2 && smm > 0;
  const factor = canCalibrate ? Math.min(Math.max(smc / smm, 0.02), 5) : 1;
  const applied = opts.calibrate && canCalibrate;
  const cal = applied ? factor : 1;
  const claims = claimEvents.map((e) => e.loss_kes!);
  const mean = claims.reduce((s, v) => s + v, 0) / Math.max(claims.length, 1);
  const ssTot = claims.reduce((s, v) => s + (v - mean) ** 2, 0);
  const ssRes = claims.reduce((s, v, i) => s + (v - modelled[i] * factor) ** 2, 0);
  const vuln: VulnStage = {
    factor,
    applied,
    r2: canCalibrate && claimEvents.length >= 3 && ssTot > 0 ? 1 - ssRes / ssTot : null,
    events: claimEvents.map((e, i) => ({ year: e.year, depth: e.depth_m!, claim: e.loss_kes!, prior: modelled[i], calibrated: modelled[i] * factor })),
  };
  const buildings = priorBuildings.map((b) => ({ ...b, cal }));

  // ---- financial engine: Kenya Re's share of the flood cover ----
  const share = (x.terms.reinsurer_share_pct ?? 100) / 100;
  const programme: Programme = { deductible: ded, limit: lim, qs: share, xlAttach: 0, xlLimit: 0 };
  const financial = runProgramme(buildings, programme);
  const allClaims = x.flood_history.reduce((s, e) => s + (e.loss_kes ?? 0), 0);
  const years = x.record_years ?? hazard.recordYears;
  const toRe = years ? x.flood_history.reduce((s, e) => s + Math.min(Math.max((e.loss_kes ?? 0) - ded, 0), lim > 0 ? lim : Infinity), 0) * share / years : null;
  const experience = { claims: allClaims, events: x.flood_history.length, years, aal: years ? allClaims / years : null, toReinsurer: toRe };

  // ---- decision ----
  const offered = x.terms.flood_premium_kes !== null ? x.terms.flood_premium_kes * share : null;
  const technical = financial.reinsurerPremium;
  const ratio = offered !== null && technical > 0 ? offered / technical : null;
  let breakEvenDeductible: number | null = null;
  if (offered !== null && ratio !== null && ratio < 1) {
    for (let d = Math.max(ded, 1_000_000); d <= (lim > 0 ? lim : 5e8); d *= 1.15) {
      // the deductible sits on each building's policy (b.ded), so change it there
      if (runProgramme(buildings.map((b) => ({ ...b, ded: d })), { ...programme, deductible: d }).reinsurerPremium <= offered) {
        breakEvenDeductible = Math.ceil(d / 1e6) * 1e6;
        break;
      }
    }
  }
  const reasons: Decision["reasons"] = [];
  const conditions: string[] = [];
  let verdict: Decision["verdict"];
  if (offered === null) {
    verdict = "REFER";
    reasons.push({ text: "No flood premium in the offer to test against the model", tone: "warn" });
  } else {
    verdict = ratio! >= 1 ? "APPROVE" : ratio! >= 0.7 ? "APPROVE WITH CONDITIONS" : "DECLINE AT OFFERED TERMS";
    reasons.push({
      text: `Expected loss to Kenya Re ${kes(financial.aal.reinsurer)} a year; the offer pays ${kes(offered)} (${Math.round(ratio! * 100)}% of the ${kes(technical)} technical price)`,
      tone: ratio! >= 1 ? "good" : "bad",
    });
  }
  reasons.push({ text: `1-in-100 flood costs Kenya Re ${kes(financial.byRp[100].reinsurer)}; 1-in-500 ${kes(financial.byRp[500].reinsurer)}`, tone: "warn" });
  if (experience.events)
    reasons.push({
      text: `${experience.events} flood${experience.events === 1 ? "" : "s"} in ${years ?? "?"} years, ${allClaims > 0 ? `${kes(allClaims)} claimed${experience.aal ? ` (${kes(experience.aal)} a year)` : ""}` : "no claims paid"}`,
      tone: experience.events >= 3 ? "bad" : allClaims > 0 ? "warn" : "good",
    });
  if (source === "site") reasons.push({ text: `JRC flood map is dry at this site; depths come from the document's own flood history (${hazard.events.map((e) => e.depth.toFixed(1)).join(", ")} m)`, tone: "warn" });
  if (applied) reasons.push({ text: `Generic damage curves ×${factor.toFixed(2)} after fitting the site's ${claimEvents.length} past claims${vuln.r2 !== null ? ` (R² ${vuln.r2.toFixed(2)})` : ""}`, tone: "warn" });
  // accumulation: what the book already holds within 5 km of the site
  const near = (opts.book ?? []).filter((b) => Math.hypot((b.lon - site.lon) * 111.32 * Math.cos((site.lat * Math.PI) / 180), (b.lat - site.lat) * 111.32) <= 5);
  const nearValue = near.reduce((s, b) => s + valueOf(b) * Math.max(weightOf(b), 0), 0);
  if (near.length) reasons.push({ text: `Accumulation: the book already holds ${kes(nearValue)} within 5 km (${near.length} buildings)`, tone: "warn" });

  if (ratio !== null && ratio < 1) {
    conditions.push(`Flood premium for Kenya Re's ${Math.round(share * 100)}% of at least ${kes(technical)}`);
    if (breakEvenDeductible) conditions.push(`or keep the premium and raise the flood deductible to ${kes(breakEvenDeductible)}`);
  }
  if (source === "site") conditions.push("Independent flood-depth survey at the site (the JRC map does not resolve it)");
  if (rows.some((r) => r.condition === "poor")) conditions.push(`Repair or exclude poor-condition buildings: ${rows.filter((r) => r.condition === "poor").map((r) => r.name).join(", ")}`);
  for (const c of x.conditions.slice(0, 4)) conditions.push(c);
  if (verdict === "APPROVE" && (source === "site" || rows.some((r) => r.condition === "poor"))) verdict = "APPROVE WITH CONDITIONS";

  return {
    id,
    insured: x.insured,
    site,
    rows,
    buildings,
    hazard,
    vuln,
    programme,
    financial,
    experience,
    decision: { verdict, offered, technical, ratio, breakEvenDeductible, reasons, conditions },
  };
}

/** the risk as rows in the shape of exposure_nzoia_synthetic.csv, plus the pipeline's columns */
export function offerCsv(run: OfferRun): string {
  const head = ["loc_id", "lat", "lon", "housing_class", "floor_area_m2", "cost_per_m2_kes", "tiv_kes", "synthetic", "source", "building", "floor_height_m", "stock_kes", "machinery_kes", "value_basis", "hazard_source"];
  for (const rp of RPS) head.push(`hazard_depth_m_rp${rp}`, `loss_kes_rp${rp}`);
  const cell = (v: unknown) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [head.join(",")];
  run.rows.forEach((r, i) => {
    const b = run.buildings[i];
    const row: unknown[] = [r.id, r.lat.toFixed(6), r.lon.toFixed(6), r.cls, Math.round(r.area), Math.round(r.structure / Math.max(r.area, 1)), r.structure, false, `AI-extracted from broker offer (${run.insured})`, r.name, r.floor, r.stock, r.machinery, r.valueBasis, run.hazard.source];
    for (const rp of RPS) row.push(Number(b[`d${rp}`]).toFixed(2), Math.round(buildingAt(b, rp).loss));
    lines.push(row.map(cell).join(","));
  });
  return lines.join("\n");
}

