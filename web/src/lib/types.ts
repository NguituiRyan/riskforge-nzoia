export type RP = 10 | 20 | 50 | 100 | 200 | 500;
export const RPS: RP[] = [10, 20, 50, 100, 200, 500];

export type HousingClass = "informal_iron_sheet" | "semi_permanent" | "permanent_masonry" | "concrete_rcc";
export const CLASSES: HousingClass[] = ["informal_iron_sheet", "semi_permanent", "permanent_masonry", "concrete_rcc"];

/** KE = Kenyan land, UG = Ugandan land, LAKE = inside Lake Victoria, WATER = on the river channel or lake edge
 *  (a cell >= 3.5 m deep at 1-in-10). LAKE and WATER rows are excluded from portfolio totals. */
export type Where = "KE" | "UG" | "LAKE" | "WATER";

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
  /** weight in portfolio totals: the book's sample weight; 1 if absent; 0 = excluded (lake, permanent water) */
  w?: number;
  /** "ai" for rows added through the AI exposure ingestion and approved by the underwriter */
  src?: "ai";
  confidence?: number;
  [key: string]: string | number | undefined;
}

export interface PortfolioStats {
  count: number;
  tiv: number;
  byClass: Record<HousingClass, { count: number; tiv: number }>;
  perRp: Record<string, { loss: number; buildingsWet: number; tivWet: number; lossByClass: Record<HousingClass, number> }>;
  aal: number;
  loss250: number;
}

export interface Stats {
  returnPeriods: RP[];
  onsetRp: number;
  severityRefM: number;
  cellKm2: number;
  floodLandKm2: Record<string, number>;
  maxDepthLand: Record<string, number>;
  lakeWetShare: number;
  permanentWater: { ruleD10M: number; cells: number; km2: number };
  /** median depth(RP) / depth(1-in-10) on flood-plain land, from the JRC maps */
  depthGrowth: Record<string, number>;
  starterFlags: Record<Where, number>;
  starterTivCsvTotal: number;
  bookStrata: Record<string, number>;
  bookWeights: Record<string, number>;
  curves: Record<HousingClass, { k: number; cap: number }>;
  /** book: weighted to population; bookUnweighted: the flood-plain-enriched sample as drawn;
   *  starter: cleaned (lake / permanent-water rows excluded); starterRaw: as provided; starterKenya: Kenyan rows only */
  portfolios: { book: PortfolioStats; bookUnweighted: PortfolioStats; starter: PortfolioStats; starterRaw: PortfolioStats; starterKenya: PortfolioStats };
}

/** book = Risk Forge synthetic book placed on population; starter = the hosts' starter CSV (with location issues) */
export type PortfolioView = "book" | "starter";
export type ColourMode = "class" | "damage";

export interface Place {
  name: string;
  lat: number;
  lon: number;
  /** area = sub-county or ward: placing a building there is approximate */
  kind: "focus" | "town" | "village" | "node" | "landmark" | "peak" | "area";
  /** other spellings brokers use (gazetteer only) */
  aliases?: string[];
}
