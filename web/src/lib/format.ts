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

export const CLASS_COLOUR: Record<HousingClass, string> = {
  informal_iron_sheet: "#fbbf24",
  semi_permanent: "#34d399",
  permanent_masonry: "#e2e8f0",
  concrete_rcc: "#a78bfa",
};

export const WHERE_LABEL: Record<Where, string> = {
  KE: "Kenyan land",
  UG: "Uganda (outside Kenya)",
  LAKE: "Inside Lake Victoria",
};

export const ISSUE_COLOUR = "#f43f5e";

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
