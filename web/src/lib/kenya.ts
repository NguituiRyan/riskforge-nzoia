/**
 * Kenya-wide hazard and places (scripts/prepare_kenya_hazard.py).
 * The JRC global flood maps cut to Kenya: the same product and 30" grid as the Nzoia rasters (checked cell for cell),
 * so a building anywhere in Kenya gets its depths the same way a Nzoia building does.
 */
import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { BuildingProps, Place, RP } from "./types";
import { RPS } from "./types";
import type { FloodGrid } from "./engine";

export interface KenyaHazard {
  source: string;
  x0: number;
  y0: number;
  d: number;
  nrows: number;
  ncols: number;
  rps: number[];
  /** [row, col, depth at each RP in cm] */
  cells: number[][];
  /** river channels: >= 3.5 m deep at 1-in-10 */
  channel: [number, number][];
  /** permanent lakes, run-length: [row, first col, length] */
  lake: [number, number, number][];
  growth: { default: Record<string, number>; tiles: Record<string, Record<string, number> & { n: number }> };
  floodLandKm2: Record<string, number>;
  checkAgainstNzoia: Record<string, { maxAbsDiffM: number; identicalShare: number; wetNzoia: number }>;
}

/** a place in Kenya (GeoNames), with its county */
export interface KenyaPlace {
  name: string;
  kind: string;
  lat: number;
  lon: number;
  county: string;
  aliases?: string[];
}

export const KENYA_BBOX = { w: 33.9, s: -4.75, e: 41.95, n: 5.05 };
export const inKenyaBox = (lon: number, lat: number) => lon > KENYA_BBOX.w && lon < KENYA_BBOX.e && lat > KENYA_BBOX.s && lat < KENYA_BBOX.n;
/** the window the hackathon's Nzoia rasters cover; inside it the original Nzoia cells are used */
export const NZOIA_BOX = { w: 33.7, s: -0.3, e: 35.4, n: 1.3 };
const inNzoia = (lon: number, lat: number) => lon >= NZOIA_BOX.w && lon < NZOIA_BOX.e && lat > NZOIA_BOX.s && lat <= NZOIA_BOX.n;

const key = (r: number, c: number) => `${r},${c}`;

/** one grid for Kenya: Kenya-wide cells everywhere, the Nzoia cells (with their lake mask) inside the Nzoia window */
export function kenyaGrid(h: KenyaHazard, nzoia: FloodGrid): FloodGrid {
  const cells = new Map<string, Record<RP, number>>();
  const water = new Set<string>();
  const centre = (r: number, c: number) => [h.x0 + (c + 0.5) * h.d, h.y0 - (r + 0.5) * h.d] as const;
  for (const [r, c, ...cm] of h.cells) {
    const [lon, lat] = centre(r, c);
    if (inNzoia(lon, lat)) continue;
    cells.set(key(r, c), Object.fromEntries(RPS.map((rp, i) => [rp, cm[i] / 100])) as Record<RP, number>);
  }
  for (const [r, c] of h.channel) water.add(key(r, c));
  for (const [r, c0, n] of h.lake) for (let c = c0; c < c0 + n; c++) water.add(key(r, c));
  // the Nzoia grid sits on the same lattice: shift its keys into Kenya rows and columns
  const dr = Math.round((h.y0 - nzoia.y0) / h.d);
  const dc = Math.round((nzoia.x0 - h.x0) / h.d);
  for (const [k, v] of nzoia.cells) {
    const [r, c] = k.split(",").map(Number);
    cells.set(key(r + dr, c + dc), v);
  }
  for (const k of nzoia.water) {
    const [r, c] = k.split(",").map(Number);
    water.add(key(r + dr, c + dc));
  }
  return { x0: h.x0, y0: h.y0, d: h.d, cells, water };
}

/** how depth grows with rarity where the map is dry (shapes a site's own flood curve): this 1-degree tile, else Kenya */
export function growthAt(h: KenyaHazard | null, fallback: Record<string, number>, lon: number, lat: number): Record<string, number> {
  if (!h || inNzoia(lon, lat)) return fallback;
  const t = h.growth.tiles[`${Math.floor(lat)},${Math.floor(lon)}`];
  return t ?? h.growth.default;
}

