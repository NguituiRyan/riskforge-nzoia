# Risk Forge: Nzoia river-flood catastrophe model

**Live:** https://riskforge-nzoia.vercel.app · Team B, Kenya Re AI Hackathon 2026

Pick a flood rarity, see which insured buildings in Kenya's Nzoia basin get wet, what the damage costs, and what to charge and cap. Every number is labelled real, synthetic or assumption.

## How it works

| Step | What happens | Data |
|---|---|---|
| 1. Hazard | Flood depth per building at six return periods (1-in-10 to 1-in-500), anywhere in Kenya. River-channel and lake cells are treated as water. | JRC global river flood maps (real, about 925 m cells), cut to Kenya; identical to the hackathon's Nzoia clips where they overlap |
| 2. Damage | Depth to % damage per building class | Huizinga et al. 2017 JRC Africa curve, adapted per class after Englhardt et al. 2019 (assumption) |
| 3. Exposure | The hosts' 500-row starter file, cleaned of lake points; and a 1,200-building book placed on WorldPop population, flood plain over-sampled and weighted back | Synthetic buildings on real population |
| 4. Money | Ground-up loss, deductibles and limits, quota share and cat XL, AAL and EP curves (1-in-10 to 1-in-500), technical premium | **Oasis LMF** (`oasis/`): OED exposure + the Risk Forge Oasis model; the browser engine is an instant preview that matches Oasis within 0.5% |
| 5. AI | Claude turns broker emails or CSVs into priced buildings for the underwriter to approve, and writes a briefing whose figures are verified | Claude Sonnet 5.5 |
| 6. Interface | 3D map, and an underwriter report that opens on the decision | |

There's also a **river node**: an ESP32 with an ultrasonic sensor sends HMAC-signed water levels over Wi-Fi. The dashboard turns each one into a return period, a live event loss and a two-step parametric trigger. See [hardware/](hardware/).

## Repository

| Path | What |
|---|---|
| `web/` | Vite + React + TypeScript app; `web/api/` holds the serverless functions (AI intake, briefing, river node) |
| `scripts/` | Python data pipeline: `generate_book.py`, `prepare_3d_data.py`, `prepare_kenya_hazard.py`, `extend_gazetteer.py`, `build_node_data.py`, `send_test_reading.py` |
| `samples/` | Fictional broker offers (approve / decline) for the AI analyst |
| `oasis/` | The Risk Forge model for Oasis LMF, the OED exporter, and the runner the web app calls ([oasis/README.md](oasis/README.md)) |
| `data/portfolios/` | Portfolios with hazard attached, and how they were built |
| `team_b_nzoia/` | Hackathon inputs: JRC flood-map clips and the starter exposure CSV |
| `hardware/` | River-node firmware and build sheet |

## Run it

```bash
python scripts/generate_book.py && python scripts/prepare_3d_data.py
cd web && npm install && npm run dev
```

Kenya-wide hazard and places (one-off, about 280 MB of downloads into the git-ignored `data/jrc_global/` and `data/geonames/`; URLs in the script):

```bash
python -I scripts/prepare_kenya_hazard.py data/jrc_global data/geonames/KE.zip
```

Copy `.env.example` to `.env` and fill in `ANTHROPIC_API_KEY` and `NODE_SECRET` to use the AI and the river node locally.

## Data and credits

- **Flood hazard:** European Commission Joint Research Centre, global river flood hazard maps (Dottori et al. 2016; CC BY 4.0), for the Nzoia and the rest of Kenya.
- **Kenyan places:** GeoNames (CC BY 4.0), geonames.org.
- **Loss calculation:** Oasis Loss Modelling Framework (BSD 3-Clause), oasislmf.org.
- **Population:** WorldPop 2020, 1 km, UN-adjusted (CC BY 4.0).
- **Borders:** geoBoundaries (CC BY 4.0).
- **Lake Victoria:** Natural Earth (public domain).
- **River and place names:** © OpenStreetMap contributors (ODbL).
- **River flow:** GloFAS v4 via the Open-Meteo Flood API.
- **Imagery and terrain** in the 3D view: Esri World Imagery; AWS Terrain Tiles (Mapzen).

All buildings are synthetic; none is a real client property.

Built by [Rytrix](https://rytrix.co.ke).
