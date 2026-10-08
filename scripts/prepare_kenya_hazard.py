"""Kenya-wide river flood hazard and place names, so the model works anywhere in Kenya, not only on the Nzoia.

Hazard
  The six JRC global river flood hazard maps (Dottori et al. 2016; 30 arc-seconds, ~925 m; 1-in-10 to 1-in-500 years)
  are cut to Kenya. This is the same product and grid as the Nzoia rasters the hackathon supplied: the script checks
  the two agree cell for cell over the Nzoia window before writing anything.
    - only the map tiles that cover Kenya are decoded (the global files are 41,616 x 16,468 cells)
    - cells outside Kenya's border (geoBoundaries) are dropped
    - permanent water: JRC's permanent water-body mask (lakes, reservoirs) and cells >= 3.5 m deep at 1-in-10 (river
      channels; the same rule as scripts/prepare_3d_data.py). Buildings never take their hazard from those cells.
    - growth curves: median depth(RP) / depth(1-in-10) over land cells wet at 1-in-10, per 1-degree tile (Kenya-wide
      median where a tile has too few cells). Used to shape a site's own flood curve where the map is dry.

Places
  GeoNames Kenya (CC BY 4.0): towns and villages, administrative locations, counties, parks and reserves, lodges and
  camps, airstrips, markets, estates, schools, hospitals, factories and rivers, each with its county.
  The AI picks from the entries whose names appear in the user's text; nothing else is sent.

Inputs (downloaded once, git-ignored)
  data/jrc_global/floodMapGL_rp{10,20,50,100,200,500}y.zip, floodMapGL_permWB.zip
      https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/FLOODS/GlobalMaps/
  data/geonames/KE.zip      https://download.geonames.org/export/dump/KE.zip
  data/reference/ken_adm0_geoboundaries.geojson, team_b_nzoia/nzoia_rp*.tif (for the check)

Outputs
  web/public/data/kenya_hazard.json   wet land cells (depth per RP, cm), channels, lakes (run-length), growth curves
  web/public/data/kenya_places.json   gazetteer

Run:  python -I scripts/prepare_kenya_hazard.py data/jrc_global data/geonames/KE.zip
      (needs numpy, matplotlib, tifffile, imagecodecs, pillow)
"""
import json
import math
import sys
import zipfile
from pathlib import Path

import numpy as np
import tifffile
from matplotlib.path import Path as PolyPath
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "data"
RPS = [10, 20, 50, 100, 200, 500]
D = 1 / 120  # 30 arc-seconds
WEST, EAST, NORTH, SOUTH = 33.5, 42.0, 5.5, -5.0  # Kenya plus a margin, on the 30" lattice
WATER_D10_M = 3.5
NZOIA = {"x0": 33.7, "y0": 1.3}  # the supplied rasters' corner


def tif_from_zip(zpath: Path, work: Path) -> Path:
    """extract the .tif from a JRC zip (once) into a work folder next to the downloads"""
    work.mkdir(exist_ok=True)
    with zipfile.ZipFile(zpath) as z:
        name = next(n for n in z.namelist() if n.endswith(".tif"))
        out = work / name
        if not out.exists() or out.stat().st_size != z.getinfo(name).file_size:
            z.extract(name, work)
    return out


