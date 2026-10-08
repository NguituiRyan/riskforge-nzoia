"""Risk Forge on Oasis LMF: the financial (loss) calculation runs in the Oasis Loss Modelling Framework.

Risk Forge supplies the model (hazard, vulnerability) and the exposure; Oasis computes the losses:
    ground-up (gulmc) -> insurance terms (fmpy, IL) -> reinsurance (fmpy, RI) -> AAL (aalpy) and EP curves (lecpy).

The Oasis model "RiskForge / KE_RIVER_FLOOD"
  peril      ORF (river / fluvial flood)
  area perils the 30" JRC flood-map cells of Kenya (id = row * 1020 + col + 1 on the Kenya grid of
             scripts/prepare_kenya_hazard.py). A site whose hazard comes from its own flood history (a broker
             offer where the JRC map is dry) gets its own area peril id above 20,000,000.
  events     a stratified annual-maximum event set: N periods (years); in year p the largest flood is the
             1-in-(N/p) flood, for p = 1 .. N/2 (smaller floods stay in the river: losses start at 1-in-2, as in
             the browser engine). Each event's footprint is the six JRC maps interpolated in log(return
             period), exactly as the browser engine does. Oasis's own return-period ranking (N / rank) then
             lands on 1-in-10, 20, 50, 100, 200, 250 and 500 exactly.
  intensity  flood depth, 1 cm bins (0 - 15 m)
  vulnerability  one function per construction class / raised-floor height / site calibration (structure)
             and per contents mix (stock, machinery, other), from the same Huizinga-Africa curves as the
             browser engine; damage bins every 0.1% of value, no secondary uncertainty (mean damage).
  exposure   OED: location.csv (BuildingTIV, ContentsTIV), account.csv (per-risk deductible and limit),
             ri_info.csv / ri_scope.csv (quota share, then a cat XL inuring on the retained loss).
             Book sample weights are applied by scaling a building's values and its policy terms by its weight,
             which scales every loss by the weight exactly.

Run (Linux / WSL, with oasislmf installed):
    python riskforge_oasis.py run portfolio.json result.json      # portfolio = {"name", "buildings", "programme"}
    python riskforge_oasis.py book                                  # the Risk Forge book -> web/public/data/oasis_book.json
"""
import json
import math
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA = ROOT / "web" / "public" / "data"
OASIS_BIN = Path(sys.executable).parent  # oasislmf, csvtobin, ... live next to this python

RPS = [10, 20, 50, 100, 200, 500]
KEY_RPS = [10, 20, 50, 100, 200, 250, 500]
ONSET_RP = 2.0
N_PERIODS = 2000
MAX_CM = 1500  # 15 m
DAMAGE_STEPS = 1000  # damage bins every 0.1%
KENYA = {"x0": 33.5, "y0": 5.5, "d": 1 / 120, "ncols": 1020}
SITE_AP0 = 20_000_000
RUNS = Path(os.environ.get("RF_OASIS_RUNS", Path.home() / "riskforge-oasis" / "runs"))  # not /tmp: WSL clears it on restart
PERIL = "ORF"

HUIZINGA_AFRICA = [(0, 0), (0.5, 0.22), (1, 0.378), (1.5, 0.531), (2, 0.636), (3, 0.817), (4, 0.903), (5, 0.957), (6, 1.0)]
CURVES = {"informal_iron_sheet": (1.6, 0.95), "semi_permanent": (1.25, 0.9), "permanent_masonry": (1.0, 0.85), "concrete_rcc": (0.8, 0.75)}
CONTENTS = {"stock": (2.0, 0.95), "machinery": (1.2, 0.7), "other": (1.0, 0.8)}


# ---------------- the browser engine's maths, line for line ----------------
def interp(x, pts):
    if x <= pts[0][0]:
        return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def curve_damage(k, cap, depth):
    return cap * interp(depth * k, HUIZINGA_AFRICA) if depth > 0 else 0.0


