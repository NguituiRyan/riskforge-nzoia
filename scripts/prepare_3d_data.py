"""Attach flood hazard to the portfolios and build the static files the 3D view loads.

Hazard (Step 1 of the brief, applied to Nzoia)
  For every building and each of the six JRC return periods (10..500 years) we record:
    hazard_depth_m_rp{T}    flood depth in metres read from the JRC map (real data, ~925 m cells; 0 = dry)
    hazard_severity_rp{T}   0-1 severity score = min(depth / 4 m, 1). 4 m is the brief's own "extreme" reference
                            (roof level of a single-storey building). It makes Nzoia comparable with the Nairobi
                            0-1 scores; the damage curves use the depth in metres, not the score.

Permanent water
  A ~925 m cell that is already >= 3.5 m deep at 1-in-10 is the river channel or the lake edge: the depth is the
  channel's, not a flood plain's. Those cells are drawn as water but never carry a building: the book avoids them
  (generate_book.py), starter points there are flagged WATER, and gazetteer points move to the nearest land cell.

Weights
  Portfolio totals use a weight per building: the book's stratified sample_weight (the flood plain is over-sampled
  to study it, then weighted back to population); 1 for starter rows; 0 for starter rows in the lake or on permanent
  water (shown "as provided" separately). Counts are of buildings with weight > 0.

Inputs
  team_b_nzoia/nzoia_rp{10..500}y.tif                 JRC flood depth maps (real)
  data/portfolios/exposure_nzoia_riskforge_book.csv   Risk Forge synthetic book (scripts/generate_book.py)
  team_b_nzoia/exposure_nzoia_synthetic.csv           starter CSV from the hosts (override with --starter)
  data/reference/*.geojson                            Lake Victoria, Kenya/Uganda borders, Nzoia river

Outputs
  data/portfolios/{book,starter}_with_hazard.csv      portfolio + location flag + depth and severity per RP
  web/public/data/flood_cells.geojson                 land cells wet at any RP (lake masked), depth per RP
  web/public/data/buildings_{book,starter}.geojson    symbolic squares with depth, damage ratio and loss per RP
  web/public/data/river.geojson, border.geojson, stats.json

Run:  python scripts/prepare_3d_data.py [--starter path/to.csv]
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from matplotlib.path import Path as PolyPath
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
HAZ = ROOT / "team_b_nzoia"
REF = ROOT / "data" / "reference"
PORT = ROOT / "data" / "portfolios"
OUT = ROOT / "web" / "public" / "data"
RPS = [10, 20, 50, 100, 200, 500]
ONSET_RP = 2.0  # ASSUMPTION: losses start at the 1-in-2 flood (bankfull); between 2 and 10 years we interpolate
SEVERITY_REF_M = 4.0  # depth that scores 1.0 on the 0-1 severity scale

# Vulnerability: Huizinga et al. (2017) JRC Africa residential curve, adapted per class as DR = cap * H(k * depth)
H_DEPTH = np.array([0, 0.5, 1, 1.5, 2, 3, 4, 5, 6])
H_FRAC = np.array([0, 0.22, 0.378, 0.531, 0.636, 0.817, 0.903, 0.957, 1.0])
CLASS_CURVE = {  # k (depth multiplier), cap; class spread after Englhardt et al. (2019)
    "informal_iron_sheet": (1.6, 0.95),
    "semi_permanent": (1.25, 0.90),
    "permanent_masonry": (1.0, 0.85),
    "concrete_rcc": (0.8, 0.75),
}
FOOTPRINT_M = 600  # symbolic square so buildings read at basin scale (not the real footprint)
WATER_D10_M = 3.5  # ASSUMPTION: >= 3.5 m deep at 1-in-10 = permanent water (river channel or lake edge)
EXCLUDED = ("LAKE", "WATER")  # location flags that carry no weight in portfolio results


def load_raster(rp):
    im = Image.open(HAZ / f"nzoia_rp{rp}y.tif")
    scale, tie = im.tag_v2[33550], im.tag_v2[33922]
    a = np.array(im, dtype=np.float32)
    a = np.where((a > 0) & (a < 1e6), a, 0.0)  # no-data (-3.4e38) and <= 0 are dry
    return a, scale[0], scale[1], tie[3], tie[4]


def polygon_paths(path, name=None):
    g = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for f in g["features"]:
        if name and f["properties"].get("name") != name:
            continue
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        out += [PolyPath(np.array(p[0])) for p in polys]
    return out


def inside(paths, pts):
    m = np.zeros(len(pts), bool)
    for p in paths:
        m |= p.contains_points(pts)
    return m


def damage_ratio(cls, depth):
    k, cap = CLASS_CURVE[cls]
    return cap * np.interp(np.asarray(depth) * k, H_DEPTH, H_FRAC)


def square(lon, lat, side_m):
    dlat = side_m / 2 / 111_320
    dlon = dlat / max(math.cos(math.radians(lat)), 1e-6)
    return [[[lon - dlon, lat - dlat], [lon + dlon, lat - dlat], [lon + dlon, lat + dlat], [lon - dlon, lat + dlat], [lon - dlon, lat - dlat]]]


def depth_at_rp(depths, rp):
    """Depth at any return period from the six JRC maps: linear in log(RP) between maps; below 1-in-10 scaled
    down to zero at the onset RP; held at the 1-in-500 depth beyond it. Mirrors web/src/lib/engine.ts."""
    if rp <= ONSET_RP:
        return 0.0
    if rp < RPS[0]:
        return depths[RPS[0]] * math.log(rp / ONSET_RP) / math.log(RPS[0] / ONSET_RP)
    if rp >= RPS[-1]:
        return depths[RPS[-1]]
    for a, b in zip(RPS, RPS[1:]):
        if a <= rp <= b:
            t = math.log(rp / a) / math.log(b / a)
            return depths[a] + (depths[b] - depths[a]) * t
    return depths[RPS[-1]]


def aal_from(losses):
    """Area under the EP curve: trapezoid in annual exceedance probability, onset point at zero, flat tail past 1-in-500."""
    pts = [(1 / ONSET_RP, 0.0)] + [(1 / rp, losses[rp]) for rp in RPS]
    aal = sum((p0 - p1) * (l0 + l1) / 2 for (p0, l0), (p1, l1) in zip(pts, pts[1:]))
    return aal + losses[RPS[-1]] / RPS[-1]


def attach_hazard(ex, grid, lake, kenya, water):
    rasters, dx, dy, x0, y0 = grid
    nrows, ncols = rasters[RPS[0]].shape
    ex = ex.copy()
    ex["tiv_model"] = (ex.floor_area_m2 * ex.cost_per_m2_kes / 5000).round() * 5000  # metadata: area x cost, nearest 5,000
    pts = ex[["lon", "lat"]].values
    col = ((ex.lon - x0) / dx).astype(int).clip(0, ncols - 1)
    row = ((y0 - ex.lat) / dy).astype(int).clip(0, nrows - 1)
    on_water = water[row.values, col.values]
    ex["location_flag"] = np.where(inside(lake, pts), "LAKE", np.where(on_water, "WATER", np.where(inside(kenya, pts), "KE", "UG")))
    for rp in RPS:
        d = rasters[rp][row, col].round(2)
        ex[f"hazard_depth_m_rp{rp}"] = d
        ex[f"hazard_severity_rp{rp}"] = np.minimum(d / SEVERITY_REF_M, 1.0).round(3)
        ex[f"damage_ratio_rp{rp}"] = [round(float(damage_ratio(c, v)), 3) for c, v in zip(ex.housing_class, d)]
        ex[f"loss_kes_rp{rp}"] = (ex[f"damage_ratio_rp{rp}"] * ex.tiv_model).round(0)
    return ex


def model_weight(df):
    """Weight in portfolio totals: the book's sample_weight, 1 for other rows, 0 for rows in the lake or on permanent water."""
    w = df["sample_weight"].astype(float) if "sample_weight" in df else pd.Series(1.0, index=df.index)
    return w.where(~df.location_flag.isin(EXCLUDED), 0.0)


