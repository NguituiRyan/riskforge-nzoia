"""River-node calibration and replay data for the live mode (web/public/data/river_node.json).

Chain shown in the app:  sensor level (tank cm) -> river stage at Rwambwa (m) -> return period -> flood footprint -> loss

  * Frequency: Gumbel fitted by moments to GloFAS v4 reanalysis annual maxima at the lower Nzoia (1997-2025),
    via the Open-Meteo Flood API (0.125N, 34.075E). GloFAS is a model, not a gauge: use the return periods,
    not the absolute flows.
  * Stage -> return period: ASSUMPTION. A monotone table anchored on the published Rwambwa alert level (2.8 m,
    taken as the onset of flooding at ~1-in-2). Replace with WRA's Rwambwa rating curve and gauge record.
  * Replay: the GloFAS hydrograph around the largest peak in the record (6 Sep 2020), converted to stage with the
    same table, so the demo works without hardware.

Run:  python scripts/build_node_data.py
"""
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
GLOFAS = ROOT / "data" / "reference" / "glofas_rwambwa_1997_2026.json"
OUT = ROOT / "web" / "public" / "data" / "river_node.json"

STAGE_TABLE = [  # (stage m at Rwambwa, return period years) - ASSUMPTION, see docstring
    (2.8, 2), (3.5, 5), (4.2, 10), (4.8, 20), (5.5, 50), (6.0, 100), (6.4, 200), (7.0, 500),
]
ALERTS = [  # (min stage m, label)
    (0.0, "Normal"), (2.8, "Alert"), (4.2, "Warning"), (5.5, "Danger"),
]


def stage_for_rp(rp, q, q2):
    if rp >= STAGE_TABLE[0][1]:
        xs = [math.log(r) for _, r in STAGE_TABLE]
        ys = [s for s, _ in STAGE_TABLE]
        return float(np.interp(math.log(min(rp, 500)), xs, ys))
    return 1.0 + 1.8 * min(q / q2, 1.0) ** 2  # below bankfull: display-only rise to the alert level


def main():
    d = json.loads(GLOFAS.read_text(encoding="utf-8"))
    s = pd.Series(d["daily"]["river_discharge"], index=pd.to_datetime(d["daily"]["time"])).dropna()
    am = s[s.index.year <= 2025].groupby(s.index.year[s.index.year <= 2025]).max()
    beta = float(am.std() * math.sqrt(6) / math.pi)
    mu = float(am.mean() - 0.5772 * beta)

    def rp_of(q):
        p = 1 - math.exp(-math.exp(-(q - mu) / beta))
        return 1 / max(p, 1e-6)

    q2 = mu - beta * math.log(-math.log(1 - 1 / 2))
    window = s["2020-07-20":"2020-10-20"]
    replay = []
    for t, q in window.items():
        rp = rp_of(q)
        replay.append({"date": t.strftime("%Y-%m-%d"), "q": round(float(q), 1), "rp": round(rp, 2), "stage": round(stage_for_rp(rp, q, q2), 2)})

    out = {
        "node": {"id": "RF-NZ-01", "name": "Rwambwa Bridge", "lat": 0.1289, "lon": 34.0915},
        "gumbel": {"mu": round(mu, 1), "beta": round(beta, 1), "years": int(len(am)), "source": "GloFAS v4 reanalysis via Open-Meteo Flood API, annual maxima 1997-2025"},
        "q2": round(q2, 1),
        "stageTable": [{"stage": st, "rp": rp, "q": round(mu - beta * math.log(-math.log(1 - 1 / rp)), 0)} for st, rp in STAGE_TABLE],
        "alerts": [{"stage": st, "label": lab} for st, lab in ALERTS],
        "replay": {"title": "September 2020 peak (largest in the GloFAS record)", "peakDate": str(window.idxmax().date()), "series": replay},
    }
    OUT.write_text(json.dumps(out, indent=1))
    peak = max(replay, key=lambda r: r["q"])
    print(f"Gumbel mu={mu:.0f} beta={beta:.0f}; Q2={q2:.0f}; replay {len(replay)} days, peak {peak}")


if __name__ == "__main__":
    main()