def depth_at_rp(d, rp):
    """d: depths at RPS; linear in log(RP) between maps, 0 at the 1-in-2 onset, held above 1-in-500"""
    if rp <= ONSET_RP:
        return 0.0
    if rp < RPS[0]:
        return d[0] * math.log(rp / ONSET_RP) / math.log(RPS[0] / ONSET_RP)
    if rp >= RPS[-1]:
        return d[-1]
    for i in range(len(RPS) - 1):
        a, b = RPS[i], RPS[i + 1]
        if a <= rp <= b:
            return d[i] + (d[i + 1] - d[i]) * math.log(rp / a) / math.log(b / a)
    return d[-1]


def num(v):
    return float(v) if isinstance(v, (int, float)) and math.isfinite(v) else 0.0


def weight(b):
    return float(b["w"]) if isinstance(b.get("w"), (int, float)) else 1.0


# ---------------- hazard: the Kenya grid ----------------
_grid = None


def kenya_cells():
    global _grid
    if _grid is None:
        h = json.loads((DATA / "kenya_hazard.json").read_text(encoding="utf-8"))
        _grid = {(c[0], c[1]): tuple(round(v / 100, 2) for v in c[2:]) for c in h["cells"]}
    return _grid


def cell_of(lat, lon):
    r = math.floor((KENYA["y0"] - lat) / KENYA["d"])
    c = math.floor((lon - KENYA["x0"]) / KENYA["d"])
    return r, c


