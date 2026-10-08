import { useState } from "react";
import { Card, td, th, tr } from "./ui";
import type { ReportProps } from "./Report";
import { kes } from "../../lib/format";

/** facts from public vendor material (links below); "not found" = not in public documentation we checked, not "does not exist" */
const MODELS = ["Moody's RMS (Flood HD)", "Verisk (Inland Flood)", "JBA Global Flood Model", "Fathom Global Flood Map (Swiss Re)", "KatRisk", "CLIMADA (ETH, open)", "Risk Forge"] as const;

const FACTS: [string, string[]][] = [
  ["Kenya coverage", ["HD flood models in 21 countries; no Kenya model found", "Country models (US, UK, SE Asia…); no Kenya model found", "Every country, Kenya included", "Global maps, Kenya included", "Global flood model", "Global river flood via data API", "Built for the Nzoia basin"]],
  ["Hazard resolution", ["High-definition (per country)", "Down to ~5 m where LiDAR exists", "30 m", "30 m (FABDEM+)", "30 m hydrology and hydraulics", "~4 km", "~925 m (JRC maps)"]],
  ["Event set", ["e.g. US 50,000 years; Europe 900,000 events", "10,000-year catalogue", "15 million river and surface-water events", "Return-period maps, 1-in-5 to 1-in-1,000", "10,000 to 50,000-year catalogues", "Probabilistic event sets", "6 return-period scenarios; stochastic catalogue next"]],
  ["Flood types", ["Inland flood", "Inland flood", "River and surface water", "River, surface water, coastal; defended and undefended", "River, surface water, coastal", "River flood (+ other hazards)", "River only, undefended"]],
  ["Climate view", ["—", "—", "—", "SSP scenarios for 2030, 2050, 2080", "Climate-conditioned catalogue (SST, El Niño)", "Adaptation cost-benefit", "Illustrative +10% frequency shift"]],
  ["Vulnerability", ["Proprietary, claims-calibrated", "Proprietary, claims-calibrated", "Proprietary", "Hazard only (pair with a loss model)", "Proprietary", "Open impact functions", "JRC Africa curves adapted per class; no claims calibration"]],
  ["Financial terms", ["Full policy and reinsurance terms", "Full policy and reinsurance terms", "—", "—", "Policy, account, facultative terms", "Basic", "Ground-up loss; terms via Oasis next"]],
  ["Openness", ["Licensed, closed", "Licensed, closed", "Licensed", "Licensed; free non-commercial country maps", "Licensed", "Open source (GPL)", "Open code, every number traceable"]],
];

/** our own 0-3 assessment: Risk Forge vs the best available international model on each dimension */
const SCORE: [string, number, number, string][] = [
  ["Hazard resolution", 1, 3, "925 m vs 30 m - a building's depth is a 1 km² average"],
  ["Event catalogue", 1, 3, "6 scenarios vs millions of events; Oasis catalogue is the fix"],
  ["Flood types", 1, 3, "river only; no pluvial, coastal or defended view"],
  ["Vulnerability calibration", 1, 3, "no Kenyan claims to calibrate against (none public)"],
  ["Financial terms & uncertainty", 1, 3, "ground-up only, no secondary uncertainty yet"],
  ["Transparency & explainability", 3, 1, "glass box: depth → damage → loss per building, engine cross-checked"],
  ["Fit to Kenya Re's book", 3, 1, "Nzoia geography, KES, Kenyan building classes, local gazetteer"],
  ["Live event response", 3, 1, "river node → return period → loss in seconds"],
  ["AI exposure intake", 3, 0, "broker email → priced rows, with assumptions and approval"],
  ["Cost & speed to stand up", 3, 1, "open data, near-zero running cost, built in days"],
  ["Data residency", 1, 2, "prototype runs in Mumbai and calls Claude in the US; production: Kenyan hosting with anonymised prompts or an open model"],
];

const SOURCES: [string, string][] = [
  ["Moody's RMS flood models", "https://www.moodys.com/web/en/us/capabilities/catastrophe-modeling/flood-models.html"],
  ["Verisk inland flood model documentation", "https://docs.risksolutions.verisk.com/releaseReadiness/releaseNotes_13-0/ts-tsre_all/releaseReadiness_13-0_m_my-id-if.html"],
  ["JBA catastrophe models", "https://www.jbarisk.com/products/catastrophe-models/"],
  ["Fathom Global Flood Map", "https://www.fathom.global/product/global-flood-map/"],
  ["Swiss Re acquires Fathom (Dec 2023)", "https://www.swissre.com/press-release/Swiss-Re-acquires-Fathom-a-leader-in-water-risk-intelligence/4af5e0d7-e065-404a-b80d-6f32955f0fbe"],
  ["Fathom 3.0 country maps (World Bank catalogue)", "https://datacatalog.worldbank.org/search/dataset/0065654"],
  ["KatRisk", "https://www.reinsurancene.ws/katrisk-enhances-cat-modelling-engine-and-financial-model/"],
  ["CLIMADA (Aznar-Siguan & Bresch 2019, GMD)", "https://gmd.copernicus.org/articles/12/3085/2019/"],
];