/** map cells outside the Nzoia window (Nzoia keeps its own file): wet land with depth per RP, channels flat */
export function kenyaFloodFeatures(h: KenyaHazard): Feature<Polygon>[] {
  const out: Feature<Polygon>[] = [];
  const sq = (r: number, c: number): Polygon => {
    const x = h.x0 + c * h.d;
    const y = h.y0 - r * h.d;
    return { type: "Polygon", coordinates: [[[x, y], [x + h.d, y], [x + h.d, y - h.d], [x, y - h.d], [x, y]]] };
  };
  for (const [r, c, ...cm] of h.cells) {
    if (inNzoia(h.x0 + (c + 0.5) * h.d, h.y0 - (r + 0.5) * h.d)) continue;
    out.push({ type: "Feature", properties: Object.fromEntries(RPS.map((rp, i) => [`d${rp}`, cm[i] / 100])), geometry: sq(r, c) });
  }
  for (const [r, c] of h.channel) {
    if (inNzoia(h.x0 + (c + 0.5) * h.d, h.y0 - (r + 0.5) * h.d)) continue;
    out.push({ type: "Feature", properties: { pw: 1 }, geometry: sq(r, c) });
  }
  return out;
}

// ---------------- places ----------------
const GENERIC = /\b(game reserve|national reserve|national park|county|location|sub-location|division|market|bridge|hotel|lodge|camp|airstrip|airport|town|village|river|estate|farm|ranch|school|hospital|primary|secondary|sub county|ward)\b/gi;
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** the distinctive part of a name ("Maasai Mara Game Reserve" -> "maasai mara") */
const coreOf = (s: string) => norm(s.replace(GENERIC, " "));

/** a unique label per place, e.g. "Talek (river, Narok)" - the AI answers with the label, so duplicates never collide */
export const placeLabel = (p: KenyaPlace) => `${p.name} (${p.kind}, ${p.county || "Kenya"})`;

/**
 * Places whose names appear in the user's text. Only these go to the AI, never the whole 16,000-entry gazetteer.
 * Towns and villages first; at most `max` entries.
 */
export function placeCandidates(text: string, places: KenyaPlace[], max = 160): KenyaPlace[] {
  const t = ` ${norm(text)} `;
  const rank: Record<string, number> = { county: 0, town: 1, reserve: 2, park: 2, village: 3, lodge: 4, camp: 4, river: 4, area: 5, airstrip: 6 };
  const hits: { p: KenyaPlace; score: number }[] = [];
  for (const p of places) {
    const names = [p.name, ...(p.aliases ?? [])];
    let best = 0;
    for (const n of names) {
      const full = norm(n);
      const core = coreOf(n);
      if (full.length >= 4 && t.includes(` ${full} `)) best = Math.max(best, 3);
      else if (core.length >= 4 && t.includes(` ${core} `)) best = Math.max(best, 2);
    }
    if (best) hits.push({ p, score: best * 10 - (rank[p.kind] ?? 7) });
  }
  // a matched county also brings its towns, so "a lodge in Narok" can be placed at Narok town
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((h) => h.p);
}

export function asPlace(p: KenyaPlace): Place {
  const kind: Place["kind"] = p.kind === "town" ? "town" : p.kind === "village" ? "village" : p.kind === "county" || p.kind === "area" || p.kind === "reserve" || p.kind === "park" ? "area" : "landmark";
  return { name: placeLabel(p), lat: p.lat, lon: p.lon, kind, aliases: p.aliases, county: p.county };
}

// ---------------- siting ----------------
export type Siting = "as_placed" | "riverside" | "floodplain" | "away_from_river";

const kmBetween = (lon1: number, lat1: number, lon2: number, lat2: number) => Math.hypot((lon1 - lon2) * Math.cos((lat1 * Math.PI) / 180), lat1 - lat2) * 111.32;

/** wet land cells (any RP) within km of a point, nearest first */
export function wetCellsNear(grid: FloodGrid, lon: number, lat: number, km: number) {
  const col = Math.floor((lon - grid.x0) / grid.d);
  const row = Math.floor((grid.y0 - lat) / grid.d);
  const reach = Math.ceil(km / (grid.d * 111.32)) + 1;
  const out: { lon: number; lat: number; km: number; d100: number; key: string }[] = [];
  for (let dr = -reach; dr <= reach; dr++)
    for (let dc = -reach; dc <= reach; dc++) {
      const k = `${row + dr},${col + dc}`;
      const v = grid.cells.get(k);
      if (!v || grid.water.has(k)) continue;
      const cx = grid.x0 + (col + dc + 0.5) * grid.d;
      const cy = grid.y0 - (row + dr + 0.5) * grid.d;
      const dist = kmBetween(cx, cy, lon, lat);
      if (dist <= km) out.push({ lon: cx, lat: cy, km: dist, d100: v[100], key: k });
    }
  return out.sort((a, b) => a.km - b.km);
}