def loss_at_rp(df, rp, w):
    total = 0.0
    for r, wi in zip(df.to_dict("records"), w):
        d = depth_at_rp({t: r[f"hazard_depth_m_rp{t}"] for t in RPS}, rp)
        total += float(damage_ratio(r["housing_class"], d)) * r["tiv_model"] * wi
    return total


def portfolio_stats(df, w):
    """Weighted money (value, losses, AAL); counts of buildings that carry weight. Mirrors runPortfolio in engine.ts."""
    on = w > 0
    tiv_w = df.tiv_model * w
    cls = df.housing_class
    losses = {rp: float((df[f"loss_kes_rp{rp}"] * w).sum()) for rp in RPS}
    return {
        "loss250": loss_at_rp(df, 250, w),
        "count": int(on.sum()),
        "tiv": float(tiv_w.sum()),
        "byClass": {c: {"count": int((on & (cls == c)).sum()), "tiv": float(tiv_w[cls == c].sum())} for c in CLASS_CURVE},
        "perRp": {str(rp): {
            "loss": losses[rp],
            "buildingsWet": int((on & (df[f"hazard_depth_m_rp{rp}"] > 0)).sum()),
            "tivWet": float(tiv_w[df[f"hazard_depth_m_rp{rp}"] > 0].sum()),
            "lossByClass": {c: float((df[f"loss_kes_rp{rp}"] * w)[cls == c].sum()) for c in CLASS_CURVE},
        } for rp in RPS},
        "aal": aal_from(losses),
    }


