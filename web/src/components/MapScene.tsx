import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { ExpressionSpecification, StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import type { BuildingProps, ColourMode, Place, PortfolioView } from "../lib/types";
import type { Theme } from "../lib/theme";
import { RPS } from "../lib/types";
import { CURVES, HUIZINGA_AFRICA, ONSET_RP } from "../lib/engine";
import { CLASS_COLOUR, DAMAGE_STOPS, DEPTH_STOPS, ISSUE_COLOUR } from "../lib/format";

// MapLibre v6 resolves its worker relative to its own module URL, which bundlers rewrite; point it at the emitted asset
maplibregl.setWorkerUrl(workerUrl);

/** metres of water column drawn per metre of flood depth (display only) */
export const WATER_EXAGGERATION = 220;
export const TERRAIN_EXAGGERATION = 1.6;
/** half the side of the symbolic building squares (600 m squares) */
const FOOTPRINT_HALF_M = 300;
export const AI_COLOUR = "#22d3ee";
/** buildings added through the AI intake: bright cyan so they read as new on the map */
export const NEW_COLOUR = "#67e8f9";

export type CameraPreset = "basin" | "floodplain" | "tour" | "node";

const VIEWS = {
  basin: { center: [34.42, 0.36] as [number, number], zoom: 8.55, pitch: 58, bearing: -14 },
  floodplain: { center: [34.05, 0.11] as [number, number], zoom: 11.1, pitch: 66, bearing: 28 },
  node: { center: [34.075, 0.115] as [number, number], zoom: 11.6, pitch: 68, bearing: 50 },
  elgon: { center: [34.56, 1.06] as [number, number], zoom: 10.2, pitch: 72, bearing: 205 },
  webuye: { center: [34.62, 0.55] as [number, number], zoom: 9.6, pitch: 66, bearing: 220 },
};

/** phones see less of the basin and lose the bottom ~220 px to the sheet: zoom out and pad the camera */
function fit(v: (typeof VIEWS)[keyof typeof VIEWS]) {
  const narrow = typeof window !== "undefined" && window.innerWidth < 640;
  return narrow ? { ...v, zoom: v.zoom - 1.15, padding: { top: 110, bottom: 200, left: 0, right: 0 } } : v;
}

/** what changes on the map between dark and light mode (the satellite image stays; sky, fog and grading change) */
const LOOK = {
  dark: {
    background: "#000418",
    brightness: 0.78,
    saturation: -0.3,
    shadow: "#01031a",
    highlight: "#94a3b8",
    sky: { "sky-color": "#08103f", "horizon-color": "#1c2c8f", "fog-color": "#040929" },
  },
  light: {
    background: "#e2e6f8",
    brightness: 0.97,
    saturation: -0.08,
    shadow: "#334155",
    highlight: "#ffffff",
    sky: { "sky-color": "#90a2ff", "horizon-color": "#e8ebff", "fog-color": "#eef0fc" },
  },
} as const;

function skyFor(theme: Theme): StyleSpecification["sky"] {
  return {
    ...LOOK[theme].sky,
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.55,
    "fog-ground-blend": 0.82,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7.5, 0],
  };
}

