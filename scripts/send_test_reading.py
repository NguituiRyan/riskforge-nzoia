"""Send HMAC-signed river-node readings to /api/node, as the ESP32 does in Wi-Fi mode.

Usage:
  python scripts/send_test_reading.py [level_cm] [--url URL]   one genuine reading (default 14 cm)
  python scripts/send_test_reading.py 8 --pour 18 [--url URL]  a virtual node: 8 cm rising to 18 cm, one reading every 3 s
  python scripts/send_test_reading.py --forge [--url URL]      a wrong signature: rejected (401)
  python scripts/send_test_reading.py --replay [--url URL]     a genuine reading sent twice: the copy is rejected (409)
URL defaults to http://localhost:5173/api/node; the live one is https://riskforge-nzoia.vercel.app/api/node.
Reads NODE_SECRET from the repo-root .env.
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
NODE = "RF-NZ-01"
EVERY_S = 3  # the firmware's POST_EVERY_MS


def secret() -> str:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("NODE_SECRET="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("NODE_SECRET missing from .env")


def signed(level_cm: float, seq: int, forge: bool = False) -> bytes:
    ts = int(time.time())
    msg = f"{NODE}|{seq}|{ts}|{level_cm:.1f}"
    sig = "00" * 32 if forge else hmac.new(secret().encode(), msg.encode(), hashlib.sha256).hexdigest()
    return json.dumps({"node": NODE, "seq": seq, "ts": ts, "level_cm": round(level_cm, 1), "sig": sig}).encode()


def post(url: str, body: bytes) -> None:
    req = urllib.request.Request(url, data=body, headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(r.status, r.read().decode())
    except urllib.error.HTTPError as e:
        print(e.code, e.read().decode())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("level_cm", nargs="?", type=float, default=14.0)
    ap.add_argument("--url", default="http://localhost:5173/api/node")
    ap.add_argument("--forge", action="store_true", help="send a wrong signature")
    ap.add_argument("--replay", action="store_true", help="send one genuine reading twice")
    ap.add_argument("--pour", type=float, metavar="TO_CM", help="stream readings rising to this level, every 3 s")
    a = ap.parse_args()
    seq = int(time.time()) % 100000

    if a.pour is not None:
        steps = max(1, round(abs(a.pour - a.level_cm) / 0.8))
        for i in range(steps + 1):
            level = a.level_cm + (a.pour - a.level_cm) * i / steps
            print(f"{level:5.1f} cm ->", end=" ")
            post(a.url, signed(level, seq + i))
            if i < steps:
                time.sleep(EVERY_S)
        return

    body = signed(a.level_cm, seq, a.forge)
    post(a.url, body)
    if a.replay:
        time.sleep(1)
        print("same reading again ->", end=" ")
        post(a.url, body)


if __name__ == "__main__":
    main()
