import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { ExpressionSpecification, StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import type { BuildingProps, ColourMode, Place, PortfolioView, RP } from "../lib/types";
import { CLASS_COLOUR, DAMAGE_STOPS, DEPTH_STOPS, ISSUE_COLOUR } from "../lib/format";

// MapLibre v6 resolves its worker relative to its own module URL, which bundlers rewrite; point it at the emitted asset
maplibregl.setWorkerUrl(workerUrl);

/** metres of water column drawn per metre of flood depth (display only) */
export const WATER_EXAGGERATION = 220;
export const TERRAIN_EXAGGERATION = 1.6;
/** half the side of the symbolic building squares written by scripts/prepare_3d_data.py (FOOTPRINT_M = 600) */
const FOOTPRINT_HALF_M = 300;

export type CameraPreset = "basin" | "floodplain" | "tour";

const VIEWS = {
  basin: { center: [34.42, 0.36] as [number, number], zoom: 8.55, pitch: 58, bearing: -14 },
  floodplain: { center: [34.05, 0.11] as [number, number], zoom: 11.1, pitch: 66, bearing: 28 },
  elgon: { center: [34.56, 1.06] as [number, number], zoom: 10.2, pitch: 72, bearing: 205 },
  webuye: { center: [34.62, 0.55] as [number, number], zoom: 9.6, pitch: 66, bearing: 220 },
};

/** phones see less of the basin and lose the bottom ~220 px to the sheet: zoom out and pad the camera */
function fit(v: (typeof VIEWS)[keyof typeof VIEWS]) {
  const narrow = typeof window !== "undefined" && window.innerWidth < 640;
  return narrow ? { ...v, zoom: v.zoom - 1.15, padding: { top: 110, bottom: 200, left: 0, right: 0 } } : v;
}

const STYLE: StyleSpecification = {
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
    { id: "bg", type: "background", paint: { "background-color": "#050b14" } },
    { id: "satellite", type: "raster", source: "satellite", paint: { "raster-saturation": -0.3, "raster-brightness-max": 0.78, "raster-contrast": 0.08 } },
    {
      id: "hillshade",
      type: "hillshade",
      source: "hillDem",
      paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#020617", "hillshade-highlight-color": "#94a3b8" },
    },
  ],
  sky: {
    "sky-color": "#0b1d3a",
    "horizon-color": "#1f3b63",
    "fog-color": "#0a1424",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.55,
    "fog-ground-blend": 0.82,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7.5, 0],
  },
  terrain: { source: "terrainDem", exaggeration: TERRAIN_EXAGGERATION },
};

const num = (key: string): ExpressionSpecification => ["to-number", ["get", key], 0];

function depthAt(a: RP, b: RP, t: number): ExpressionSpecification {
  if (a === b || t >= 1) return num(`d${b}`);
  if (t <= 0) return num(`d${a}`);
  return ["+", ["*", num(`d${a}`), 1 - t], ["*", num(`d${b}`), t]];
}

function ramp(input: ExpressionSpecification, stops: [number, string][]): ExpressionSpecification {
  return ["interpolate", ["linear"], input, ...stops.flat()] as unknown as ExpressionSpecification;
}

function buildingColour(mode: ColourMode, rp: RP, showIssues: boolean): ExpressionSpecification {
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
      : ramp(num(`dr${rp}`), DAMAGE_STOPS);
  return showIssues ? ["case", ["!=", ["get", "where"], "KE"], ISSUE_COLOUR, base] : base;
}

/** height ~ log(value): KES 45k -> ~300 m, KES 72M -> ~3 km (display only) */
const BUILDING_HEIGHT: ExpressionSpecification = ["*", ["max", ["-", ["log10", ["max", num("tiv"), 1]], 4.3], 0.25], 850];

function toPoints(fc: FeatureCollection<Polygon, BuildingProps>): FeatureCollection<Point, BuildingProps> {
  return {
    type: "FeatureCollection",
    features: fc.features.map(
      (f): Feature<Point, BuildingProps> => ({ type: "Feature", properties: f.properties, geometry: { type: "Point", coordinates: [f.properties.lon, f.properties.lat] } }),
    ),
  };
}