def read_window(path: Path) -> np.ndarray:
    """the Kenya window of a global map, decoding only the tiles that cover it"""
    with tifffile.TiffFile(path) as tif:
        p = tif.pages[0]
        tie = p.tags["ModelTiepointTag"].value
        gx0 = round(tie[3] * 120) / 120  # stored as float32 (-166.79998...): snap to the lattice
        gy0 = round(tie[4] * 120) / 120
        c0, c1 = round((WEST - gx0) / D), round((EAST - gx0) / D)
        r0, r1 = round((gy0 - NORTH) / D), round((gy0 - SOUTH) / D)
        tw, th = p.tilewidth, p.tilelength
        across = math.ceil(p.imagewidth / tw)
        out = np.zeros((r1 - r0, c1 - c0), np.float32)
        fh = tif.filehandle
        for tr in range(r0 // th, (r1 - 1) // th + 1):
            for tc in range(c0 // tw, (c1 - 1) // tw + 1):
                i = tr * across + tc
                fh.seek(p.dataoffsets[i])
                tile = p.decode(fh.read(p.databytecounts[i]), i)[0].reshape(th, tw)
                # overlap of this tile with the window, in global cell indices
                gr0, gc0 = tr * th, tc * tw
                ar0, ar1 = max(gr0, r0), min(gr0 + th, r1)
                ac0, ac1 = max(gc0, c0), min(gc0 + tw, c1)
                out[ar0 - r0 : ar1 - r0, ac0 - c0 : ac1 - c0] = tile[ar0 - gr0 : ar1 - gr0, ac0 - gc0 : ac1 - gc0]
    return out


def clean(a: np.ndarray) -> np.ndarray:
    return np.where(np.isfinite(a) & (a > 0) & (a < 1e6), a, 0.0).astype(np.float32)


def kenya_mask(nrows: int, ncols: int) -> np.ndarray:
    g = json.loads((ROOT / "data" / "reference" / "ken_adm0_geoboundaries.geojson").read_text(encoding="utf-8"))
    xs = WEST + (np.arange(ncols) + 0.5) * D
    ys = NORTH - (np.arange(nrows) + 0.5) * D
    pts = np.column_stack([np.tile(xs, nrows), np.repeat(ys, ncols)])
    mask = np.zeros(len(pts), bool)
    for f in g["features"]:
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for poly in polys:
            ring = np.array(poly[0])
            mask |= PolyPath(ring).contains_points(pts)
    return mask.reshape(nrows, ncols)


def check_against_nzoia(rasters: dict) -> dict:
    """the supplied Nzoia rasters must be the same product: compare every cell of their window"""
    out = {}
    for rp in RPS:
        im = Image.open(ROOT / "team_b_nzoia" / f"nzoia_rp{rp}y.tif")
        nz = clean(np.array(im, dtype=np.float32))
        r0 = round((NORTH - NZOIA["y0"]) / D)
        c0 = round((NZOIA["x0"] - WEST) / D)
        ke = rasters[rp][r0 : r0 + nz.shape[0], c0 : c0 + nz.shape[1]]
        diff = np.abs(ke - nz)
        out[str(rp)] = {"cells": int(nz.size), "wetNzoia": int((nz > 0).sum()), "maxAbsDiffM": round(float(diff.max()), 4), "identicalShare": round(float((diff < 0.005).mean()), 4)}
    return out


def growth_curves(rasters: dict, land: np.ndarray) -> dict:
    wet10 = land & (rasters[10] > 0.05)
    ratio = {rp: np.where(wet10, rasters[rp] / np.maximum(rasters[10], 1e-6), np.nan) for rp in RPS}
    default = {str(rp): round(float(np.nanmedian(ratio[rp])), 3) for rp in RPS}
    tiles = {}
    nrows, ncols = land.shape
    for lat0 in range(math.floor(SOUTH), math.ceil(NORTH)):
        for lon0 in range(math.floor(WEST), math.ceil(EAST)):
            r_a = max(round((NORTH - (lat0 + 1)) / D), 0)
            r_b = min(round((NORTH - lat0) / D), nrows)
            c_a = max(round((lon0 - WEST) / D), 0)
            c_b = min(round((lon0 + 1 - WEST) / D), ncols)
            if r_a >= r_b or c_a >= c_b:
                continue
            n = int(wet10[r_a:r_b, c_a:c_b].sum())
            if n < 25:
                continue
            tiles[f"{lat0},{lon0}"] = {"n": n, **{str(rp): round(float(np.nanmedian(ratio[rp][r_a:r_b, c_a:c_b])), 3) for rp in RPS}}
    return {"default": default, "tiles": tiles}


def runs(mask: np.ndarray) -> list:
    """run-length rows of a boolean grid: [row, first col, length]"""
    out = []
    for r in range(mask.shape[0]):
        row = mask[r]
        if not row.any():
            continue
        edges = np.flatnonzero(np.diff(np.concatenate([[0], row.astype(np.int8), [0]])))
        out += [[r, int(a), int(b - a)] for a, b in zip(edges[0::2], edges[1::2])]
    return out


# ---------------- places ----------------
KEEP = {
    "PPL": "village", "PPLX": "village", "PPLL": "village", "PPLF": "village", "PPLS": "village", "PPLR": "village",
    "PPLA": "town", "PPLA2": "town", "PPLA3": "town", "PPLC": "town",
    "ADM1": "county", "ADM2": "area", "ADMD": "area",
    "RESW": "reserve", "PRK": "park", "RESN": "reserve", "RES": "reserve", "RESF": "forest",
    "HTL": "lodge", "CMP": "camp", "RSRT": "lodge", "AIRF": "airstrip", "AIRP": "airport", "MKT": "market",
    "BDG": "bridge", "EST": "estate", "FRM": "farm", "RNCH": "ranch", "SCH": "school", "HSP": "hospital", "HSPC": "hospital",
    "MFG": "factory", "MLSU": "factory", "MLSG": "factory", "DAM": "dam", "IRRS": "irrigation scheme",
    "STM": "river", "STMI": "river", "SWMP": "swamp", "LK": "lake",
}
CORE_STRIP = (" game reserve", " national reserve", " national park", " county", " location", " sub-location", " division", " market", " bridge",
              " hotel", " lodge", " camp", " airstrip", " airport", " town", " village", " river", " estate", " farm", " ranch", " school", " hospital")


def places(geonames_zip: Path) -> list:
    with zipfile.ZipFile(geonames_zip) as z:
        lines = z.read("KE.txt").decode("utf-8").splitlines()
    rows = [l.split("\t") for l in lines]
    county = {r[10]: r[1] for r in rows if r[7] == "ADM1"}
    seen = {}
    out = []
    for r in rows:
        kind = KEEP.get(r[7])
        if not kind:
            continue
        name = r[1].strip()
        lat, lon = round(float(r[4]), 5), round(float(r[5]), 5)
        if not (SOUTH < lat < NORTH and WEST < lon < EAST):
            continue
        key = name.lower()
        dup = next((o for o in seen.get(key, []) if abs(o["lat"] - lat) < 0.02 and abs(o["lon"] - lon) < 0.02), None)
        if dup:
            continue
        aliases = sorted({a.strip() for a in r[3].split(",") if a.strip() and a.strip().lower() != key and a.isascii() and len(a) <= 40})[:3]
        e = {"name": name, "kind": kind, "lat": lat, "lon": lon, "county": county.get(r[10], "")}
        if kind == "county":
            e["county"] = name
        if aliases:
            e["aliases"] = aliases
        seen.setdefault(key, []).append(e)
        out.append(e)
    return out


def main():
    src, geonames = Path(sys.argv[1]), Path(sys.argv[2])
    work = src / "extracted"
    rasters = {}
    for rp in RPS:
        rasters[rp] = clean(read_window(tif_from_zip(src / f"floodMapGL_rp{rp}y.zip", work)))
        print(f"1-in-{rp}: {int((rasters[rp] > 0).sum()):,} wet cells in the window")
    perm = read_window(tif_from_zip(src / "floodMapGL_permWB.zip", work))
    # JRC's mask: 1 = large lakes (Victoria, Turkana), 2 = other permanent water, 15 = no data (land)
    lakes_jrc = (perm == 1) | (perm == 2)

    check = check_against_nzoia(rasters)
    print("check against the supplied Nzoia rasters:", json.dumps(check))
    worst = max(v["maxAbsDiffM"] for v in check.values())
    if worst > 0.01:
        raise SystemExit(f"The global maps do not match the supplied Nzoia rasters (max diff {worst} m): stop")

    nrows, ncols = rasters[10].shape
    kenya = kenya_mask(nrows, ncols)
    lake = lakes_jrc & kenya
    channel = (rasters[10] >= WATER_D10_M) & kenya & ~lake
    land = kenya & ~lake & ~channel
    wet = land & np.any([rasters[rp] > 0 for rp in RPS], axis=0)

    cells = []
    for r, c in zip(*np.nonzero(wet)):
        cells.append([int(r), int(c), *[int(round(float(rasters[rp][r, c]) * 100)) for rp in RPS]])
    cell_km2 = (D * 111.32) ** 2
    hazard = {
        "source": "JRC global river flood hazard maps (Dottori et al. 2016), 30 arc-seconds, cut to Kenya (geoBoundaries)",
        "x0": WEST,
        "y0": NORTH,
        "d": D,
        "nrows": nrows,
        "ncols": ncols,
        "rps": RPS,
        "depthUnit": "cm",
        # [row, col, depth at each RP in cm]; row 0 is the northern edge
        "cells": cells,
        "channel": [[int(r), int(c)] for r, c in zip(*np.nonzero(channel))],
        "lake": runs(lake),
        "growth": growth_curves(rasters, land),
        "floodLandKm2": {str(rp): round(float(((rasters[rp] > 0) & land).sum()) * cell_km2) for rp in RPS},
        "checkAgainstNzoia": check,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "kenya_hazard.json").write_text(json.dumps(hazard, separators=(",", ":")), encoding="utf-8")
    print(f"wet land cells {len(cells):,} · channel {int(channel.sum()):,} · lake {int(lake.sum()):,} · growth tiles {len(hazard['growth']['tiles'])}")
    print("flooded land km2:", hazard["floodLandKm2"])

    gaz = places(geonames)
    (OUT / "kenya_places.json").write_text(json.dumps(gaz, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"places {len(gaz):,}")
    for f in ("kenya_hazard.json", "kenya_places.json"):
        print(f, f"{(OUT / f).stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
