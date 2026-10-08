/** Underwriter report helpers: summaries for the AI briefing (with verifiable paths), CSV export, accumulation. */
import type { Feature, Polygon } from "geojson";
import type { BuildingProps, HousingClass, Place, RP } from "./types";
import { CLASSES, RPS } from "./types";
import { aalInBook, buildingAt, KEY_RPS, severity, technicalPremium, weightOf, type PortfolioResult, type ScenarioResult } from "./engine";
import { CLASS_LABEL } from "./format";

const FOOTPRINT_HALF_M = 300;

export function squareFeature(b: BuildingProps): Feature<Polygon, BuildingProps> {
  const dlat = FOOTPRINT_HALF_M / 111_320;
  const dlon = dlat / Math.cos((b.lat * Math.PI) / 180);
  const { lon, lat } = b;
  return {
    type: "Feature",
    properties: b,
    geometry: { type: "Polygon", coordinates: [[[lon - dlon, lat - dlat], [lon + dlon, lat - dlat], [lon + dlon, lat + dlat], [lon - dlon, lat + dlat], [lon - dlon, lat - dlat]]] },
  };
}

export function nearestPlace(places: Place[], lon: number, lat: number, maxKm = 12): string {
  let best = "other";
  let bestKm = maxKm;
  for (const p of places) {
    const km = Math.hypot((p.lon - lon) * 111.32 * Math.cos((lat * Math.PI) / 180), (p.lat - lat) * 111.32);
    if (km < bestKm) {
      bestKm = km;
      best = p.name;
    }
  }
  return best;
}

export interface Accumulation {
  settlement: string;
  buildings: number;
  tivInFootprint: number;
  loss100: number;
}

/** insured value inside the 1-in-100 flood footprint, by settlement - where the book is concentrated (weighted, like the totals) */
export function accumulation(buildings: BuildingProps[], places: Place[]): Accumulation[] {
  const by = new Map<string, Accumulation>();
  for (const b of buildings) {
    const w = weightOf(b);
    const r = buildingAt(b, 100);
    if (r.depth <= 0 || w <= 0) continue;
    const s = b.settlement && b.settlement !== "other" ? b.settlement : nearestPlace(places, b.lon, b.lat);
    const a = by.get(s) ?? { settlement: s, buildings: 0, tivInFootprint: 0, loss100: 0 };
    a.buildings++;
    a.tivInFootprint += b.tiv * w;
    a.loss100 += r.loss * w;
    by.set(s, a);
  }
  return [...by.values()].sort((x, y) => y.tivInFootprint - x.tivInFootprint);
}

/** the buildings that add most to the book's AAL (own AAL x weight, so the list adds up to the book's total) */
export function topRisks(buildings: BuildingProps[], res: PortfolioResult, n = 10) {
  return buildings
    .filter((b) => weightOf(b) > 0) // rows left out of the portfolio (e.g. in the lake) are not its risks
    .map((b) => ({ b, aal: aalInBook(res, b), share: aalInBook(res, b) / Math.max(res.aal, 1), at100: buildingAt(b, 100) }))
    .filter((x) => x.aal > 0)
    .sort((x, y) => y.aal - x.aal)
    .slice(0, n);
}

