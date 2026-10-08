"""Compile the Oasis kernel once, while the container image is built.

Oasis's Python kernel (gulmc, fmpy, aalpy, lecpy, ...) is JIT-compiled by numba on first use, which takes minutes.
Running one small portfolio through every path we use (structures and contents, a multi-building policy, quota share
and cat XL) stores the compiled code in the image. NUMBA_CPU_NAME=generic keeps that cache valid on whatever CPU
Cloud Run starts the container on.
"""
import json
import time

from riskforge_oasis import DATA, run_portfolio

fc = json.loads((DATA / "buildings_book.geojson").read_text(encoding="utf-8"))
wet = [f["properties"] for f in fc["features"] if (f["properties"].get("d100") or 0) > 0][:40]
site = dict(wet[0])
extra = []
for i, (cls, floor, cs, cm) in enumerate([("concrete_rcc", 0.6, 0, 9_000_000), ("semi_permanent", 0, 12_000_000, 0), ("permanent_masonry", 0.3, 0, 0)]):
    b = dict(site, id=f"WARM-{i}", cls=cls, floor=floor, cs=cs, cm=cm, co=0, policy="WARM", ded=500_000, lim=40_000_000, w=1, cal=0.8)
    extra.append(b)
portfolio = {"name": "warm-up", "buildings": wet + extra, "programme": {"deductible": 25_000, "limit": 0, "qs": 0.4, "xlAttach": 2_000_000, "xlLimit": 5_000_000}}
t0 = time.time()
res = run_portfolio(portfolio, keep=False)
print(f"warm-up done in {time.time() - t0:.0f} s; 1-in-100 ground-up KES {res['byRp']['100']['gu']:,.0f}", flush=True)
