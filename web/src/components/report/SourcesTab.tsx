import { useMemo, useState } from "react";
import { Badge, Card, td, th, tr } from "./ui";
import type { ReportProps } from "./Report";
import type { PortfolioView } from "../../lib/types";
import { CLASSES, RPS } from "../../lib/types";
import { CURVES, KEY_RPS, ONSET_RP, runPortfolio, SEVERITY_REF_M, technicalPremium } from "../../lib/engine";
import { download } from "../../lib/report";
import { CLASS_LABEL, kes } from "../../lib/format";

const STEPS: [string, string, string][] = [
  ["1 · Hazard", "Every building's flood depth read from the six JRC maps (10–500 years); a 0–1 severity score = depth ÷ 4 m alongside. Lake Victoria cells masked.", "Buildings tab · building card"],
  ["2 · Vulnerability", "Documented depth-damage function per housing class: cap × Huizinga-Africa(k × depth).", "Vulnerability tab"],
  ["3 · Exposure", "Starter CSV from the hosts (with its location issues flagged) and the 1,200-building Risk Forge book placed on WorldPop population; same columns as exposure_nzoia_synthetic.csv.", "Portfolio switch · Buildings tab"],
  ["4 · Financial engine", "Loss = damage ratio × insured value per building and return period; portfolio loss per return period; EP curve; AAL; 1-in-250 by interpolation.", "Summary tab · EP curve"],
  ["5 · AI layer", "Risk Forge AI (built on Claude Sonnet 5.5) turns broker free text into exposure rows that change the losses (underwriter approves), and writes a briefing whose numbers are verified against the engine.", "AI analyst tab"],
  ["6 · Results interface", "Total exposure, loss at key return periods, EP curve, class breakdown, AI output - with real / synthetic / assumption labels throughout.", "This report and the map"],
];

const SOURCES: [string, "real" | "synthetic" | "assumption", string, string][] = [
  ["JRC Global River Flood Hazard Maps, rp10–rp500 (~925 m cells, undefended)", "real", "European Commission JRC; free use", "data.jrc.ec.europa.eu/collection/id-0054"],
  ["Huizinga, de Moel & Szewczyk (2017) global depth-damage functions", "real", "JRC technical report EUR 28552", "publications.jrc.ec.europa.eu"],
  ["Englhardt et al. (2019) building-material vulnerability curves", "real", "NHESS 19:1703", "nhess.copernicus.org/articles/19/1703/2019"],
  ["WorldPop 2020, 1 km, UN-adjusted (placing the Risk Forge book)", "real", "CC BY 4.0", "worldpop.org"],
  ["GloFAS v4 reanalysis discharge, 1997–2026 (river node frequency)", "real", "Copernicus / Open-Meteo, CC BY 4.0", "open-meteo.com/en/docs/flood-api"],
  ["Rwambwa alert level 2.8 m (Nzoia flood bulletin, Dec 2009)", "real", "ReliefWeb", "reliefweb.int"],
  ["Kenya / Uganda borders; Lake Victoria; Nzoia river; place names", "real", "geoBoundaries CC BY 4.0 · Natural Earth PD · OpenStreetMap ODbL", "geoboundaries.org · openstreetmap.org"],
  ["JRC global flood maps cut to Kenya (same product and grid as the Nzoia clips; checked cell for cell: 0.00 m difference)", "real", "European Commission JRC; free use", "jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/FLOODS/GlobalMaps"],
  ["16,635 Kenyan places with their county (towns, villages, reserves, lodges, rivers…)", "real", "GeoNames CC BY 4.0", "geonames.org"],
  ["Starter exposure CSV (500 buildings)", "synthetic", "Hackathon hosts", "team_b_nzoia/"],
  ["Risk Forge book (1,200 buildings)", "synthetic", "scripts/generate_book.py, seed 2026", "data/portfolios/"],
  ["Imagery and terrain in the 3D view", "real", "Esri World Imagery · AWS Terrain Tiles (Mapzen)", "display only"],
];