/** compact, aggregated numbers sent to the briefing model (no building list beyond the top risks) */
export function briefingSummary(
  portfolioName: string,
  buildings: BuildingProps[],
  res: PortfolioResult,
  places: Place[],
  live: { stage: number; rp: number | null; scenario: ScenarioResult | null } | null,
) {
  const prem = technicalPremium(res);
  return {
    portfolio: portfolioName,
    synthetic: true,
    currency: "KES",
    totals: { buildings: res.count, insuredValue: Math.round(res.tiv) },
    averageAnnualLoss: Math.round(res.aal),
    aalPercentOfValue: Math.round((res.aal / res.tiv) * 10000) / 100,
    weighting: "All money figures are weighted portfolio totals. The book is a stratified sample: flood-plain buildings are over-sampled and count for less. topRisks gives each building's contribution to the book (aalInBook), which always sums to at most averageAnnualLoss.",
    keyLosses: KEY_RPS.map((rp) => ({ returnPeriodYears: rp, loss: Math.round(res.scenarios[rp].loss), buildingsFlooded: Math.round(res.scenarios[rp].wetW), sampleBuildingsFlooded: res.scenarios[rp].wet })),
    technicalPremiumIllustrative: Math.round(prem.gross),
    byClass: CLASSES.map((c) => ({ class: CLASS_LABEL[c], buildings: res.byClass[c].count, insuredValue: Math.round(res.byClass[c].tiv), aal: Math.round(res.byClass[c].aal), loss100: Math.round(res.scenarios[100].byClass[c].loss) })),
    topRisks: topRisks(buildings, res, 5).map((x) => ({ id: x.b.id, class: CLASS_LABEL[x.b.cls], settlement: x.b.settlement ?? nearestPlace(places, x.b.lon, x.b.lat), sampleWeight: Math.round(weightOf(x.b) * 100) / 100, aalInBook: Math.round(x.aal), shareOfBookAalPercent: Math.round(x.share * 1000) / 10, depthAt100m: Math.round(x.at100.depth * 100) / 100 })),
    accumulation: accumulation(buildings, places).slice(0, 5).map((a) => ({ settlement: a.settlement, buildings: a.buildings, insuredValueInFootprint100: Math.round(a.tivInFootprint), loss100: Math.round(a.loss100) })),
    aiAddedBuildings: buildings.filter((b) => b.src === "ai").length,
    liveRiver: live ? { stageMetres: Math.round(live.stage * 100) / 100, returnPeriodYears: live.rp ? Math.round(live.rp * 10) / 10 : null, eventLoss: live.scenario ? Math.round(live.scenario.loss) : 0 } : null,
    assumptions: [
      "Losses start at the 1-in-2 flood; JRC maps are undefended (Budalangi dykes not modelled)",
      "Damage curves: Huizinga et al. 2017 JRC Africa residential, adapted per class after Englhardt et al. 2019",
      "Whole reach floods at one return period per event",
      "1-in-250 interpolated between the 200- and 500-year maps",
      "Cells already >= 3.5 m deep at 1-in-10 are the river channel or lake edge: no buildings there",
      "Totals are weighted: the flood plain is over-sampled, then weighted back to population",
    ],
  };
}

/** resolve paths like keyLosses[3].loss against an object (used to verify the briefing's numbers) */
export function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return cur;
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(buildings: BuildingProps[], res: PortfolioResult): string {
  const head = ["loc_id", "lat", "lon", "housing_class", "floor_area_m2", "cost_per_m2_kes", "tiv_kes", "synthetic", "source", "settlement", "location_flag", "weight_in_totals"];
  for (const rp of RPS) head.push(`hazard_depth_m_rp${rp}`, `hazard_severity_rp${rp}`, `damage_ratio_rp${rp}`, `loss_kes_rp${rp}`);
  head.push("aal_kes", "aal_in_book_kes");
  const lines = [head.join(",")];
  for (const b of buildings) {
    const row: unknown[] = [b.id, b.lat, b.lon, b.cls, b.area, b.cost, Math.round(b.tiv), true, b.src === "ai" ? "AI-ingested (Claude), approved by underwriter" : "synthetic", b.settlement ?? "", b.where, weightOf(b)];
    for (const rp of RPS as RP[]) {
      const r = buildingAt(b, rp);
      row.push(r.depth.toFixed(2), severity(r.depth).toFixed(3), r.dr.toFixed(3), Math.round(r.loss));
    }
    row.push(Math.round(res.perBuildingAal.get(b.id) ?? 0), Math.round(aalInBook(res, b)));
    lines.push(row.map(csvCell).join(","));
  }
  return lines.join("\n");
}

export function download(filename: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const classOrder = (c: HousingClass) => CLASSES.indexOf(c);