# ---------------- build the Oasis model and OED exposure for one portfolio ----------------
def build(portfolio, work: Path, n_periods=N_PERIODS):
    shutil.rmtree(work, ignore_errors=True)
    model, keys, exp = work / "model_data", work / "keys_data", work / "exposure"
    for p in (model, keys, exp):
        p.mkdir(parents=True)
    prog = portfolio["programme"]
    buildings = [b for b in portfolio["buildings"] if weight(b) > 0]
    if not buildings:
        raise ValueError("no buildings with weight > 0")

    # area perils: one per hazard profile; the JRC cell id when the building's depths are that cell's
    grid = kenya_cells()
    profiles, ap_of_profile, site_n = {}, {}, 0
    loc_ap = []
    for b in buildings:
        prof = tuple(round(num(b.get(f"d{r}")), 2) for r in RPS)
        if prof not in ap_of_profile:
            r, c = cell_of(num(b["lat"]), num(b["lon"]))
            if grid.get((r, c)) == prof or (prof == (0,) * 6 and (r, c) not in grid):
                ap = r * KENYA["ncols"] + c + 1
                if ap in profiles:  # same cell, different profile: give the site its own id
                    site_n += 1
                    ap = SITE_AP0 + site_n
            else:
                site_n += 1
                ap = SITE_AP0 + site_n
            ap_of_profile[prof] = ap
            profiles[ap] = prof
        loc_ap.append(ap_of_profile[prof])

    # vulnerability functions: structure per class / floor / calibration; contents per mix / floor / calibration
    vulns, vuln_id = [], {}

    def vid(key):
        if key not in vuln_id:
            vuln_id[key] = len(vulns) + 1
            vulns.append(key)
        return vuln_id[key]

    loc_rows, loc_vkey, vdict = [], [], {}
    for b, ap in zip(buildings, loc_ap):
        w = weight(b)
        floor = round(num(b.get("floor")), 2)
        cal = round(num(b.get("cal")) if num(b.get("cal")) > 0 else 1.0, 4)
        cs, cm, co = num(b.get("cs")), num(b.get("cm")), num(b.get("co"))
        contents = cs + cm + co
        vb = vid(("b", b["cls"], floor, cal))
        vc = vid(("c", round(cs / contents, 4), round(cm / contents, 4), round(co / contents, 4), floor, cal)) if contents > 0 else 0
        vkey = f"B{vb}C{vc}"
        vdict[vkey] = (vb, vc)
        loc_rows.append({
            "PortNumber": 1,
            "AccNumber": str(b.get("policy") or b["id"]),
            "LocNumber": str(b["id"]),
            "CountryCode": "KE",
            "Latitude": num(b["lat"]),
            "Longitude": num(b["lon"]),
            "LocPerilsCovered": PERIL,
            "BuildingTIV": round(num(b["tiv"]) * w, 2),
            "ContentsTIV": round(contents * w, 2),
            "OtherTIV": 0,
            "BITIV": 0,
            "LocCurrency": "KES",
            "OccupancyCode": 1000,
            "ConstructionCode": 5000,
            "FlexiLocRFHazard": str(ap),
            "FlexiLocRFVuln": vkey,
        })
        loc_vkey.append(vkey)
    pd.DataFrame(loc_rows).to_csv(exp / "location.csv", index=False)

    # accounts: one policy per risk (a building in the books, a whole site for an offer), terms scaled by weight
    acc = {}
    for b in buildings:
        key = str(b.get("policy") or b["id"])
        if key in acc:
            continue
        w = weight(b)
        ded = num(b["ded"]) if isinstance(b.get("ded"), (int, float)) else num(prog.get("deductible"))
        lim = num(b["lim"]) if isinstance(b.get("lim"), (int, float)) else num(prog.get("limit"))
        acc[key] = {"PortNumber": 1, "AccNumber": key, "PolNumber": key, "PolPerilsCovered": PERIL, "PolPeril": PERIL, "PolDed6All": round(ded * w, 2), "PolDedType6All": 0,
                    "PolLimit6All": round(lim * w, 2) if lim > 0 else 0, "PolLimitType6All": 0, "AccCurrency": "KES"}
    pd.DataFrame(list(acc.values())).to_csv(exp / "account.csv", index=False)

    # reinsurance: quota share first, then a cat XL inuring on what the cedant keeps
    qs, xa, xl = num(prog.get("qs")), num(prog.get("xlAttach")), num(prog.get("xlLimit"))
    ri_info, ri_scope = [], []
    common = {"ReinsPeril": PERIL, "RiskLevel": "", "PlacedPercent": 1, "ReinsCurrency": "KES", "RiskLimit": 0, "RiskAttachment": 0, "OccLimit": 0, "OccAttachment": 0, "TreatyShare": 1}
    if qs > 0:
        ri_info.append({"ReinsNumber": 1, "ReinsLayerNumber": 1, "ReinsName": "Quota share", "InuringPriority": 1, "ReinsType": "QS", "CededPercent": qs, **common})
        ri_scope.append({"ReinsNumber": 1, "PortNumber": 1, "CededPercent": 1})
    if xl > 0:
        n = len(ri_info) + 1
        ri_info.append({"ReinsNumber": n, "ReinsLayerNumber": 1, "ReinsName": "Cat XL", "InuringPriority": len(ri_info) + 1, "ReinsType": "CXL", "CededPercent": 1, **common, "OccLimit": xl, "OccAttachment": xa})
        ri_scope.append({"ReinsNumber": n, "PortNumber": 1, "CededPercent": 1})
    if ri_info:
        pd.DataFrame(ri_info).to_csv(exp / "ri_info.csv", index=False)
        pd.DataFrame(ri_scope).to_csv(exp / "ri_scope.csv", index=False)

    # keys: the built-in Oasis lookup merges area peril and vulnerability ids from these tables
    pd.DataFrame([{"flexilocrfhazard": str(ap), "area_peril_id": ap} for ap in profiles]).to_csv(keys / "areaperil_dict.csv", index=False)
    vd = []
    for vkey, (vb, vc) in vdict.items():
        vd.append({"peril_id": PERIL, "coverage_type": 1, "flexilocrfvuln": vkey, "vulnerability_id": vb})
        vd.append({"peril_id": PERIL, "coverage_type": 3, "flexilocrfvuln": vkey, "vulnerability_id": vc if vc else vb})
    pd.DataFrame(vd).to_csv(keys / "vulnerability_dict.csv", index=False)
    lookup = {
        "model": {"supplier_id": "RiskForge", "model_id": "KE_RIVER_FLOOD", "model_version": "1.0"},
        "keys_data_path": str(keys),
        "step_definition": {
            "split_loc_perils_covered": {"type": "split_loc_perils_covered", "columns": ["locperilscovered"], "parameters": {"model_perils_covered": [PERIL]}},
            "area_peril": {"type": "merge", "columns": ["flexilocrfhazard"], "parameters": {"file_path": "%%KEYS_DATA_PATH%%/areaperil_dict.csv", "id_columns": ["area_peril_id"], "dtype": {"flexilocrfhazard": "str"}}},
            # one row per covered coverage: 1 = buildings, 3 = contents (rows with no TIV are dropped by Oasis)
            "coverage": {"type": "simple_pivot", "columns": [], "parameters": {"pivots": [{"new_cols": {"coverage_type": 1}}, {"new_cols": {"coverage_type": 3}}]}},
            "vulnerability": {"type": "merge", "columns": ["peril_id", "coverage_type", "flexilocrfvuln"], "parameters": {"file_path": "%%KEYS_DATA_PATH%%/vulnerability_dict.csv", "id_columns": ["vulnerability_id"]}},
        },
        "strategy": ["split_loc_perils_covered", "area_peril", "coverage", "vulnerability"],
    }
    (work / "lookup_config.json").write_text(json.dumps(lookup, indent=2))

    # ---- model data ----
    # damage bins every 0.1% (point bins: no secondary uncertainty)
    db = pd.DataFrame({"bin_index": np.arange(1, DAMAGE_STEPS + 2)})
    db["bin_from"] = (db.bin_index - 1) / DAMAGE_STEPS
    db["bin_to"] = db.bin_from
    db["interpolation"] = db.bin_from
    db["damage_type"] = 0
    db.to_csv(model / "damage_bin_dict.csv", index=False)

    # vulnerability: every intensity bin (1 cm of depth) -> one damage bin with probability 1
    depths = np.arange(0, MAX_CM + 1) / 100
    rows = []
    for v, key in enumerate(vulns, start=1):
        if key[0] == "b":
            _, cls, floor, cal = key
            k, cap = CURVES[cls]
            dmg = [min(curve_damage(k, cap, max(dp - floor, 0)) * cal, 1.0) for dp in depths]
        else:
            _, s, m, o, floor, cal = key
            dmg = [min((s * curve_damage(*CONTENTS["stock"], max(dp - floor, 0)) + m * curve_damage(*CONTENTS["machinery"], max(dp - floor, 0)) + o * curve_damage(*CONTENTS["other"], max(dp - floor, 0))) * cal, 1.0) for dp in depths]
        bins = np.rint(np.array(dmg) * DAMAGE_STEPS).astype(int) + 1
        rows.append(pd.DataFrame({"vulnerability_id": v, "intensity_bin_id": np.arange(1, MAX_CM + 2), "damage_bin_id": bins, "probability": 1.0}))
    pd.concat(rows).to_csv(model / "vulnerability.csv", index=False)

    # events: in year p the annual-maximum flood is the 1-in-(N/p) flood (p = 1 .. N/2)
    n_events = n_periods // 2
    ev = pd.DataFrame({"event_id": np.arange(1, n_events + 1)})
    ev.to_csv(model / "events.csv", index=False)
    pd.DataFrame({"event_id": ev.event_id, "period_no": ev.event_id, "occ_year": ev.event_id, "occ_month": 6, "occ_day": 1}).to_csv(model / "occurrence.csv", index=False)

    # footprint: each event's depth at each area peril (dry cells left out)
    fp = []
    for e in range(1, n_events + 1):
        rp = n_periods / e
        for ap, prof in sorted(profiles.items()):  # Oasis wants area perils ascending within an event
            dp = depth_at_rp(prof, rp)
            if dp > 0:
                fp.append((e, ap, min(int(round(dp * 100)), MAX_CM) + 1, 1.0))
    if not fp:  # Oasis needs at least one footprint row
        fp.append((1, next(iter(profiles)), 1, 1.0))
    pd.DataFrame(fp, columns=["event_id", "areaperil_id", "intensity_bin_id", "probability"]).to_csv(model / "footprint.csv", index=False)

    csvtobin = str(OASIS_BIN / "csvtobin")
    for args in (
        ["damagebin", "-i", "damage_bin_dict.csv", "-o", "damage_bin_dict.bin"],
        ["vulnerability", "-d", str(DAMAGE_STEPS + 1), "-i", "vulnerability.csv", "-o", "vulnerability.bin"],
        ["eve", "-i", "events.csv", "-o", "events.bin"],
        ["occurrence", "-P", str(n_periods), "-i", "occurrence.csv", "-o", "occurrence.bin"],
        ["footprint", "-x", "footprint.idx", "-m", str(MAX_CM + 1), "-n", "-i", "footprint.csv", "-o", "footprint.bin"],
    ):
        subprocess.run([csvtobin, *args], cwd=model, check=True, capture_output=True)

    summaries = lambda per_loc: [  # noqa: E731
        {"id": 1, "ord_output": {"ept_full_uncertainty_oep": True, "alt_period": True}},
        *([{"id": 2, "oed_fields": ["LocNumber"], "ord_output": {"alt_period": True}}] if per_loc else []),
    ]
    settings = {
        "version": "3",
        "source_tag": "riskforge",
        "analysis_tag": portfolio.get("name", "portfolio"),
        "model_supplier_id": "RiskForge",
        "model_name_id": "KE_RIVER_FLOOD",
        "number_of_samples": 1,
        "gul_threshold": 0,
        "return_periods": KEY_RPS,
        "model_settings": {},
        "gul_output": True,
        "gul_summaries": summaries(True),
        "il_output": True,
        "il_summaries": summaries(False),
        "ri_output": bool(ri_info),
        "ri_summaries": summaries(False) if ri_info else [],
    }
    (work / "analysis_settings.json").write_text(json.dumps(settings, indent=2))
    return {"locations": len(loc_rows), "accounts": len(acc), "areaPerils": len(profiles), "vulnerabilities": len(vulns), "events": n_events, "periods": n_periods, "footprintRows": len(fp), "reinsurance": [r["ReinsType"] for r in ri_info]}