/** distance to the nearest mapped flood-plain cell (null if none within km) */
export function nearestWetKm(grid: FloodGrid, lon: number, lat: number, km = 25): number | null {
  const w = wetCellsNear(grid, lon, lat, km);
  return w.length ? w[0].km : null;
}

/** deterministic jitter so the same answer always lands the same way */
function rand(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Where each building of a group stands, given its anchor place and how the text sites it:
 *   riverside  - on the mapped flood-plain cells nearest the anchor (within 25 km), a few per cell
 *   floodplain - spread over the wet cells within 10 km of the anchor
 *   away_from_river - round the anchor, skipping wet cells and water
 *   as_placed  - a spiral round the anchor (the default; skips water)
 * Returns the spots and a sentence saying what was done.
 */
export function siteGroup(grid: FloodGrid, anchor: { lon: number; lat: number }, count: number, siting: Siting, seed: number, approx: boolean) {
  const spots: { lon: number; lat: number }[] = [];
  const onWaterAt = (lon: number, lat: number) => grid.water.has(`${Math.floor((grid.y0 - lat) / grid.d)},${Math.floor((lon - grid.x0) / grid.d)}`);
  const wetAt = (lon: number, lat: number) => grid.cells.has(`${Math.floor((grid.y0 - lat) / grid.d)},${Math.floor((lon - grid.x0) / grid.d)}`);
  if (siting === "riverside" || siting === "floodplain") {
    const pool = wetCellsNear(grid, anchor.lon, anchor.lat, siting === "riverside" ? 25 : 10);
    if (pool.length) {
      // riverside: the nearest cells along the river; floodplain: any wet cell in reach
      const cells = siting === "riverside" ? pool.slice(0, Math.max(2, Math.ceil(count / 3))) : pool;
      for (let i = 0; i < count; i++) {
        const c = cells[siting === "riverside" ? i % cells.length : Math.floor(rand(seed + i) * cells.length)];
        const jx = (rand(seed + i * 7.1) - 0.5) * grid.d * 0.8;
        const jy = (rand(seed + i * 3.7) - 0.5) * grid.d * 0.8;
        spots.push({ lon: c.lon + jx, lat: c.lat + jy });
      }
      const first = pool[0];
      const note =
        first.km < 0.7
          ? `on the mapped flood plain at the place`
          : `on the nearest mapped flood plain, ${first.km.toFixed(1)} km from the named place`;
      return { spots, note, mappedKm: first.km };
    }
    // no mapped flood plain in reach: place round the anchor and say so
  }
  const step = approx ? 260 : 120;
  const reach = approx ? 2500 : 900;
  let k = 0;
  for (let i = 0; i < count; i++) {
    let lat = anchor.lat;
    let lon = anchor.lon;
    for (let tries = 0; tries < 80; tries++, k++) {
      const r = Math.min(step * Math.sqrt(k + 1), reach);
      const ang = k * 2.39996;
      lat = anchor.lat + (r * Math.cos(ang)) / 111_320;
      lon = anchor.lon + (r * Math.sin(ang)) / (111_320 * Math.cos((anchor.lat * Math.PI) / 180));
      if (!onWaterAt(lon, lat) && !(siting === "away_from_river" && wetAt(lon, lat))) break;
    }
    k++;
    spots.push({ lon, lat });
  }
  const mapped = nearestWetKm(grid, anchor.lon, anchor.lat);
  const note =
    siting === "riverside" || siting === "floodplain"
      ? `no mapped flood plain within ${siting === "riverside" ? 25 : 10} km: placed round the named place (the JRC maps model the larger rivers only)`
      : siting === "away_from_river"
        ? "away from the mapped flood plain"
        : mapped === null
          ? "no mapped flood plain within 25 km"
          : `nearest mapped flood plain ${mapped.toFixed(1)} km away`;
  return { spots, note, mappedKm: mapped };
}

/** the buildings of a batch whose region lies outside the Nzoia window */
export const outsideNzoia = (bs: BuildingProps[]) => bs.some((b) => !inNzoia(b.lon, b.lat));
export { inNzoia };

export type KenyaFloodFC = FeatureCollection<Polygon>;

let placesOnce: Promise<KenyaPlace[]> | null = null;
/** the Kenya-wide gazetteer, fetched once */
export function loadKenyaPlaces(): Promise<KenyaPlace[]> {
  placesOnce ??= fetch("/data/kenya_places.json").then((r) => {
    if (!r.ok) throw new Error(`kenya_places.json: ${r.status}`);
    return r.json() as Promise<KenyaPlace[]>;
  });
  placesOnce.catch(() => (placesOnce = null));
  return placesOnce;
}