/** the non-functional answers judges ask for: where it runs, what the AI sees, what it costs, who owns it */
const PRODUCTION: [string, string, string][] = [
    ["Hosting and data residency", "the prototype runs on Vercel in Mumbai; synthetic data only", "the same web app on Kenya Re servers or a Nairobi data centre, so client schedules never leave Kenya"],
    ["AI", "Claude (US) reads pasted text; only synthetic text and aggregated figures are sent", "send anonymised text only, or swap in an open model hosted in Kenya - the AI sits behind one interface"],
    ["Running cost", "near zero: a static site plus small functions; AI is pay-per-use (about 2,500 tokens per broker email in tests)", "the same, plus a hazard licence (JBA or Fathom) when 30 m maps are needed"],
    ["Documents and personal data", "offer PDFs and Word files are read in the browser; names, phone numbers and emails are removed before the AI sees the text; nothing is stored", "the same, inside Kenya Re's network, with an audit log of who analysed which offer"],
    ["Security", "river-node readings are HMAC-signed, forged and replayed readings are rejected and counted; the AI endpoints are rate-limited per address and size-capped; security headers on every page", "pin the server certificate on nodes, per-node keys, and single sign-on for underwriters"],
    ["River data", "a demo node in a tank, plus the replayed 2020 GloFAS flood", "the Water Resources Authority's Rwambwa gauge feed for parametric cover; own nodes only where there is no gauge"],
    ["Ownership and governance", "open code; every number traceable; two engines (Python and browser) agree within 0.06%", "Kenya Re's cat-modelling team owns it; versioned data scripts, a model change log and yearly validation against claims"],
];