def run(work: Path):
    exp = work / "exposure"
    cmd = [str(OASIS_BIN / "oasislmf"), "model", "run",
           "-x", str(exp / "location.csv"), "-y", str(exp / "account.csv"),
           "-g", str(work / "lookup_config.json"), "--lookup-data-dir", str(work / "keys_data"),
           "-d", str(work / "model_data"), "-a", str(work / "analysis_settings.json"), "-r", str(work / "run"),
           "-n", str(int(os.environ.get("RF_OASIS_PROCESSES", "2")))]  # small portfolios: few kernel processes
    if (exp / "ri_info.csv").exists():
        cmd += ["-i", str(exp / "ri_info.csv"), "-s", str(exp / "ri_scope.csv")]
    env = {**os.environ, "PATH": f"{OASIS_BIN}:{os.environ.get('PATH', '')}"}
    t0 = time.time()
    p = subprocess.run(cmd, cwd=work, env=env, capture_output=True, text=True)
    (work / "oasis.log").write_text(p.stdout + "\n" + p.stderr)
    if p.returncode != 0:
        raise RuntimeError(f"oasislmf failed ({p.returncode}):\n{(p.stdout + p.stderr)[-3000:]}")
    return time.time() - t0


def collect(work: Path, info: dict, seconds: float):
    out = work / "run" / "output"

    def ept(level):
        f = out / f"{level}_S1_ept.csv"
        if not f.exists():
            return {}
        df = pd.read_csv(f)
        df = df[(df.EPCalc == 2) & (df.EPType == 1)] if "EPType" in df else df  # full uncertainty, OEP
        # lecpy lists every rank's return period (2000/k) as well as the ones asked for: keep exact matches only
        return {k: float(r.Loss) for r in df.itertuples() for k in KEY_RPS if abs(r.ReturnPeriod - k) < 1e-6}

    def aal(level, summary=1):
        f = out / f"{level}_S{summary}_palt.csv"
        if not f.exists():
            f = out / f"{level}_S{summary}_alt.csv"
        if not f.exists():
            return None
        df = pd.read_csv(f)
        df = df[df.SampleType == 1] if "SampleType" in df else df  # analytical mean
        return df

    gul, il, ri = ept("gul"), ept("il"), ept("ri")
    a_gul, a_il, a_ri = aal("gul"), aal("il"), aal("ri")
    mean = lambda df: float(df.MeanLoss.sum()) if df is not None and len(df) else 0.0  # noqa: E731
    has_ri = bool(ri)
    by_rp = {}
    for rp in KEY_RPS:
        g, i = gul.get(rp, 0.0), il.get(rp, 0.0)
        n = ri.get(rp, i) if has_ri else i
        by_rp[str(rp)] = {"gu": g, "owner": g - i, "gross": i, "reinsurer": i - n, "net": n}
    aal_gu, aal_il = mean(a_gul), mean(a_il)
    aal_net = mean(a_ri) if has_ri else aal_il
    per_loc = {}
    loc_map = None
    s2 = aal("gul", 2)
    if s2 is not None:
        info_f = out / "gul_S2_summary-info.csv"
        if info_f.exists():
            loc_map = pd.read_csv(info_f, dtype={"LocNumber": str}).set_index("summary_id")["LocNumber"].to_dict()
            per_loc = {loc_map.get(int(r.SummaryId), str(r.SummaryId)): float(r.MeanLoss) for r in s2.itertuples()}
    reins = {"gu": aal_gu, "gross": aal_il, "reinsurer": aal_il - aal_net, "net": aal_net}
    return {
        "engine": f"Oasis LMF {oasis_version()} (gulmc, fmpy, aalpy, lecpy)",
        "model": "RiskForge KE_RIVER_FLOOD 1.0: JRC global flood maps (30\"), Huizinga-Africa curves per class",
        "seconds": round(seconds, 1),
        "run": info,
        "aal": reins,
        "byRp": by_rp,
        "perLocationAal": per_loc,
    }


