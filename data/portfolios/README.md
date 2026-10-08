# Portfolios and hazard (Nzoia)

All buildings here are **synthetic**. None is a real client property.

| File | What it is |
|---|---|
| `exposure_nzoia_riskforge_book.csv` | **Risk Forge book**: 1,200 synthetic buildings from `scripts/generate_book.py` (seed 2026) |
| `book_with_hazard.csv` | The book, plus a location flag and flood hazard at six return periods |
| `starter_with_hazard.csv` | The hosts' starter CSV (500 rows), with the same hazard columns and location flags |

Regenerate everything with:

```bash
python scripts/generate_book.py && python scripts/prepare_3d_data.py
```

## Hazard columns (Step 1 of the brief, applied to Nzoia)

For each return period T in 10, 20, 50, 100, 200 and 500 years:

| Column | Meaning |
|---|---|
| `hazard_depth_m_rpT` | Flood depth in **metres**, read from the JRC global river flood map for that return period. Real data. Cells are about 925 m across, so this is the cell's depth, not the depth at the front door. `0` = dry. |
| `hazard_severity_rpT` | **0–1 severity score** = min(depth ÷ 4 m, 1). The 4 m reference is the brief's own "extreme flooding" example, roughly roof level of a single-storey house: 0.25 ≈ 1 m (ground floor flooded), 0.5 ≈ 2 m, 1.0 = 4 m or more. It puts Nzoia on the same 0–1 scale as the Nairobi data. **The damage curves use the depth in metres, not the score**, because Nzoia has real depths. |

**Assumptions:**
- The JRC maps are *undefended*: they ignore the Budalangi dykes.
- They carry "depth" over Lake Victoria. Those lake cells are masked in the 3D view.
- **Permanent water:** a cell already 3.5 m or deeper at 1-in-10 is the river channel or the lake edge (140 cells). At about 925 m, a narrow channel cell carries the channel's depth, not a flood plain's, so no building is placed there. These cells are drawn flat as water in the 3D view. Gazetteer points that land on one move to the nearest land cell (Port Victoria moved 0.7 km).

## How the Risk Forge book was built

- **Where:** JRC grid cells on Kenyan land (geoBoundaries ADM0), outside Lake Victoria (Natural Earth 10 m) and never on permanent water (above). A building jittered over the shore or the border is drawn again.
  - Each cell is weighted by WorldPop 2020 population (1 km, UN-adjusted) × an insurance-uptake factor: urban 4, peri-urban 1.5, rural 1. The uptake factor is an assumption that insured property concentrates in towns.
  - Density classes: urban ≥ 1,500 people/km²; peri-urban 400–1,500; rural < 400.
- **Stratified:**
  - 15% of rows (180) are drawn from the floodplain zone: land wet at 1-in-500, plus about 2 km either side.
  - 85% (1,020) are drawn from the rest of the basin.
  - `sample_weight` re-weights rows back to a purely population-proportional book: ×0.1383 for flood-plain rows, ×1.1521 for the rest. **Every portfolio total in the app uses these weights** (value, losses, AAL, 1-in-250, premium); counts are of the sample buildings on the map. Without the stratification only about 1% of rows would sit in the flood footprint (≈ 120,000 of the basin's 11.4 M people live there).
- **What:** the housing-class mix depends on density.
  - Floor area and cost/m² are drawn inside the ranges in the dataset metadata (section 5).
  - `tiv_kes` = floor area × cost/m², rounded to the nearest KES 5,000.
- **Result (weighted):**
  - 1,200 buildings, KES 7.50 bn total insured value.
  - 40 sample buildings wet at 1-in-100. Loss at 1-in-100 is KES 8.2 M; AAL is KES 2.0 M, with losses assumed to start at 1-in-2.
  - Unweighted, the same sample shows KES 59.5 M at 1-in-100. That is the flood-plain-enriched sample as drawn, not a portfolio.
  - The loss sits around Rwambwa, Port Victoria and Budalang'i.

## Starter CSV issues (under review with the hosts)

- 118 rows fall in Uganda and 45 inside Lake Victoria (`location_flag` = `UG` / `LAKE`; `WATER` would mark a row on the river channel).
- Lake rows are **left out of the losses**: 1-in-100 loss KES 40.6 M as provided, KES 4.7 M cleaned, KES 0.3 M for Kenyan rows only (2 buildings flooded).
- `tiv_kes` in the CSV is 10× floor area × cost. We use area × cost, as the metadata specifies.
