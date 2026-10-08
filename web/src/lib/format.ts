import type { HousingClass, Where } from "./types";

export function kes(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `KES ${(n / 1e9).toFixed(2)} bn`;
  if (a >= 1e6) return `KES ${(n / 1e6).toFixed(a >= 1e8 ? 0 : 1)} M`;
  if (a >= 1e3) return `KES ${Math.round(n / 1e3).toLocaleString("en-KE")} K`;
  return `KES ${Math.round(n).toLocaleString("en-KE")}`;
}

export const CLASS_LABEL: Record<HousingClass, string> = {
  informal_iron_sheet: "Informal (iron sheet)",
  semi_permanent: "Semi-permanent",
  permanent_masonry: "Permanent masonry",
  concrete_rcc: "Concrete / RCC",
};

/** class colours on the 3D map (dark-surface steps of a validated categorical palette: orange, aqua, yellow, violet) */
export const CLASS_COLOUR: Record<HousingClass, string> = {
  informal_iron_sheet: "#d95926",
  semi_permanent: "#199e70",
  permanent_masonry: "#c98500",
  concrete_rcc: "#9085e9",
};

/** class colours for the interface (theme-aware CSS variables); the map keeps CLASS_COLOUR on the imagery */
export const CLASS_UI: Record<HousingClass, string> = {
  informal_iron_sheet: "var(--cls-informal_iron_sheet)",
  semi_permanent: "var(--cls-semi_permanent)",
  permanent_masonry: "var(--cls-permanent_masonry)",
  concrete_rcc: "var(--cls-concrete_rcc)",
};

export const WHERE_LABEL: Record<Where, string> = {
  KE: "Kenyan land",
  UG: "Uganda (outside Kenya)",
  LAKE: "Inside Lake Victoria",
  WATER: "On the river channel or lake edge",
};

export const ISSUE_COLOUR = "#f43f5e";

/** "about 6 (40 sampled)" when weights make the represented count differ from the squares on the map */
export function floodedText(wet: number, wetW: number): string {
  return Math.abs(wetW - wet) < 0.5 ? `${wet}` : `≈${Math.max(Math.round(wetW), wetW > 0 ? 1 : 0)} (${wet} sampled)`;
}

/** water depth ramp (metres) */
export const DEPTH_STOPS: [number, string][] = [
  [0.25, "#7dd3fc"],
  [1, "#38bdf8"],
  [2.5, "#0ea5e9"],
  [5, "#2563eb"],
  [10, "#1e3a8a"],
];

/** damage ratio ramp */
export const DAMAGE_STOPS: [number, string][] = [
  [0, "#475569"],
  [0.001, "#fde047"],
  [0.25, "#fb923c"],
  [0.5, "#ef4444"],
  [0.8, "#be123c"],
];
