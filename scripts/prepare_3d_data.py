"""Attach flood hazard to the portfolios and build the static files the 3D view loads.

Hazard (Step 1 of the brief, applied to Nzoia)
  For every building and each of the six JRC return periods (10..500 years) we record:
    hazard_depth_m_rp{T}    flood depth in metres read from the JRC map (real data, ~925 m cells; 0 = dry)
    hazard_severity_rp{T}   0-1 severity score = min(depth / 4 m, 1). 4 m is the brief's own "extreme" reference
                            (roof level of a single-storey building). It makes Nzoia comparable with the Nairobi
                            0-1 scores; the damage curves use the depth in metres, not the score.

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


def aal_from(losses):
    """Area under the EP curve: trapezoid in annual exceedance probability, onset point at zero, flat tail past 1-in-500."""
    pts = [(1 / ONSET_RP, 0.0)] + [(1 / rp, losses[rp]) for rp in RPS]
    aal = sum((p0 - p1) * (l0 + l1) / 2 for (p0, l0), (p1, l1) in zip(pts, pts[1:]))
    return aal + losses[RPS[-1]] / RPS[-1]


def attach_hazard(ex, grid, lake, kenya):
    rasters, dx, dy, x0, y0 = grid
    nrows, ncols = rasters[RPS[0]].shape
    ex = ex.copy()
    ex["tiv_model"] = (ex.floor_area_m2 * ex.cost_per_m2_kes / 5000).round() * 5000  # metadata: area x cost, nearest 5,000
    pts = ex[["lon", "lat"]].values
    ex["location_flag"] = np.where(inside(lake, pts), "LAKE", np.where(inside(kenya, pts), "KE", "UG"))
    col = ((ex.lon - x0) / dx).astype(int).clip(0, ncols - 1)
    row = ((y0 - ex.lat) / dy).astype(int).clip(0, nrows - 1)
    for rp in RPS:
        d = rasters[rp][row, col].round(2)
        ex[f"hazard_depth_m_rp{rp}"] = d
        ex[f"hazard_severity_rp{rp}"] = np.minimum(d / SEVERITY_REF_M, 1.0).round(3)
        ex[f"damage_ratio_rp{rp}"] = [round(float(damage_ratio(c, v)), 3) for c, v in zip(ex.housing_class, d)]
        ex[f"loss_kes_rp{rp}"] = (ex[f"damage_ratio_rp{rp}"] * ex.tiv_model).round(0)
    return ex


def portfolio_stats(df):
    losses = {rp: float(df[f"loss_kes_rp{rp}"].sum()) for rp in RPS}
    return {
        "count": int(len(df)),
        "tiv": float(df.tiv_model.sum()),
        "byClass": {c: {"count": int((df.housing_class == c).sum()), "tiv": float(df[df.housing_class == c].tiv_model.sum())} for c in CLASS_CURVE},
        "perRp": {str(rp): {
            "loss": losses[rp],
            "buildingsWet": int((df[f"hazard_depth_m_rp{rp}"] > 0).sum()),
            "tivWet": float(df[df[f"hazard_depth_m_rp{rp}"] > 0].tiv_model.sum()),
            "lossByClass": {c: float(df[df.housing_class == c][f"loss_kes_rp{rp}"].sum()) for c in CLASS_CURVE},
        } for rp in RPS},
        "aal": aal_from(losses),
    }


def to_geojson(df, path):
    feats = []
    for r in df.to_dict("records"):
        props = {"id": r["loc_id"], "cls": r["housing_class"], "area": int(r["floor_area_m2"]), "cost": int(r["cost_per_m2_kes"]),
                 "tiv": float(r["tiv_model"]), "tivCsv": float(r["tiv_kes"]), "lat": round(r["lat"], 5), "lon": round(r["lon"], 5),
                 "where": r["location_flag"]}
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
    wet_any = np.zeros((nrows, ncols), bool)
    for rp in RPS:
        wet_any |= rasters[rp] > 0
    feats = []
    for r, c in zip(*np.nonzero(wet_any & ~lake_mask)):
        lon0, lat1 = x0 + c * dx, y0 - r * dy
        props = {f"d{rp}": round(float(rasters[rp][r, c]), 2) for rp in RPS}
        feats.append({"type": "Feature", "properties": props, "geometry": {"type": "Polygon", "coordinates": [[
            [lon0, lat1], [lon0 + dx, lat1], [lon0 + dx, lat1 - dy], [lon0, lat1 - dy], [lon0, lat1]]]}})
    (OUT / "flood_cells.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))

    # ---- portfolios ----
    book = attach_hazard(pd.read_csv(args.book), grid, lake, kenya)
    starter = attach_hazard(pd.read_csv(args.starter), grid, lake, kenya)
    hazard_cols = [f"hazard_{k}_rp{rp}" for k in ("depth_m", "severity") for rp in RPS]
    for name, df in (("book", book), ("starter", starter)):
        base = [c for c in df.columns if not c.startswith(("hazard_", "damage_ratio_", "loss_kes_", "tiv_model", "location_flag"))]
        df[base + ["location_flag"] + hazard_cols].to_csv(PORT / f"{name}_with_hazard.csv", index=False)
        to_geojson(df, OUT / f"buildings_{name}.geojson")

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
        "floodLandKm2": {str(rp): round(float(((rasters[rp] > 0) & ~lake_mask).sum()) * cell_km2, 1) for rp in RPS},
        "maxDepthLand": {str(rp): round(float(rasters[rp][~lake_mask].max()), 2) for rp in RPS},
        "lakeWetShare": round(float((wet_any & lake_mask).sum() / wet_any.sum()), 3),
        "starterFlags": {k: int((starter.location_flag == k).sum()) for k in ("KE", "UG", "LAKE")},
        "starterTivCsvTotal": float(starter.tiv_kes.sum()),
        "bookStrata": {k: int(v) for k, v in book.stratum.value_counts().items()},
        "curves": {c: {"k": k, "cap": cap} for c, (k, cap) in CLASS_CURVE.items()},
        "portfolios": {"book": portfolio_stats(book), "starter": portfolio_stats(starter), "starterKenya": portfolio_stats(starter[starter.location_flag == "KE"])},
    }
    (OUT / "stats.json").write_text(json.dumps(stats, indent=1))
    print(f"flood cells: {len(feats)}  book: {len(book)}  starter: {len(starter)}  starter flags: {stats['starterFlags']}")
    for k, p in stats["portfolios"].items():
        print(f"{k:13s} TIV {p['tiv']/1e6:>9,.0f} M  wet@100 {p['perRp']['100']['buildingsWet']:>4}  loss@100 {p['perRp']['100']['loss']/1e6:>8,.2f} M  AAL {p['aal']/1e6:>7,.2f} M")


if __name__ == "__main__":
    main()