def oasis_version():
    try:
        from importlib.metadata import version
        return version("oasislmf")
    except Exception:
        return "?"


def run_portfolio(portfolio, work=None, keep=True):
    work = Path(work or RUNS / str(int(time.time() * 1000)))
    try:
        info = build(portfolio, work)
        seconds = run(work)
        return collect(work, info, seconds)
    finally:
        if not keep:  # a container's disk is memory: drop the run folder once the results are read
            shutil.rmtree(work, ignore_errors=True)


def book_portfolio():
    fc = json.loads((DATA / "buildings_book.geojson").read_text(encoding="utf-8"))
    return {"name": "Risk Forge book", "buildings": [f["properties"] for f in fc["features"]],
            "programme": {"deductible": 25_000, "limit": 0, "qs": 0.25, "xlAttach": 4_000_000, "xlLimit": 4_000_000}}


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "book":
        res = run_portfolio(book_portfolio(), RUNS / "book")
        res["portfolio"] = "Risk Forge book"
        res["programme"] = book_portfolio()["programme"]
        (DATA / "oasis_book.json").write_text(json.dumps(res, separators=(",", ":")))
        print(json.dumps({k: v for k, v in res.items() if k != "perLocationAal"}, indent=1))
    elif len(sys.argv) >= 4 and sys.argv[1] == "run":
        res = run_portfolio(json.loads(Path(sys.argv[2]).read_text(encoding="utf-8")))
        Path(sys.argv[3]).write_text(json.dumps(res))
        print(json.dumps({k: v for k, v in res.items() if k != "perLocationAal"}, indent=1))
    else:
        print(__doc__)
