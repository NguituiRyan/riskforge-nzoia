"""Extend the AI-intake gazetteer with sub-counties, wards and villages brokers actually name, plus common spellings.

Brokers write "near Bunyala" or "Budalang'i", not our 37 town names; an unknown name used to drop the whole group.
Coordinates come from OpenStreetMap Nominatim (one request a second, as its usage policy asks); only results inside the
basin box are kept. Run once, then `python scripts/prepare_3d_data.py` moves any point that lands on water onto land.

Run:  python scripts/extend_gazetteer.py
"""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GAZ = ROOT / "web" / "public" / "data" / "gazetteer.json"
BOX = (33.7, -0.6, 35.7, 1.3)  # lon/lat bounds of the hazard grid

# (name, kind, search text). kind "area" = sub-county or ward: placement there is approximate
CANDIDATES = [
    ("Bunyala", "area", "Bunyala, Busia County, Kenya"),
    ("Bunyala North", "area", "Bunyala North, Busia, Kenya"),
    ("Bunyala South", "area", "Bunyala South, Busia, Kenya"),
    ("Bunyala Central", "area", "Bunyala Central, Busia, Kenya"),
    ("Bunyala West", "area", "Bunyala West, Busia, Kenya"),
    ("Samia", "area", "Samia, Busia County, Kenya"),
    ("Nambale", "area", "Nambale, Busia County, Kenya"),
    ("Teso North", "area", "Teso North, Busia, Kenya"),
    ("Teso South", "area", "Teso South, Busia, Kenya"),
    ("Ugenya", "area", "Ugenya, Siaya County, Kenya"),
    ("Alego Usonga", "area", "Alego Usonga, Siaya, Kenya"),
    ("Gem", "area", "Gem, Siaya County, Kenya"),
    ("Rarieda", "area", "Rarieda, Siaya County, Kenya"),
    ("Mumias East", "area", "Mumias East, Kakamega, Kenya"),
    ("Mumias West", "area", "Mumias West, Kakamega, Kenya"),
    ("Matungu", "area", "Matungu, Kakamega County, Kenya"),
    ("Khwisero", "area", "Khwisero, Kakamega County, Kenya"),
    ("Butere", "area", "Butere, Kakamega County, Kenya"),
    ("Navakholo", "area", "Navakholo, Kakamega County, Kenya"),
    ("Lugari", "area", "Lugari, Kakamega County, Kenya"),
    ("Lurambi", "area", "Lurambi, Kakamega, Kenya"),
    ("Kanduyi", "area", "Kanduyi, Bungoma, Kenya"),
    ("Bumula", "area", "Bumula, Bungoma County, Kenya"),
    ("Webuye East", "area", "Webuye East, Bungoma, Kenya"),
    ("Webuye West", "area", "Webuye West, Bungoma, Kenya"),
    ("Kimilili", "area", "Kimilili, Bungoma County, Kenya"),
    ("Rugunga", "village", "Rugunga, Busia, Kenya"),
    ("Runyu", "village", "Runyu, Busia, Kenya"),
    ("Magombe", "village", "Magombe, Busia, Kenya"),
    ("Mukhobola", "village", "Mukhobola, Busia, Kenya"),
    ("Iyanga", "village", "Iyanga, Busia, Kenya"),
    ("Bulwani", "village", "Bulwani, Busia, Kenya"),
    ("Nyadorera", "village", "Nyadorera, Siaya, Kenya"),
    ("Yala", "town", "Yala, Siaya County, Kenya"),
    ("Sidindi", "village", "Sidindi, Siaya, Kenya"),
    ("Usenge", "village", "Usenge, Siaya, Kenya"),
]

# other spellings brokers use -> our name (Claude is told to answer with our name)
ALIASES = {
    "Budalangi": ["Budalang'i", "Budalangi Centre"],
    "Port Victoria": ["Port Vic", "Bunyala Port"],
    "Bunyala": ["Bunyala sub-county", "Budalang'i constituency"],
    "Mumias": ["Mumias town"],
    "Sio Port": ["Sio-Port", "Sioport"],
    "Busia": ["Busia town"],
    "Siaya": ["Siaya town"],
    "Mt Elgon": ["Mount Elgon"],
}


def geocode(q):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": q, "format": "jsonv2", "limit": 1, "countrycodes": "ke"})
    req = urllib.request.Request(url, headers={"User-Agent": "RiskForge-hackathon/1.0 (Kenya Re AI Hackathon, Nzoia flood model)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        hits = json.load(r)
    return (float(hits[0]["lat"]), float(hits[0]["lon"]), hits[0].get("display_name", "")) if hits else None


def main():
    places = json.loads(GAZ.read_text(encoding="utf-8"))
    have = {p["name"] for p in places}
    added, missed = [], []
    for name, kind, q in CANDIDATES:
        if name in have:
            continue
        hit = geocode(q)
        time.sleep(1.1)
        if not hit or not (BOX[0] < hit[1] < BOX[2] and BOX[1] < hit[0] < BOX[3]):
            missed.append(name)
            continue
        places.append({"name": name, "lat": round(hit[0], 4), "lon": round(hit[1], 4), "kind": kind})
        added.append(f"{name} ({hit[2].split(',')[0]})")
    for p in places:
        if p["name"] in ALIASES:
            p["aliases"] = ALIASES[p["name"]]
    places.sort(key=lambda p: p["name"])
    GAZ.write_text(json.dumps(places, indent=0, ensure_ascii=False), encoding="utf-8")
    print(f"gazetteer: {len(places)} places; added {len(added)}: {', '.join(added)}")
    print("not found in the basin:", ", ".join(missed) or "none")


if __name__ == "__main__":
    main()