export default function SourcesTab({ stats, baseBuildings, res, aiRows, portfolioName }: ReportProps) {
  const [copied, setCopied] = useState(false);
  const parity = useMemo(() => {
    return (["book", "starter"] as PortfolioView[]).map((v) => {
      const r = runPortfolio(baseBuildings[v]);
      const ref = stats.portfolios[v];
      const pairs: [number, number][] = [...RPS.map((rp): [number, number] => [r.scenarios[rp].loss, ref.perRp[rp].loss]), [r.scenarios[250].loss, ref.loss250], [r.aal, ref.aal]];
      const maxDiff = Math.max(...pairs.map(([a, b]) => (b === 0 ? Math.abs(a) : Math.abs(a - b) / b)));
      return { v, maxDiff, aal: r.aal, ref: ref.aal };
    });
  }, [baseBuildings, stats]);

  const assumptions: [string, string][] = [
    ["Losses start at the 1-in-" + ONSET_RP + " flood (bankfull)", "JRC maps are undefended - the Budalangi dykes are not modelled. Biggest driver of AAL; sensitivity on the Summary tab."],
    ["Severity score = depth ÷ " + SEVERITY_REF_M + " m, capped at 1", "The brief's own 4 m 'extreme' reference; for comparison with the Nairobi 0–1 scores. Losses use depth in metres."],
    ["Damage curve k and cap per class", CLASSES.map((c) => `${CLASS_LABEL[c]} k=${CURVES[c].k} cap=${CURVES[c].cap}`).join("; ")],
    ["One flood per event across the whole reach", "Every building takes the same return-period map in a scenario (fully correlated); reasonable for one river reach."],
    ["Depth between maps", "Linear in log(return period) between the six JRC maps; 1-in-250 interpolated between 200 and 500."],
    ["Insured value = floor area × cost/m²", "Rounded to KES 5,000, per the dataset metadata; the starter CSV's value column is 10× this."],
    ["Lake Victoria and permanent water masked", `${Math.round(stats.lakeWetShare * 100)}% of the raw 'flooded' cells were lake water. A cell already ≥ ${stats.permanentWater.ruleD10M} m deep at 1-in-10 is the river channel or lake edge (${stats.permanentWater.cells} cells): drawn as water, never a building's hazard. Starter rows in the lake are left out of the losses.`],
    ["Risk Forge book placement", `WorldPop population × insurance uptake (urban 4, peri-urban 1.5, rural 1), never on permanent water. 15% of rows from the flood plain, 85% from the rest; totals weighted back to population (×${stats.bookWeights.floodplain.toFixed(2)} and ×${stats.bookWeights.basin.toFixed(2)}).`],
    ["River node stage table", "Stage → return period anchored on the 2.8 m alert level; replace with WRA's rating curve."],
    ["Building squares in 3D are symbolic", "600 m squares so they read at basin scale; heights scale with value. Not footprints."],
    ["Hazard resolution", "The brief describes ~90 m cells; the supplied rasters are 30 arc-seconds (~928 m), so a building's depth is the average of a ~1 km cell. We report what the files contain."],
    ["Financial terms (book)", "Illustrative programme: KES 25,000 deductible per building, limit = value, 25% quota share, cat XL 4M xs 4M on the cedant's retained event loss. Every input is editable on the Summary tab."],
    ["Kenya-wide hazard", "Outside the Nzoia the same JRC maps are read for all of Kenya. They model the larger rivers only: a building by a smaller river (Nairobi's rivers, much of the Mara) reads as dry, which is not the same as safe. Groups an AI request puts on a river bank go onto the nearest mapped flood-plain cell, and the page says how far away it was."],
    ["Offer documents: contents", "Stock spoils in shallow water (JRC Africa shape at 2× depth, capped at 95%); machinery at 1.2×, capped at 70%. Raised floors keep the first part of the water out."],
    ["Offer documents: site flood history", "Where the JRC map is dry at a site but the document reports floods, depth-frequency comes from those floods (Weibull plotting positions, log-linear fit read at 1-in-10), shaped to rarer floods by the basin's median JRC growth curve. It is the broker's evidence, not an independent survey."],
    ["Offer documents: calibration", "The site's damage curves are scaled by one factor fitted (least squares) to its own reported claims at their reported depths; the fit (R²) is shown."],
  ];

  const prem = technicalPremium(res);
  const note = `# Risk Forge - written note (Team B, Nzoia Basin)

## What we built
An end-to-end river-flood catastrophe model for the lower Nzoia basin: hazard (JRC return-period depth maps) -> vulnerability (class-specific depth-damage curves) -> exposure (synthetic portfolios) -> financial engine (loss per building and return period, EP curve, AAL, 1-in-250), with an AI layer (Risk Forge AI, built on Anthropic's Claude Sonnet 5.5) and a live river-level node (ESP32) feeding the same model. Results interface: 3D map plus an underwriter report.

## Data sources
${SOURCES.map(([name, kind, lic]) => `- ${name} - ${kind}; ${lic}`).join("\n")}

## Assumptions
${assumptions.map(([a, why]) => `- ${a}: ${why}`).join("\n")}

## Use of synthetic data
- Every building in both portfolios is synthetic; none is a real client property. The interface labels them "synthetic" throughout.
- Starter CSV: ${stats.starterFlags.UG} rows fall in Uganda and ${stats.starterFlags.LAKE} inside Lake Victoria (raised with the hosts); its tiv_kes column is 10x floor area x cost. Lake rows are left out of the losses: 1-in-100 loss ${kes(stats.portfolios.starterRaw.perRp["100"].loss)} as provided, ${kes(stats.portfolios.starter.perRp["100"].loss)} cleaned, ${kes(stats.portfolios.starterKenya.perRp["100"].loss)} for Kenyan rows only.
- Risk Forge book: ${stats.portfolios.book.count} synthetic buildings placed on real WorldPop population on Kenyan land, never on the river channel or lake edge; attributes drawn from the metadata ranges. The flood plain is over-sampled (${stats.bookStrata.floodplain} rows) and the totals are weighted back to population; unweighted, the sample would show ${kes(stats.portfolios.bookUnweighted.perRp["100"].loss)} at 1-in-100.

## AI feature
1. Exposure intake: an underwriter pastes a broker's free-text schedule; Risk Forge AI returns rows shaped like exposure_nzoia_synthetic.csv (class, count, floor area, value, place from our gazetteer, confidence, assumptions). The engine geocodes them, attaches the JRC depths, applies the damage curves and shows the change in AAL and 1-in-100 loss; the underwriter approves before the rows enter the book. Instructions hidden in the pasted text are treated as data (prompt-injection test included in the demo).
2. Offer documents: an underwriter drops a broker's offer (PDF or Word). The browser reads it and removes personal details; Risk Forge AI extracts the site, buildings, contents, flood history and terms, quoting the document for every number (each quote is checked against the text). The engine then runs hazard, vulnerability (calibrated to the site's claims), exposure and the financial terms, and recommends approve, approve with conditions, or decline, with a counter-offer.
3. Briefing: Risk Forge AI writes a short underwriting briefing from the engine's aggregated output and must cite every figure with its source path; the interface verifies each number against the engine.
Only redacted text and aggregated numbers are sent to the AI (Claude Sonnet 5.5); the model sits behind a provider interface so an in-country model can replace it.

## Results (${portfolioName}${aiRows.length ? `, incl. ${aiRows.length} AI-added buildings` : ""})
- Total exposure ${kes(res.tiv)} over ${res.count} buildings
${KEY_RPS.map((r) => `- 1-in-${r}${r === 250 ? " (interpolated)" : ""}: ${kes(res.scenarios[r].loss)} (${res.scenarios[r].wet} buildings flooded)`).join("\n")}
- Average annual loss ${kes(res.aal)}; illustrative technical premium ${kes(prem.gross)}

## Limitations
- JRC maps: ~925 m cells, undefended, 2016 vintage, river only (no Lake Victoria backwater, no local drainage); outside the Nzoia, larger rivers only.
- No Kenyan claims data to calibrate the curves; class parameters are adapted.
- Full spatial correlation per event; no policy terms (deductibles, limits) applied.
- GloFAS is model output; 29 years is short for 1-in-500; the river-node stage table is an assumption.
- Hosting: the prototype runs on Vercel (Mumbai) and calls Claude (US). Production would host in Kenya and send Claude only anonymised text, or use an open model.
`;

  return (
    <div className="space-y-4">
      <Card title="Production route: what Kenya Re would run" hint="security · data residency · cost · ownership">
        <div className="grid gap-x-6 gap-y-2 text-[12px] leading-snug text-slate-300 md:grid-cols-2">
          {PRODUCTION.map(([k, now, next]) => (
            <div key={k}>
              <div className="font-medium text-slate-100">{k}</div>
              <div className="text-slate-400">
                <span className="text-slate-500">Today:</span> {now}
              </div>
              <div>
                <span className="text-slate-500">In production:</span> {next}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="How Risk Forge follows the brief (section 9, steps 1–6)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12px]">
            <thead>
              <tr>
                <th className={th}>Step</th>
                <th className={th}>What we do</th>
                <th className={th}>Where to see it</th>
              </tr>
            </thead>
            <tbody>
              {STEPS.map(([s, what, where]) => (
                <tr key={s} className={`${tr} align-top text-slate-200`}>
                  <td className={`${td} whitespace-nowrap font-medium text-emerald-300`}>✓ {s}</td>
                  <td className={td}>{what}</td>
                  <td className={`${td} text-slate-400`}>{where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Data sources">
          <table className="w-full text-[12px]">
            <tbody>
              {SOURCES.map(([name, kind, lic, link]) => (
                <tr key={name} className={`${tr} align-top text-slate-200`}>
                  <td className={td}>
                    {name}
                    <div className="text-[11px] text-slate-500">
                      {lic} · {link}
                    </div>
                  </td>
                  <td className={`${td} text-right`}>
                    <Badge kind={kind} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Assumptions register">
          <table className="w-full text-[12px]">
            <tbody>
              {assumptions.map(([a, why]) => (
                <tr key={a} className={`${tr} align-top`}>
                  <td className={`${td} text-slate-200`}>
                    {a}
                    <div className="text-[11px] text-slate-500">{why}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Engine check" hint="browser engine vs the Python reference (scripts/prepare_3d_data.py)">
          <table className="w-full text-[12px]">
            <thead>
              <tr>
                <th className={th}>Portfolio</th>
                <th className={`${th} text-right`}>AAL (browser)</th>
                <th className={`${th} text-right`}>AAL (Python)</th>
                <th className={`${th} text-right`}>Max difference</th>
              </tr>
            </thead>
            <tbody>
              {parity.map((p) => (
                <tr key={p.v} className={`${tr} text-slate-200`}>
                  <td className={td}>{p.v === "book" ? "Risk Forge book" : "Starter CSV"}</td>
                  <td className={`${td} text-right`}>{kes(p.aal)}</td>
                  <td className={`${td} text-right`}>{kes(p.ref)}</td>
                  <td className={`${td} text-right ${p.maxDiff < 0.001 ? "text-emerald-300" : "text-amber-300"}`}>
                    {p.maxDiff < 0.001 ? "✓ " : "⚠ "}
                    {(p.maxDiff * 100).toFixed(3)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-slate-500">Compared over the six return-period losses, the 1-in-250 loss and the AAL. Two independent implementations agreeing is our check that the pipeline does what this note says.</p>
        </Card>
        <Card
          title="Written note (deliverable)"
          hint={
            <span className="flex gap-1.5">
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(note);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="rounded-md bg-white/[0.08] px-2 py-1 text-[11px] text-slate-200"
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button onClick={() => download("riskforge_written_note.md", note, "text/markdown")} className="rounded-md bg-brand px-2 py-1 text-[11px] font-semibold text-on-brand">
                Download .md
              </button>
            </span>
          }
        >
          <pre className="scroll-thin max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-[11px] leading-relaxed text-slate-300">{note}</pre>
        </Card>
      </div>
    </div>
  );
}