const styleFor = (theme: Theme): StyleSpecification => ({
  version: 8,
  projection: { type: "globe" },
  sources: {
    satellite: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 18,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
    terrainDem: {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 13,
      attribution: "Terrain: Mapzen / AWS Terrain Tiles",
    },
    hillDem: {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 13,
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": LOOK[theme].background } },
    { id: "satellite", type: "raster", source: "satellite", paint: { "raster-saturation": LOOK[theme].saturation, "raster-brightness-max": LOOK[theme].brightness, "raster-contrast": 0.08 } },
    {
      id: "hillshade",
      type: "hillshade",
      source: "hillDem",
      paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": LOOK[theme].shadow, "hillshade-highlight-color": LOOK[theme].highlight },
    },
  ],
  sky: skyFor(theme),
  terrain: { source: "terrainDem", exaggeration: TERRAIN_EXAGGERATION },
});

const num = (key: string): ExpressionSpecification => ["to-number", ["get", key], 0];

/** depth at any return period, as a style expression - the same rule as depthAtRp() in lib/engine.ts */
function depthExprAt(rp: number): ExpressionSpecification {
  const first = RPS[0];
  const last = RPS[RPS.length - 1];
  if (rp <= ONSET_RP) return ["*", num(`d${first}`), 0];
  if (rp < first) return ["*", num(`d${first}`), Math.log(rp / ONSET_RP) / Math.log(first / ONSET_RP)];
  if (rp >= last) return num(`d${last}`);
  for (let i = 0; i < RPS.length - 1; i++) {
    const a = RPS[i];
    const b = RPS[i + 1];
    if (rp >= a && rp <= b) {
      const t = Math.log(rp / a) / Math.log(b / a);
      return ["+", ["*", num(`d${a}`), 1 - t], ["*", num(`d${b}`), t]];
    }
  }
  return num(`d${last}`);
}

const classMatch = (pick: (k: number, cap: number) => number): ExpressionSpecification =>
  ["match", ["get", "cls"], ...Object.entries(CURVES).flatMap(([c, v]) => [c, pick(v.k, v.cap)]), 1] as unknown as ExpressionSpecification;

/** damage ratio = cap x Huizinga(k x depth), evaluated on the GPU - the same curves as damageRatio() */
function drExpr(depth: ExpressionSpecification): ExpressionSpecification {
  return ["*", classMatch((_k, cap) => cap), ["interpolate", ["linear"], ["*", depth, classMatch((k) => k)], ...HUIZINGA_AFRICA.flat()]] as unknown as ExpressionSpecification;
}

function ramp(input: ExpressionSpecification, stops: [number, string][]): ExpressionSpecification {
  return ["interpolate", ["linear"], input, ...stops.flat()] as unknown as ExpressionSpecification;
}

function buildingColour(mode: ColourMode, rp: number, showIssues: boolean): ExpressionSpecification {
  const base: ExpressionSpecification =
    mode === "class"
      ? [
          "match",
          ["get", "cls"],
          "informal_iron_sheet", CLASS_COLOUR.informal_iron_sheet,
          "semi_permanent", CLASS_COLOUR.semi_permanent,
          "permanent_masonry", CLASS_COLOUR.permanent_masonry,
          "concrete_rcc", CLASS_COLOUR.concrete_rcc,
          "#94a3b8",
        ]
      : ramp(drExpr(depthExprAt(rp)), DAMAGE_STOPS);
  const withNew: ExpressionSpecification = mode === "class" ? ["case", ["==", ["get", "src"], "ai"], NEW_COLOUR, base] : base;
  return showIssues ? ["case", ["!=", ["get", "where"], "KE"], ISSUE_COLOUR, withNew] : withNew;
}

/** height ~ log(value): KES 45k -> ~300 m, KES 72M -> ~3 km (display only) */
const BASE_HEIGHT: ExpressionSpecification = ["*", ["max", ["-", ["log10", ["max", num("tiv"), 1]], 4.3], 0.25], 850];
/** document sites have real-ish footprints (b.half), so their pillars are kept lower than the 600 m symbolic squares */
const BUILDING_HEIGHT: ExpressionSpecification = ["case", ["has", "half"], ["*", BASE_HEIGHT, 0.3], BASE_HEIGHT];

function toPoints(fc: FeatureCollection<Polygon, BuildingProps>): FeatureCollection<Point, BuildingProps> {
  return {
    type: "FeatureCollection",
    features: fc.features.map(
      (f): Feature<Point, BuildingProps> => ({ type: "Feature", properties: f.properties, geometry: { type: "Point", coordinates: [f.properties.lon, f.properties.lat] } }),
    ),
  };
}

export interface NodeMarkerState {
  live: boolean;
  label: string; // e.g. "4.51 m · Warning"
  tone: "ok" | "amber" | "red" | "danger";
}

interface Props {
  buildings: FeatureCollection<Polygon, BuildingProps>;
  places: Place[];
  /** return period the water shows; continuous in live mode */
  waterRp: number;
  live: boolean;
  colourMode: ColourMode;
  showIssues: boolean;
  portfolio: PortfolioView;
  selectedId: string | null;
  camera: { preset: CameraPreset; nonce: number } | null;
  nodeState: NodeMarkerState;
  theme: Theme;
  onSelect: (b: BuildingProps | null) => void;
  /** called once the opening zoom-in lands, unless the viewer already took over the camera */
  onIntroDone?: () => void;
}

export default function MapScene(props: Props) {
  const { buildings, places, waterRp, live, colourMode, showIssues, portfolio, selectedId, camera, nodeState, theme } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState<maplibregl.Map | null>(null); // the map instance whose style has loaded
  const shownRp = useRef<number>(waterRp);
  const nodeEl = useRef<HTMLDivElement | null>(null);
  const onSelect = useRef(props.onSelect);
  onSelect.current = props.onSelect;
  const onIntroDone = useRef(props.onIntroDone);
  onIntroDone.current = props.onIntroDone;
  const userMoved = useRef(false);
  const initialBuildings = useRef(buildings);
  const initialTheme = useRef(theme);
  const buildingsRef = useRef(buildings);
  buildingsRef.current = buildings;

  // ---- create map once ----
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: styleFor(initialTheme.current),
      center: [24, 3],
      zoom: 1.7,
      pitch: 0,
      maxPitch: 80,
      attributionControl: false,
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __map: maplibregl.Map }).__map = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    // phones: start with just the "i" - the imagery credits open on tap instead of covering the map.
    // MapLibre expands the control when the first credits arrive, so close it at that moment, once.
    const attrib = map.getContainer().querySelector(".maplibregl-ctrl-attrib");
    if (attrib && matchMedia("(max-width: 1023px)").matches) {
      const closeOnce = new MutationObserver(() => {
        if (!attrib.classList.contains("maplibregl-compact-show")) return;
        attrib.classList.remove("maplibregl-compact-show");
        closeOnce.disconnect();
      });
      closeOnce.observe(attrib, { attributes: true, attributeFilter: ["class"] });
    }

    const markers: maplibregl.Marker[] = [];
    let cancelled = false;
    // any drag, scroll or tap means the viewer is driving: never start or continue an automatic flight after that
    const tookOver = () => (userMoved.current = true);
    const canvasBox = map.getCanvasContainer();
    for (const ev of ["pointerdown", "wheel", "touchstart"]) canvasBox.addEventListener(ev, tookOver, { passive: true });
    const startRp = shownRp.current;

    // style.load (not load): start as soon as the style is ready instead of waiting for every tile on a slow network
    map.once("style.load", () => {
      if (cancelled) return; // a removed instance (React StrictMode mounts twice in dev) must never become "ready"
      map.addSource("border", { type: "geojson", data: "/data/border.geojson" });
      map.addSource("river", { type: "geojson", data: "/data/river.geojson" });
      map.addSource("flood", { type: "geojson", data: "/data/flood_cells.geojson" });
      map.addSource("buildings", { type: "geojson", data: initialBuildings.current });
      map.addSource("building-points", { type: "geojson", data: toPoints(initialBuildings.current) });

      const d = depthExprAt(startRp);
      map.addLayer({ id: "border", type: "line", source: "border", paint: { "line-color": "#e2e8f0", "line-opacity": 0.55, "line-width": 1.2, "line-dasharray": [3, 2] } });
      // permanent water (river channel, lake edge): flat, never extruded as flood
      map.addLayer({ id: "perm-water", type: "fill", source: "flood", filter: ["has", "pw"], paint: { "fill-color": "#2b7bb9", "fill-opacity": 0.42 } });
      map.addLayer({ id: "flood-fill", type: "fill", source: "flood", filter: ["!", ["has", "pw"]], paint: { "fill-color": ramp(d, DEPTH_STOPS), "fill-opacity": ["case", [">", d, 0.01], 0.32, 0] } });
      map.addLayer({ id: "river-glow", type: "line", source: "river", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#38bdf8", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 5, 12, 14], "line-blur": 6, "line-opacity": 0.45 } });
      map.addLayer({ id: "river-core", type: "line", source: "river", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#bae6fd", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 1.1, 12, 3], "line-opacity": 0.9 } });
      map.addLayer({
        id: "building-glow",
        type: "circle",
        source: "building-points",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 2, 9, 4, 12, 9],
          "circle-color": buildingColour(colourMode, startRp, showIssues && portfolio === "starter"),
          "circle-blur": 0.55,
          "circle-opacity": 0.85,
          "circle-pitch-alignment": "map",
        },
      });
      map.addLayer({
        id: "issue-ring",
        type: "circle",
        source: "building-points",
        filter: ["!=", ["get", "where"], "KE"],
        layout: { visibility: showIssues && portfolio === "starter" ? "visible" : "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4, 9, 7, 12, 16],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": ISSUE_COLOUR,
          "circle-stroke-width": 1.3,
          "circle-stroke-opacity": 0.85,
          "circle-pitch-alignment": "map",
        },
      });
      map.addLayer({
        id: "ai-ring",
        type: "circle",
        source: "building-points",
        filter: ["==", ["get", "src"], "ai"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 5, 9, 9, 12, 18],
          "circle-color": "rgba(34,211,238,0.12)",
          "circle-stroke-color": AI_COLOUR,
          "circle-stroke-width": 2,
          "circle-pitch-alignment": "map",
        },
      });
      map.addLayer({
        id: "water",
        type: "fill-extrusion",
        source: "flood",
        paint: {
          "fill-extrusion-color": ramp(d, DEPTH_STOPS),
          "fill-extrusion-height": ["*", d, WATER_EXAGGERATION],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.78,
        },
      });
      map.setFilter("water", ["all", ["!", ["has", "pw"]], [">", d, 0.01]]);
      map.addLayer({
        id: "buildings",
        type: "fill-extrusion",
        source: "buildings",
        paint: {
          "fill-extrusion-color": buildingColour(colourMode, startRp, showIssues && portfolio === "starter"),
          "fill-extrusion-height": BUILDING_HEIGHT,
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.95,
        },
      });
      map.addLayer({ id: "building-selected", type: "line", source: "buildings", filter: ["==", ["get", "id"], ""], paint: { "line-color": "#ffffff", "line-width": 3 } });

      // Rendered-feature queries don't hit fill-extrusions over terrain, so hit-test the pillars in screen space:
      // project each base, estimate the pillar's on-screen height, and take the one nearest the camera.
      const pickAt = (pt: maplibregl.Point): BuildingProps | null => {
        const ground = map.queryRenderedFeatures([[pt.x - 5, pt.y - 5], [pt.x + 5, pt.y + 5]], { layers: ["building-glow"] });
        if (ground.length) return ground[0].properties as BuildingProps;
        const sinPitch = Math.sin((map.getPitch() * Math.PI) / 180);
        const scale = 2 ** map.getZoom();
        let best: { b: BuildingProps; y: number } | null = null;
        for (const f of buildingsRef.current.features) {
          const b = f.properties;
          const base = map.project([b.lon, b.lat]);
          const mpp = (78271.517 * Math.cos((b.lat * Math.PI) / 180)) / scale;
          const heightPx = (Math.max(Math.log10(Math.max(b.tiv, 1)) - 4.3, 0.25) * 850 * (b.half ? 0.3 : 1) * sinPitch) / mpp;
          const halfWidthPx = Math.max(4, (Number(b.half) || FOOTPRINT_HALF_M) / mpp);
          if (Math.abs(pt.x - base.x) <= halfWidthPx + 3 && pt.y <= base.y + 4 && pt.y >= base.y - heightPx - 4 && (!best || base.y > best.y)) {
            best = { b, y: base.y };
          }
        }
        return best?.b ?? null;
      };
      map.on("click", (e) => onSelect.current(pickAt(e.point)));
      let hoverQueued = false;
      map.on("mousemove", (e) => {
        if (hoverQueued) return;
        hoverQueued = true;
        requestAnimationFrame(() => {
          hoverQueued = false;
          map.getCanvas().style.cursor = pickAt(e.point) ? "pointer" : "";
        });
      });

      setReady(map);
      map.flyTo({ ...fit(VIEWS.basin), duration: 7500, curve: 1.45, essential: true });
      map.once("moveend", () => {
        if (cancelled) return;
        for (const p of places) {
          const el = document.createElement("div");
          el.className = `place place-${p.kind}`;
          if (p.kind === "node") {
            el.innerHTML = `<span class="node-pulse"></span><span class="place-dot"></span><span class="place-label">River node · ${p.name}<span class="node-reading"></span></span>`;
            nodeEl.current = el;
          } else {
            el.innerHTML = `<span class="place-dot"></span><span class="place-label">${p.name}</span>`;
          }
          markers.push(new maplibregl.Marker({ element: el, anchor: "left" }).setLngLat([p.lon, p.lat]).addTo(map));
        }
        if (!userMoved.current) onIntroDone.current?.();
      });
    });

    return () => {
      cancelled = true;
      markers.forEach((m) => m.remove());
      nodeEl.current = null;
      map.remove();
      mapRef.current = null;
      setReady(null);
    };
    // the map is created once; later prop changes are applied by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places]);

  // ---- swap portfolios / AI rows without rebuilding the map ----
  useEffect(() => {
    const map = ready;
    if (!map) return;
    map.getSource<maplibregl.GeoJSONSource>("buildings")?.setData(buildings);
    map.getSource<maplibregl.GeoJSONSource>("building-points")?.setData(toPoints(buildings));
  }, [buildings, ready]);

  // ---- AI additions read as new: a NEW tag per approved group, the newest batch grows out of the ground ----
  const grownBatch = useRef(0);
  useEffect(() => {
    const map = ready;
    if (!map) return;
    const groups = new Map<string, { n: number; lon: number; lat: number; place: string; batch: number }>();
    for (const f of buildings.features) {
      const b = f.properties;
      if (b.src !== "ai") continue;
      const batch = Number(b.batch) || 0;
      const key = `${batch}|${b.settlement}`;
      const g = groups.get(key) ?? { n: 0, lon: 0, lat: 0, place: String(b.settlement ?? ""), batch };
      g.n++;
      g.lon += b.lon;
      g.lat += b.lat;
      groups.set(key, g);
    }
    const tags = [...groups.values()].map((g) => {
      const el = document.createElement("div");
      el.className = "new-tag";
      el.innerHTML = `<span class="new-tag-pill">NEW</span><span class="new-tag-label">+${g.n} · ${g.place}</span>`;
      return new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -18] }).setLngLat([g.lon / g.n, g.lat / g.n]).addTo(map);
    });

    // grow the newest batch from the ground once, after the camera has had time to arrive
    const latest = Math.max(0, ...[...groups.values()].map((g) => g.batch));
    let raf = 0;
    let timer = 0;
    if (latest > grownBatch.current) {
      grownBatch.current = latest;
      const isNew: ExpressionSpecification = ["==", ["to-number", ["get", "batch"]], latest];
      const setGrow = (f: number) => map.setPaintProperty("buildings", "fill-extrusion-height", f >= 1 ? BUILDING_HEIGHT : ["case", isNew, ["*", BUILDING_HEIGHT, f], BUILDING_HEIGHT]);
      setGrow(0);
      timer = window.setTimeout(() => {
        const t0 = performance.now();
        const step = (now: number) => {
          const t = Math.min((now - t0) / 1400, 1);
          const back = 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2; // ease-out with a small overshoot
          setGrow(t >= 1 ? 1 : Math.max(back, 0));
          if (t < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      }, 900);
    }
    return () => {
      tags.forEach((m) => m.remove());
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      if (map.style) map.setPaintProperty("buildings", "fill-extrusion-height", BUILDING_HEIGHT);
    };
  }, [buildings, ready]);

  // ---- AI rings pulse while there are AI additions ----
  const hasAi = buildings.features.some((f) => f.properties.src === "ai");
  useEffect(() => {
    const map = ready;
    if (!map || !hasAi) return;
    let raf = 0;
    const tick = (ts: number) => {
      const s = 0.5 + 0.5 * Math.sin(ts / 380);
      map.setPaintProperty("ai-ring", "circle-stroke-opacity", 0.4 + 0.6 * s);
      map.setPaintProperty("ai-ring", "circle-radius", ["interpolate", ["linear"], ["zoom"], 6, 5 + 3 * s, 9, 9 + 5 * s, 12, 18 + 9 * s]);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hasAi, ready]);

  // ---- water level: animate in log(return period) from what is shown to the new value ----
  useEffect(() => {
    const map = ready;
    if (!map) return;
    const from = shownRp.current;
    const to = waterRp;
    const issues = showIssues && portfolio === "starter";
    // zero-height extrusions still draw a flat top, so hide cells that are dry at the shown return period;
    // during an animation keep every cell that is wet at either end, then tighten at the last frame
    const setWet = (rp: number) => map.setFilter("water", ["all", ["!", ["has", "pw"]], [">", depthExprAt(rp), 0.01]]);
    setWet(Math.max(from, to));
    const apply = (rp: number) => {
      const d = depthExprAt(rp);
      map.setPaintProperty("water", "fill-extrusion-height", ["*", d, WATER_EXAGGERATION]);
      map.setPaintProperty("water", "fill-extrusion-color", ramp(d, DEPTH_STOPS));
      map.setPaintProperty("flood-fill", "fill-color", ramp(d, DEPTH_STOPS));
      map.setPaintProperty("flood-fill", "fill-opacity", ["case", [">", d, 0.01], 0.32, 0]);
      if (colourMode === "damage") {
        const c = buildingColour(colourMode, rp, issues);
        map.setPaintProperty("buildings", "fill-extrusion-color", c);
        map.setPaintProperty("building-glow", "circle-color", c);
      }
    };
    if (Math.abs(Math.log(from) - Math.log(to)) < 1e-6) {
      apply(to);
      setWet(to);
      return;
    }
    let raf = 0;
    let start = 0;
    const duration = live ? 450 : 1200;
    const lf = Math.log(Math.max(from, 1.01));
    const lt = Math.log(Math.max(to, 1.01));
    const step = (ts: number) => {
      if (!start) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const rp = Math.exp(lf + (lt - lf) * e);
      shownRp.current = rp;
      apply(rp);
      if (t < 1) raf = requestAnimationFrame(step);
      else {
        shownRp.current = to;
        setWet(to);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // colour inputs are handled by the next effect; here they only matter mid-animation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waterRp, ready]);

  // ---- building colours, issue rings (the starter CSV is the only portfolio with location issues) ----
  useEffect(() => {
    const map = ready;
    if (!map) return;
    const issues = showIssues && portfolio === "starter";
    const colour = buildingColour(colourMode, shownRp.current, issues);
    map.setPaintProperty("buildings", "fill-extrusion-color", colour);
    map.setPaintProperty("building-glow", "circle-color", colour);
    map.setLayoutProperty("issue-ring", "visibility", issues ? "visible" : "none");
  }, [colourMode, showIssues, portfolio, ready]);

  // ---- pulse the issue rings ----
  useEffect(() => {
    const map = ready;
    if (!map || !showIssues || portfolio !== "starter") return;
    let raf = 0;
    const tick = (ts: number) => {
      const s = 0.5 + 0.5 * Math.sin(ts / 420);
      map.setPaintProperty("issue-ring", "circle-stroke-opacity", 0.35 + 0.6 * s);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [showIssues, portfolio, ready]);

  // ---- light / dark mode on the map ----
  useEffect(() => {
    const map = ready;
    if (!map) return;
    const l = LOOK[theme];
    map.setSky(skyFor(theme) as NonNullable<StyleSpecification["sky"]>);
    map.setPaintProperty("bg", "background-color", l.background);
    map.setPaintProperty("satellite", "raster-brightness-max", l.brightness);
    map.setPaintProperty("satellite", "raster-saturation", l.saturation);
    map.setPaintProperty("hillshade", "hillshade-shadow-color", l.shadow);
    map.setPaintProperty("hillshade", "hillshade-highlight-color", l.highlight);
  }, [theme, ready]);

  // ---- river node marker shows the live reading ----
  useEffect(() => {
    const el = nodeEl.current;
    if (!el) return;
    el.dataset.tone = nodeState.live ? nodeState.tone : "";
    const reading = el.querySelector(".node-reading");
    if (reading) reading.textContent = nodeState.live ? ` · ${nodeState.label}` : "";
  }, [nodeState, ready]);

  // ---- selection ----
  useEffect(() => {
    const map = ready;
    if (!map) return;
    map.setFilter("building-selected", ["==", ["get", "id"], selectedId ?? ""]);
    if (!selectedId) return;
    const f = buildingsRef.current.features.find((x) => x.properties.id === selectedId);
    // a document site's buildings are a few hundred metres across: come in closer
    if (f) map.easeTo({ center: [f.properties.lon, f.properties.lat], zoom: Math.max(map.getZoom(), f.properties.half ? 14.2 : 10.4), pitch: 62, duration: 1300 });
  }, [selectedId, ready]);

  // ---- camera presets ----
  useEffect(() => {
    const map = ready;
    if (!map || !camera) return;
    let stop = false;
    // the tour is a sequence of flights: a drag, scroll or tap halts it where it is
    const box = map.getCanvasContainer();
    const halt = () => {
      if (stop) return;
      stop = true;
      map.stop();
    };
    const run = async () => {
      if (camera.preset !== "tour") {
        map.flyTo({ ...fit(VIEWS[camera.preset]), duration: 3200, essential: true });
        return;
      }
      for (const ev of ["pointerdown", "wheel", "touchstart"]) box.addEventListener(ev, halt, { passive: true });
      for (const v of [VIEWS.elgon, VIEWS.webuye, VIEWS.floodplain]) {
        if (stop) return;
        map.flyTo({ ...fit(v), duration: 4200, curve: 1.2, essential: true });
        await map.once("moveend");
      }
    };
    void run();
    return () => {
      stop = true;
      for (const ev of ["pointerdown", "wheel", "touchstart"]) box.removeEventListener(ev, halt);
    };
  }, [camera, ready]);

  // maplibre-gl.css forces position:relative on the map element (and beats Tailwind's layered utilities), so size it via a wrapper
  return (
    <div className="absolute inset-0">
      <div ref={container} style={{ width: "100%", height: "100%" }} aria-label="3D map of the Nzoia basin" />
    </div>
  );
}