interface Props {
  buildings: FeatureCollection<Polygon, BuildingProps>;
  places: Place[];
  rp: RP;
  colourMode: ColourMode;
  showIssues: boolean;
  portfolio: PortfolioView;
  selectedId: string | null;
  camera: { preset: CameraPreset; nonce: number } | null;
  onSelect: (b: BuildingProps | null) => void;
  onIntroDone: () => void;
}

export default function MapScene(props: Props) {
  const { buildings, places, rp, colourMode, showIssues, portfolio, selectedId, camera } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState<maplibregl.Map | null>(null); // the map instance whose style has loaded
  const shownRp = useRef<RP>(rp);
  const callbacks = useRef({ onSelect: props.onSelect, onIntroDone: props.onIntroDone });
  callbacks.current = { onSelect: props.onSelect, onIntroDone: props.onIntroDone };
  const initialBuildings = useRef(buildings);
  const buildingsRef = useRef(buildings);
  buildingsRef.current = buildings;

  // ---- create map once ----
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: STYLE,
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

    const markers: maplibregl.Marker[] = [];
    let cancelled = false;

    // style.load (not load): start as soon as the style is ready instead of waiting for every tile on a slow network
    map.once("style.load", () => {
      map.addSource("border", { type: "geojson", data: "/data/border.geojson" });
      map.addSource("river", { type: "geojson", data: "/data/river.geojson" });
      map.addSource("flood", { type: "geojson", data: "/data/flood_cells.geojson" });
      map.addSource("buildings", { type: "geojson", data: initialBuildings.current });
      map.addSource("building-points", { type: "geojson", data: toPoints(initialBuildings.current) });

      map.addLayer({ id: "border", type: "line", source: "border", paint: { "line-color": "#e2e8f0", "line-opacity": 0.55, "line-width": 1.2, "line-dasharray": [3, 2] } });
      map.addLayer({ id: "flood-fill", type: "fill", source: "flood", paint: { "fill-color": ramp(depthAt(rp, rp, 1), DEPTH_STOPS), "fill-opacity": 0.3 } });
      map.addLayer({ id: "river-glow", type: "line", source: "river", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#38bdf8", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 5, 12, 14], "line-blur": 6, "line-opacity": 0.45 } });
      map.addLayer({ id: "river-core", type: "line", source: "river", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#bae6fd", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 1.1, 12, 3], "line-opacity": 0.9 } });
      map.addLayer({
        id: "building-glow",
        type: "circle",
        source: "building-points",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 2, 9, 4, 12, 9],
          "circle-color": buildingColour(colourMode, rp, showIssues && portfolio === "starter"),
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
        id: "water",
        type: "fill-extrusion",
        source: "flood",
        paint: {
          "fill-extrusion-color": ramp(depthAt(rp, rp, 1), DEPTH_STOPS),
          "fill-extrusion-height": ["*", depthAt(rp, rp, 1), WATER_EXAGGERATION],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.78,
        },
      });
      map.addLayer({
        id: "buildings",
        type: "fill-extrusion",
        source: "buildings",
        paint: {
          "fill-extrusion-color": buildingColour(colourMode, rp, showIssues && portfolio === "starter"),
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
          const heightPx = (Math.max(Math.log10(Math.max(b.tiv, 1)) - 4.3, 0.25) * 850 * sinPitch) / mpp;
          const halfWidthPx = Math.max(4, FOOTPRINT_HALF_M / mpp);
          if (Math.abs(pt.x - base.x) <= halfWidthPx + 3 && pt.y <= base.y + 4 && pt.y >= base.y - heightPx - 4 && (!best || base.y > best.y)) {
            best = { b, y: base.y };
          }
        }
        return best?.b ?? null;
      };
      map.on("click", (e) => callbacks.current.onSelect(pickAt(e.point)));
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
          el.innerHTML =
            p.kind === "node"
              ? `<span class="node-pulse"></span><span class="place-dot"></span><span class="place-label">River node · ${p.name}</span>`
              : `<span class="place-dot"></span><span class="place-label">${p.name}</span>`;
          markers.push(new maplibregl.Marker({ element: el, anchor: "left" }).setLngLat([p.lon, p.lat]).addTo(map));
        }
        callbacks.current.onIntroDone();
      });
    });

    return () => {
      cancelled = true;
      markers.forEach((m) => m.remove());
      map.remove();
      mapRef.current = null;
      setReady(null);
    };
    // the map is created once; later prop changes are applied by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places]);

  // ---- swap portfolios without rebuilding the map ----
  useEffect(() => {
    const map = ready;
    if (!map) return;
    map.getSource<maplibregl.GeoJSONSource>("buildings")?.setData(buildings);
    map.getSource<maplibregl.GeoJSONSource>("building-points")?.setData(toPoints(buildings));
  }, [buildings, ready]);

  // ---- rising water when the return period changes ----
  useEffect(() => {
    const map = ready;
    if (!map) return;
    const from = shownRp.current;
    const to = rp;
    const apply = (t: number) => {
      const d = depthAt(from, to, t);
      map.setPaintProperty("water", "fill-extrusion-height", ["*", d, WATER_EXAGGERATION]);
      map.setPaintProperty("water", "fill-extrusion-color", ramp(d, DEPTH_STOPS));
      map.setPaintProperty("flood-fill", "fill-color", ramp(d, DEPTH_STOPS));
      map.setPaintProperty("flood-fill", "fill-opacity", ["case", [">", d, 0.01], 0.32, 0]);
    };
    if (from === to) {
      apply(1);
      return;
    }
    let raf = 0;
    let start = 0;
    const duration = 1200;
    const step = (ts: number) => {
      if (!start) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      apply(t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
      if (t < 1) raf = requestAnimationFrame(step);
      else shownRp.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      shownRp.current = to;
    };
  }, [rp, ready]);

  // ---- building colours, issue rings (the starter CSV is the only portfolio with location issues) ----
  useEffect(() => {
    const map = ready;
    if (!map) return;
    const issues = showIssues && portfolio === "starter";
    const colour = buildingColour(colourMode, rp, issues);
    map.setPaintProperty("buildings", "fill-extrusion-color", colour);
    map.setPaintProperty("building-glow", "circle-color", colour);
    map.setLayoutProperty("issue-ring", "visibility", issues ? "visible" : "none");
  }, [colourMode, rp, showIssues, portfolio, ready]);

  // ---- pulse the issue rings ----
  useEffect(() => {
    const map = ready;
    if (!map || !showIssues) return;
    let raf = 0;
    const tick = (ts: number) => {
      const s = 0.5 + 0.5 * Math.sin(ts / 420);
      map.setPaintProperty("issue-ring", "circle-stroke-opacity", 0.35 + 0.6 * s);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [showIssues, ready]);

  // ---- selection ----
  useEffect(() => {
    const map = ready;
    if (!map) return;
    map.setFilter("building-selected", ["==", ["get", "id"], selectedId ?? ""]);
    if (!selectedId) return;
    const f = buildings.features.find((x) => x.properties.id === selectedId);
    if (f) map.easeTo({ center: [f.properties.lon, f.properties.lat], zoom: Math.max(map.getZoom(), 10.4), pitch: 62, duration: 1300 });
  }, [selectedId, ready, buildings]);

  // ---- camera presets ----
  useEffect(() => {
    const map = ready;
    if (!map || !camera) return;
    let stop = false;
    const run = async () => {
      if (camera.preset !== "tour") {
        map.flyTo({ ...fit(VIEWS[camera.preset]), duration: 3200, essential: true });
        return;
      }
      for (const v of [VIEWS.elgon, VIEWS.webuye, VIEWS.floodplain]) {
        if (stop) return;
        map.flyTo({ ...fit(v), duration: 4200, curve: 1.2, essential: true });
        await map.once("moveend");
      }
    };
    void run();
    return () => {
      stop = true;
    };
  }, [camera, ready]);

  // maplibre-gl.css forces position:relative on the map element (and beats Tailwind's layered utilities), so size it via a wrapper
  return (
    <div className="absolute inset-0">
      <div ref={container} style={{ width: "100%", height: "100%" }} aria-label="3D map of the Nzoia basin" />
    </div>
  );
}
