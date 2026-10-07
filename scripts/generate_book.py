"""Generate the Risk Forge synthetic cedant book for the Nzoia basin.

Where buildings go (all synthetic, placed on real population):
  * Only JRC hazard-grid cells on Kenyan land (geoBoundaries) and outside Lake Victoria (Natural Earth).
  * Weight per ~925 m cell = WorldPop 2020 population (UN-adjusted, 1 km) x an insurance-uptake factor
    (urban 4, peri-urban 1.5, rural 1) - ASSUMPTION: insured property concentrates in towns.
  * Stratified: 15% of rows from the floodplain zone (land wet at 1-in-500 plus a ~2 km buffer),
    85% from the rest of the basin. sample_weight re-weights rows back to a population-proportional book.
  * Each building is jittered uniformly inside its cell, so it keeps that cell's flood depth.

What they are (ranges from the dataset metadata, section 5):
  housing class mix depends on density (urban / peri-urban / rural); floor area and cost per m2 are drawn
  inside the metadata ranges; tiv_kes = floor_area_m2 x cost_per_m2_kes rounded to the nearest 5,000.

Run:  python scripts/generate_book.py [--n 1200] [--seed 2026]
Out:  data/portfolios/exposure_nzoia_riskforge_book.csv
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from matplotlib.path import Path as PolyPath
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / "data" / "reference"
OUT = ROOT / "data" / "portfolios"
HAZ = ROOT / "team_b_nzoia"

FLOODPLAIN_SHARE = 0.15
BUFFER_CELLS = 2  # ~1.85 km either side of the 1-in-500 footprint
UPTAKE = {"urban": 4.0, "peri_urban": 1.5, "rural": 1.0}
DENSITY_EDGES = (400, 1500)  # people per km2: rural < 400 <= peri-urban < 1500 <= urban

CLASS_MIX = {  # ASSUMPTION: informal/semi-permanent dominate rural areas, masonry/RCC dominate towns
    "urban": {"informal_iron_sheet": 0.12, "semi_permanent": 0.18, "permanent_masonry": 0.48, "concrete_rcc": 0.22},
    "peri_urban": {"informal_iron_sheet": 0.28, "semi_permanent": 0.34, "permanent_masonry": 0.30, "concrete_rcc": 0.08},
    "rural": {"informal_iron_sheet": 0.40, "semi_permanent": 0.40, "permanent_masonry": 0.17, "concrete_rcc": 0.03},
}
AREA = {  # m2, from the metadata table (min, typical, max); RCC uses the Nzoia range
    "informal_iron_sheet": (8, 14, 28),
    "semi_permanent": (20, 38, 80),
    "permanent_masonry": (45, 100, 300),
    "concrete_rcc": (150, 350, 1800),
}
COST = {  # KES per m2, metadata ranges
    "informal_iron_sheet": (5_000, 10_000),
    "semi_permanent": (8_000, 16_000),
    "permanent_masonry": (35_000, 65_000),
    "concrete_rcc": (50_000, 85_000),
}


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=1200)
    ap.add_argument("--seed", type=int, default=2026)
    args = ap.parse_args()
    rng = np.random.default_rng(args.seed)
    Image.MAX_IMAGE_PIXELS = None

    # hazard grid (defines the cells we sample)
    im = Image.open(HAZ / "nzoia_rp500y.tif")
    d500 = np.array(im, dtype=np.float32)
    d500 = np.where((d500 > 0) & (d500 < 1e6), d500, 0.0)
    dx, dy = im.tag_v2[33550][:2]
    x0, y0 = im.tag_v2[33922][3:5]
    nr, nc = d500.shape
    rr, cc = np.mgrid[0:nr, 0:nc]
    lon = x0 + (cc + 0.5) * dx
    lat = y0 - (rr + 0.5) * dy
    centres = np.c_[lon.ravel(), lat.ravel()]

    # population per cell (nearest WorldPop cell; both grids are 30 arc-seconds)
    wp = Image.open(REF / "worldpop_ken_ppp_2020_1km_UNadj.tif")
    pop_grid = np.array(wp, dtype=np.float32)
    pop_grid[pop_grid < 0] = 0
    wx0, wy0 = wp.tag_v2[33922][3:5]
    wd = wp.tag_v2[33550][0]
    wc = np.floor((lon - wx0) / wd).astype(int)
    wr = np.floor((wy0 - lat) / wd).astype(int)
    ok = (wc >= 0) & (wc < pop_grid.shape[1]) & (wr >= 0) & (wr < pop_grid.shape[0])
    pop = np.zeros_like(lon)
    pop[ok] = pop_grid[wr[ok], wc[ok]]

    kenya = inside(polygon_paths(REF / "ken_adm0_geoboundaries.geojson"), centres).reshape(nr, nc)
    lake = inside(polygon_paths(REF / "lake_victoria_ne10m.geojson", "Lake Victoria"), centres).reshape(nr, nc)
    eligible = kenya & ~lake & (pop > 0)

    cell_km2 = (dx * 111.32) * (dy * 111.32) * np.cos(np.radians(lat))
    density = pop / cell_km2
    dclass = np.where(density >= DENSITY_EDGES[1], "urban", np.where(density >= DENSITY_EDGES[0], "peri_urban", "rural"))
    weight = pop * np.vectorize(UPTAKE.get)(dclass)
    weight[~eligible] = 0

    # floodplain zone = wet at 1-in-500 (land) dilated by BUFFER_CELLS
    wet = (d500 > 0) & ~lake
    zone = wet.copy()
    for _ in range(BUFFER_CELLS):
        z = zone.copy()
        z[1:, :] |= zone[:-1, :]
        z[:-1, :] |= zone[1:, :]
        z[:, 1:] |= zone[:, :-1]
        z[:, :-1] |= zone[:, 1:]
        zone = z
    zone &= eligible

    wf = np.where(zone, weight, 0).ravel()
    wb = np.where(eligible & ~zone, weight, 0).ravel()
    n_f = round(args.n * FLOODPLAIN_SHARE)
    n_b = args.n - n_f
    idx = np.r_[rng.choice(wf.size, n_f, p=wf / wf.sum()), rng.choice(wb.size, n_b, p=wb / wb.sum())]
    stratum = np.r_[np.full(n_f, "floodplain"), np.full(n_b, "basin")]

    # sample_weight = population-proportional probability / stratified sampling probability (mean 1)
    w_all = weight.ravel()
    p_true = w_all[idx] / w_all.sum()
    p_samp = np.where(stratum == "floodplain", FLOODPLAIN_SHARE * w_all[idx] / wf.sum(), (1 - FLOODPLAIN_SHARE) * w_all[idx] / wb.sum())
    sw = p_true / p_samp
    sw = sw / sw.mean()

    r_i, c_i = np.unravel_index(idx, (nr, nc))
    b_lon = x0 + (c_i + rng.uniform(0.05, 0.95, args.n)) * dx
    b_lat = y0 - (r_i + rng.uniform(0.05, 0.95, args.n)) * dy
    b_dclass = dclass[r_i, c_i]

    classes = list(AREA)
    rows = []
    places = json.loads((ROOT / "web" / "public" / "data" / "places.json").read_text(encoding="utf-8"))
    for i in range(args.n):
        dc = b_dclass[i]
        cls = rng.choice(classes, p=[CLASS_MIX[dc][c] for c in classes])
        lo, mode, hi = AREA[cls]
        area = rng.lognormal(np.log(mode), 0.55) if cls == "concrete_rcc" else rng.triangular(lo, mode, hi)
        area = int(round(min(max(area, lo), hi)))
        clo, chi = COST[cls]
        u = rng.beta(3, 2) if dc == "urban" else rng.beta(2, 2)  # towns sit higher in the cost range
        cost = int(round((clo + u * (chi - clo)) / 100) * 100)
        tiv = round(area * cost / 5000) * 5000
        dists = [(np.hypot((p["lon"] - b_lon[i]) * 111.32, (p["lat"] - b_lat[i]) * 111.32), p["name"]) for p in places if p["kind"] in ("town", "focus", "village", "node")]
        dkm, near = min(dists)
        rows.append({
            "loc_id": f"RFB-{i:04d}", "lat": round(b_lat[i], 6), "lon": round(b_lon[i], 6), "housing_class": cls,
            "floor_area_m2": area, "cost_per_m2_kes": cost, "tiv_kes": int(tiv), "synthetic": True,
            "source": "Risk Forge synthetic book: WorldPop-weighted placement on Kenyan land, attributes from metadata ranges; not a real portfolio",
            "settlement": near if dkm <= 12 else "other", "density_class": dc, "stratum": stratum[i], "sample_weight": round(float(sw[i]), 4),
        })

    OUT.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows)
    df.to_csv(OUT / "exposure_nzoia_riskforge_book.csv", index=False)
    print(f"wrote {len(df)} rows -> {OUT / 'exposure_nzoia_riskforge_book.csv'}")
    print("strata:", df.stratum.value_counts().to_dict(), " density:", df.density_class.value_counts().to_dict())
    print("classes:", df.housing_class.value_counts().to_dict())
    print(f"TIV KES {df.tiv_kes.sum()/1e9:.2f} bn  median {df.tiv_kes.median():,.0f}  max {df.tiv_kes.max():,.0f}")
    print("top settlements:", df.settlement.value_counts().head(8).to_dict())


if __name__ == "__main__":
    main()