def snap_gazetteer(path, bad, lake, grid_meta):
    """Gazetteer points place AI-ingested buildings. One on permanent water or in the lake moves to the centre of the
    nearest land cell; its original position is kept as "orig" so re-running starts from the source point."""
    dx, dy, x0, y0 = grid_meta
    nrows, ncols = bad.shape
    places = json.loads(path.read_text(encoding="utf-8"))
    moved = []
    for g in places:
        lat, lon = g.get("orig", [g["lat"], g["lon"]])
        r, c = int((y0 - lat) / dy), int((lon - x0) / dx)
        in_grid = 0 <= r < nrows and 0 <= c < ncols
        if not in_grid or (not bad[r, c] and not inside(lake, np.array([[lon, lat]]))[0]):
            g["lat"], g["lon"] = lat, lon
            g.pop("orig", None)
            continue
        best = None
        for rr in range(max(r - 8, 0), min(r + 9, nrows)):
            for cc in range(max(c - 8, 0), min(c + 9, ncols)):
                if bad[rr, cc]:
                    continue
                clon, clat = x0 + (cc + 0.5) * dx, y0 - (rr + 0.5) * dy
                dist = math.hypot((clon - lon) * math.cos(math.radians(lat)), clat - lat) * 111.32
                if best is None or dist < best[0]:
                    best = (dist, clat, clon)
        if best:
            g["orig"] = [lat, lon]
            g["lat"], g["lon"] = round(best[1], 5), round(best[2], 5)
            moved.append(f"{g['name']} ({best[0]:.1f} km)")
    path.write_text(json.dumps(places, indent=0, ensure_ascii=False), encoding="utf-8")
    return moved


