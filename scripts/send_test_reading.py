"""Send one HMAC-signed river-node reading to /api/node, as the ESP32 does in Wi-Fi mode.

Usage:  python scripts/send_test_reading.py [level_cm] [--url http://localhost:5173/api/node] [--forge]
Reads NODE_SECRET from the repo-root .env. --forge sends a wrong signature to show the rejection.
"""
import argparse
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def secret() -> str:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("NODE_SECRET="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("NODE_SECRET missing from .env")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("level_cm", nargs="?", type=float, default=14.0)
    ap.add_argument("--url", default="http://localhost:5173/api/node")
    ap.add_argument("--forge", action="store_true")
    a = ap.parse_args()
    node, seq, ts = "RF-NZ-01", int(time.time()) % 100000, int(time.time())
    msg = f"{node}|{seq}|{ts}|{a.level_cm:.1f}"
    sig = "00" * 32 if a.forge else hmac.new(secret().encode(), msg.encode(), hashlib.sha256).hexdigest()
    body = json.dumps({"node": node, "seq": seq, "ts": ts, "level_cm": round(a.level_cm, 1), "sig": sig}).encode()
    req = urllib.request.Request(a.url, data=body, headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(r.status, r.read().decode())
    except urllib.error.HTTPError as e:
        print(e.code, e.read().decode())


if __name__ == "__main__":
    main()
