"""Oasis LMF runner for the Risk Forge web app.

    POST /run     {"name": str, "buildings": [...], "programme": {...}}  ->  Oasis results (see riskforge_oasis.collect)
    GET  /health  {"ok": true, "oasislmf": "2.5.8"}

The web app (local or https://riskforge-nzoia.vercel.app) calls it from the browser, so it answers CORS and
Private Network Access preflights for those origins only. One run at a time; portfolios up to 5,000 buildings.

Run (Linux / WSL):  python server.py [port]        default 8765, listening on 127.0.0.1
In a container (Cloud Run): HOST=0.0.0.0, PORT from the platform, RF_REQUIRE_ORIGIN=1 (runs only from the site).
"""
import hmac
import json
import os
import sys
import threading
import time
import traceback
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from riskforge_oasis import oasis_version, run_portfolio

ALLOWED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173", "https://riskforge-nzoia.vercel.app"}
MAX_BYTES = 20 * 1024 * 1024
MAX_BUILDINGS = 5000
RUNS_PER_HOUR = int(os.environ.get("RF_RUNS_PER_HOUR", "30"))  # per client address, per instance
REQUIRE_ORIGIN = os.environ.get("RF_REQUIRE_ORIGIN") == "1"
# behind the site's /api/oasis relay (oasis/start_public.sh): runs must carry the shared secret
RELAY_SECRET = os.environ.get("RF_RELAY_SECRET", "")
REQUIRE_SECRET = os.environ.get("RF_REQUIRE_SECRET") == "1"
recent = defaultdict(deque)


def limited(ip):
    now = time.time()
    q = recent[ip]
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= RUNS_PER_HOUR:
        return True
    q.append(now)
    return False
BUILDING_KEYS = {"id", "cls", "tiv", "lat", "lon", "d10", "d20", "d50", "d100", "d200", "d500", "floor", "cs", "cm", "co", "cal", "w", "policy", "ded", "lim"}
CLASSES = {"informal_iron_sheet", "semi_permanent", "permanent_masonry", "concrete_rcc"}
lock = threading.Lock()


def clean(portfolio):
    """only the fields the model uses, with the types it expects"""
    if not isinstance(portfolio, dict) or not isinstance(portfolio.get("buildings"), list):
        raise ValueError("expected {name, buildings: [...], programme: {...}}")
    bs = portfolio["buildings"]
    if not 0 < len(bs) <= MAX_BUILDINGS:
        raise ValueError(f"1 to {MAX_BUILDINGS} buildings")
    out = []
    for b in bs:
        if not isinstance(b, dict) or b.get("cls") not in CLASSES:
            raise ValueError("every building needs a known construction class")
        c = {k: v for k, v in b.items() if k in BUILDING_KEYS and (isinstance(v, (int, float)) or (k in ("id", "cls", "policy") and isinstance(v, str)))}
        for k in ("tiv", "lat", "lon"):
            if not isinstance(c.get(k), (int, float)):
                raise ValueError(f"building {b.get('id')} has no {k}")
        c["id"] = str(b.get("id"))[:40]
        out.append(c)
    p = portfolio.get("programme") or {}
    prog = {k: float(p.get(k) or 0) for k in ("deductible", "limit", "qs", "xlAttach", "xlLimit")}
    prog["qs"] = min(max(prog["qs"], 0), 1)
    return {"name": str(portfolio.get("name", "portfolio"))[:80], "buildings": out, "programme": prog}


class Handler(BaseHTTPRequestHandler):
    server_version = "RiskForgeOasis/1.0"

    def cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "content-type")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.cors()
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/health"):
            return self.reply(200, {"ok": True, "oasislmf": oasis_version(), "busy": lock.locked()})
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/run"):
            return self.reply(404, {"error": "not found"})
        relayed = bool(RELAY_SECRET) and hmac.compare_digest(self.headers.get("x-relay-secret", ""), RELAY_SECRET)
        if REQUIRE_SECRET and not relayed:
            return self.reply(403, {"error": "runs are accepted through the Risk Forge site only"})
        if not relayed:  # the relay already limits each visitor; direct callers are limited here
            if REQUIRE_ORIGIN and self.headers.get("Origin", "") not in ALLOWED_ORIGINS:
                return self.reply(403, {"error": "runs are accepted from the Risk Forge site only"})
            ip = (self.headers.get("X-Forwarded-For") or self.client_address[0]).split(",")[0].strip()
            if limited(ip):
                return self.reply(429, {"error": f"limit of {RUNS_PER_HOUR} Oasis runs an hour reached; try later"})
        n = int(self.headers.get("content-length") or 0)
        if not 0 < n <= MAX_BYTES:
            return self.reply(413, {"error": "portfolio too large"})
        try:
            portfolio = clean(json.loads(self.rfile.read(n)))
        except (ValueError, json.JSONDecodeError) as e:
            return self.reply(400, {"error": str(e)})
        if not lock.acquire(blocking=False):
            return self.reply(429, {"error": "Oasis is busy with another run; try again in a moment"})
        try:
            result = run_portfolio(portfolio, keep=False)
            result["portfolio"] = portfolio["name"]
            result["programme"] = portfolio["programme"]
            self.reply(200, result)
        except Exception as e:  # report, never crash the server
            traceback.print_exc()
            self.reply(500, {"error": f"Oasis run failed: {str(e)[-600:]}"})
        finally:
            lock.release()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", "8765"))
    host = os.environ.get("HOST", "127.0.0.1")
    print(f"Risk Forge Oasis runner on http://{host}:{port} (oasislmf {oasis_version()})", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