def to_geojson(df, w, path):
    feats = []
    for r, wi in zip(df.to_dict("records"), w):
        props = {"id": r["loc_id"], "cls": r["housing_class"], "area": int(r["floor_area_m2"]), "cost": int(r["cost_per_m2_kes"]),
                 "tiv": float(r["tiv_model"]), "tivCsv": float(r["tiv_kes"]), "lat": round(r["lat"], 5), "lon": round(r["lon"], 5),
                 "where": r["location_flag"], "w": round(float(wi), 4)}
        for extra in ("settlement", "density_class", "stratum"):
            if extra in r:
                props[extra] = r[extra]
        for rp in RPS:
            props[f"d{rp}"] = float(r[f"hazard_depth_m_rp{rp}"])
            props[f"dr{rp}"] = float(r[f"damage_ratio_rp{rp}"])
            props[f"loss{rp}"] = float(r[f"loss_kes_rp{rp}"])
        feats.append({"type": "Feature", "properties": props, "geometry": {"type": "Polygon", "coordinates": square(r["lon"], r["lat"], FOOTPRINT_M)}})
    path.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--starter", default=str(HAZ / "exposure_nzoia_synthetic.csv"))
    ap.add_argument("--book", default=str(PORT / "exposure_nzoia_riskforge_book.csv"))
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    PORT.mkdir(parents=True, exist_ok=True)

    loaded = {rp: load_raster(rp) for rp in RPS}
    _, dx, dy, x0, y0 = loaded[RPS[0]]
    rasters = {rp: loaded[rp][0] for rp in RPS}
    grid = (rasters, dx, dy, x0, y0)
    nrows, ncols = rasters[RPS[0]].shape
    lake = polygon_paths(REF / "lake_victoria_ne10m.geojson", "Lake Victoria")
    kenya = polygon_paths(REF / "ken_adm0_geoboundaries.geojson")

    # ---- flood cells (land only) ----
    rr, cc = np.mgrid[0:nrows, 0:ncols]
    centres = np.c_[(x0 + (cc + 0.5) * dx).ravel(), (y0 - (rr + 0.5) * dy).ravel()]
    lake_mask = inside(lake, centres).reshape(nrows, ncols)
    water = (rasters[RPS[0]] >= WATER_D10_M) & ~lake_mask  # river channel and lake edge
    land = ~lake_mask & ~water
    wet10 = land & (rasters[RPS[0]] >= 0.1)
    wet_any = np.zeros((nrows, ncols), bool)
    for rp in RPS:
        wet_any |= rasters[rp] > 0
    feats = []
    for r, c in zip(*np.nonzero(wet_any & ~lake_mask)):
        lon0, lat1 = x0 + c * dx, y0 - r * dy
        props = {f"d{rp}": round(float(rasters[rp][r, c]), 2) for rp in RPS}
        if water[r, c]:
            props["pw"] = 1  # permanent water: drawn flat as water, no building hazard
        feats.append({"type": "Feature", "properties": props, "geometry": {"type": "Polygon", "coordinates": [[
            [lon0, lat1], [lon0 + dx, lat1], [lon0 + dx, lat1 - dy], [lon0, lat1 - dy], [lon0, lat1]]]}})
    (OUT / "flood_cells.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))

    # ---- portfolios ----
    book = attach_hazard(pd.read_csv(args.book), grid, lake, kenya, water)
    starter = attach_hazard(pd.read_csv(args.starter), grid, lake, kenya, water)
    bad_book = book.location_flag.isin(EXCLUDED).sum()
    if bad_book:
        print(f"WARNING: {bad_book} book buildings in the lake or on permanent water - re-run generate_book.py")
    weights = {"book": model_weight(book), "starter": model_weight(starter)}
    hazard_cols = [f"hazard_{k}_rp{rp}" for k in ("depth_m", "severity") for rp in RPS]
    for name, df in (("book", book), ("starter", starter)):
        base = [c for c in df.columns if not c.startswith(("hazard_", "damage_ratio_", "loss_kes_", "tiv_model", "location_flag"))]
        df[base + ["location_flag"] + hazard_cols].to_csv(PORT / f"{name}_with_hazard.csv", index=False)
        to_geojson(df, weights[name], OUT / f"buildings_{name}.geojson")
    moved = snap_gazetteer(OUT / "gazetteer.json", water | lake_mask, lake, (dx, dy, x0, y0))
    print("gazetteer points moved off water:", ", ".join(moved) or "none")

    # ---- river + border ----
    (OUT / "river.geojson").write_text((REF / "nzoia_river_osm.geojson").read_text(encoding="utf-8"))
    g = json.loads((REF / "ken_adm0_geoboundaries.geojson").read_text(encoding="utf-8"))
    lines = []
    for f in g["features"]:
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for p in polys:
            ring = [pt for pt in p[0] if 33.4 < pt[0] < 35.7 and -0.6 < pt[1] < 1.6]
            if len(ring) > 1:
                lines.append(ring)
    (OUT / "border.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"name": "Kenya border"}, "geometry": {"type": "MultiLineString", "coordinates": lines}}]}))

    cell_km2 = (dx * 111.32) * (dy * 111.32)
    stats = {
        "returnPeriods": RPS,
        "onsetRp": ONSET_RP,
        "severityRefM": SEVERITY_REF_M,
        "cellKm2": round(cell_km2, 3),
        "floodLandKm2": {str(rp): round(float(((rasters[rp] > 0) & land).sum()) * cell_km2, 1) for rp in RPS},
        "maxDepthLand": {str(rp): round(float(rasters[rp][land].max()), 2) for rp in RPS},
        "lakeWetShare": round(float((wet_any & lake_mask).sum() / wet_any.sum()), 3),
        "permanentWater": {"ruleD10M": WATER_D10_M, "cells": int(water.sum()), "km2": round(float(water.sum()) * cell_km2, 1)},
        # how flood depth grows with rarity on flood-plain land: median depth(RP) / depth(1-in-10) over land cells
        # wet at 1-in-10. Shapes a site's own flood curve when the JRC map is dry there (web/src/lib/offer.ts)
        "depthGrowth": {str(rp): round(float(np.median(rasters[rp][wet10] / rasters[RPS[0]][wet10])), 3) for rp in RPS},
        "starterFlags": {k: int((starter.location_flag == k).sum()) for k in ("KE", "UG", "LAKE", "WATER")},
        "starterTivCsvTotal": float(starter.tiv_kes.sum()),
        "bookStrata": {k: int(v) for k, v in book.stratum.value_counts().items()},
        "bookWeights": {k: round(float(v), 4) for k, v in book.groupby("stratum").sample_weight.first().items()},
        "curves": {c: {"k": k, "cap": cap} for c, (k, cap) in CLASS_CURVE.items()},
        "portfolios": {
            "book": portfolio_stats(book, weights["book"]),  # weighted back to population (what the app shows)
            "bookUnweighted": portfolio_stats(book, pd.Series(1.0, index=book.index)),  # the flood-plain-enriched sample as drawn
            "starter": portfolio_stats(starter, weights["starter"]),  # cleaned: lake and permanent-water rows excluded
            "starterRaw": portfolio_stats(starter, pd.Series(1.0, index=starter.index)),  # as provided
            "starterKenya": portfolio_stats(starter, (starter.location_flag == "KE").astype(float)),
        },
    }
    (OUT / "stats.json").write_text(json.dumps(stats, indent=1))
    print(f"flood cells: {len(feats)} (permanent water {int(water.sum())})  book: {len(book)}  starter: {len(starter)}  starter flags: {stats['starterFlags']}")
    for k, p in stats["portfolios"].items():
        print(f"{k:13s} TIV {p['tiv']/1e6:>9,.0f} M  wet@100 {p['perRp']['100']['buildingsWet']:>4}  loss@100 {p['perRp']['100']['loss']/1e6:>8,.2f} M  AAL {p['aal']/1e6:>7,.2f} M")


if __name__ == "__main__":
    main()
