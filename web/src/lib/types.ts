export type RP = 10 | 20 | 50 | 100 | 200 | 500;
export const RPS: RP[] = [10, 20, 50, 100, 200, 500];

export type HousingClass = "informal_iron_sheet" | "semi_permanent" | "permanent_masonry" | "concrete_rcc";
export const CLASSES: HousingClass[] = ["informal_iron_sheet", "semi_permanent", "permanent_masonry", "concrete_rcc"];

/** KE = Kenyan land, UG = Ugandan land, LAKE = inside Lake Victoria (invalid location) */
export type Where = "KE" | "UG" | "LAKE";

export interface BuildingProps {
  id: string;
  cls: HousingClass;
  area: number;
  cost: number;
  tiv: number;
  tivCsv: number;
  lat: number;
  lon: number;
  where: Where;
  settlement?: string;
  density_class?: "urban" | "peri_urban" | "rural";
  stratum?: "floodplain" | "basin";
  [key: string]: string | number | undefined;
}

export interface PortfolioStats {
  count: number;
  tiv: number;
  byClass: Record<HousingClass, { count: number; tiv: number }>;
  perRp: Record<string, { loss: number; buildingsWet: number; tivWet: number; lossByClass: Record<HousingClass, number> }>;
  aal: number;
}

export interface Stats {
  returnPeriods: RP[];
  onsetRp: number;
  severityRefM: number;
  cellKm2: number;
  floodLandKm2: Record<string, number>;
  maxDepthLand: Record<string, number>;
  lakeWetShare: number;
  starterFlags: Record<Where, number>;
  starterTivCsvTotal: number;
  bookStrata: Record<string, number>;
  curves: Record<HousingClass, { k: number; cap: number }>;
  portfolios: { book: PortfolioStats; starter: PortfolioStats; starterKenya: PortfolioStats };
}

/** book = Risk Forge synthetic book placed on population; starter = the hosts' starter CSV (with location issues) */
export type PortfolioView = "book" | "starter";
export type ColourMode = "class" | "damage";

export interface Place {
  name: string;
  lat: number;
  lon: number;
  kind: "focus" | "town" | "village" | "node" | "landmark" | "peak";
}