export default function BenchmarkTab({ res }: ReportProps) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="space-y-4">
      <Card title="How Risk Forge compares with international CAT models">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 text-[13px] leading-relaxed text-slate-300">
            <p>
              Risk Forge runs the <b>same four-stage pipeline</b> as the commercial models - hazard, vulnerability, exposure, financial engine, EP curve - built in three days on open data. It is <b>not yet a substitute</b> for a licensed vendor model: its hazard is about 30× coarser than JBA or Fathom, it runs six return-period scenarios instead of a stochastic catalogue of tens of thousands of years, it models river flooding only, and its damage curves are adapted global curves without Kenyan claims behind them.
            </p>
            <p>
              Where it is ahead: <b>every number can be traced</b>, it is <b>built around Kenya Re's own market</b> (the Nzoia basin, KES, Kenyan building types), it <b>links a live river gauge to the loss in seconds</b>, its <b>AI turns a broker's email into priced exposure</b>, and it costs almost nothing to run. Not yet solved: data residency (the prototype is hosted in Mumbai and calls Claude in the US). The brief itself notes that vendors calibrate on proprietary claims and that no locally calibrated Kenyan flood model exists in-house.
            </p>
            <p className="text-slate-400">
              Our positioning: a transparent local first view and benchmark next to vendor models, and the container (Oasis-compatible) into which better hazard and Kenya Re's own claims can be plugged. On this book it gives an AAL of {kes(res.aal)} and a 1-in-100 loss of {kes(res.scenarios[100].loss)}; a vendor model on the same book would be the natural validation test.
            </p>
          </div>
          <Scorecard hover={hover} setHover={setHover} />
        </div>
      </Card>

      <Card title="Side by side" hint="public information, October 2026 · “—” = not stated in what we reviewed">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[12px]">
            <thead>
              <tr>
                <th className={th} />
                {MODELS.map((m) => (
                  <th key={m} className={`${th} ${m === "Risk Forge" ? "text-brand-300" : ""}`}>
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FACTS.map(([dim, cells]) => (
                <tr key={dim} className={`${tr} align-top`}>
                  <td className={`${td} whitespace-nowrap font-medium text-slate-200`}>{dim}</td>
                  {cells.map((c, i) => (
                    <td key={i} className={`${td} tabular-nums ${i === cells.length - 1 ? "bg-brand-400/[0.08] text-brand-100" : "text-slate-300"}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Closing the gap" hint="each step keeps the same pipeline">
          <ol className="list-decimal space-y-1.5 pl-4 text-[12px] leading-snug text-slate-300">
            <li>
              <b>30 m hazard:</b> swap the six JRC maps for Fathom 3.0 (free country maps for non-commercial use) or a JBA licence - same file shape, no code change.
            </li>
            <li>
              <b>Stochastic catalogue:</b> the Oasis LMF model with 10,000 simulated years from the GloFAS frequency fit (next step).
            </li>
            <li>
              <b>Flood defences:</b> set where losses start from the river node's record and the county dyke inventory.
            </li>
            <li>
              <b>Vulnerability:</b> calibrate k and cap on Kenya Re claims from the 2020, 2024 and 2026 Budalangi floods; add secondary uncertainty.
            </li>
            <li>
              <b>Financial terms:</b> deductibles, limits and treaty layers through OED and the Oasis financial module.
            </li>
            <li>
              <b>More flood types:</b> surface water (Team A's Nairobi proxy) and Lake Victoria backwater.
            </li>
          </ol>
        </Card>
        <Card title="Sources">
          <ul className="space-y-1 text-[12px]">
            {SOURCES.map(([label, href]) => (
              <li key={href}>
                <a href={href} target="_blank" rel="noopener" className="text-brand-300 hover:underline">
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-slate-500">Vendor capabilities change; confirm current coverage with each vendor before quoting in a submission.</p>
        </Card>
      </div>
    </div>
  );
}

/** paired bars per dimension: Risk Forge (accent) vs best international model (muted); our own 0-3 assessment */
function Scorecard({ hover, setHover }: { hover: number | null; setHover: (i: number | null) => void }) {
  const label = ["none", "basic", "partial", "strong"];
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-300">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--chart-fill)" }} />
          Risk Forge
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--chart-ref)" }} />
          Best international model
        </span>
        <span className="text-slate-500">· our assessment, 0–3</span>
      </div>
      <div className="space-y-2">
        {SCORE.map(([dim, rf, best, why], i) => (
          <div key={dim} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={`rounded-lg px-2 py-1.5 ${hover === i ? "bg-white/[0.05]" : ""}`}>
            <div className="flex justify-between text-[12px] text-slate-200">
              <span>{dim}</span>
              <span className="text-[11px] text-slate-400">
                {label[rf]} vs {label[best]}
              </span>
            </div>
            <div className="mt-1 space-y-[2px]">
              <div className="h-2 rounded-r-full" style={{ width: `${Math.max(rf, 0.08) * 33.3}%`, background: "var(--chart-fill)" }} />
              <div className="h-2 rounded-r-full" style={{ width: `${Math.max(best, 0.08) * 33.3}%`, background: "var(--chart-ref)" }} />
            </div>
            {hover === i && <div className="mt-1 text-[11px] text-slate-400">{why}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
