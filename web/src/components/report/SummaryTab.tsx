import EpChart from "../EpChart";
import { HazardBars, ShareBars, StackedLossBars } from "../charts";
import { lossesOf } from "../Panels";
import { Card, Kpi, td, th, tr } from "./ui";
import type { ReportProps } from "./Report";
import type { RP } from "../../lib/types";
import { CLASSES, RPS } from "../../lib/types";
import { aal, KEY_RPS, ONSET_RP, technicalPremium } from "../../lib/engine";
import { accumulation, topRisks } from "../../lib/report";
import { CLASS_UI, CLASS_LABEL, kes } from "../../lib/format";

const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)}%`;

export default function SummaryTab({ stats, buildings, res, baseRes, aiRows, gazetteer, live, onPickBuilding }: ReportProps) {
  const prem = technicalPremium(res);
  const lossByRp = Object.fromEntries(RPS.map((r) => [r, res.scenarios[r].loss])) as Record<RP, number>;
  const acc = accumulation(buildings, gazetteer).slice(0, 8);
  const top = topRisks(buildings, res, 10);
  const dAal = res.aal - baseRes.aal;
  const d100 = res.scenarios[100].loss - baseRes.scenarios[100].loss;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Total exposure" value={kes(res.tiv)} sub={`${res.count.toLocaleString("en-KE")} buildings`} />
        <Kpi label="Average annual loss" value={kes(res.aal)} sub={`${pct(res.aal / res.tiv)} of insured value`} tone="amber" />
        <Kpi label="1-in-100 loss" value={kes(res.scenarios[100].loss)} sub={`${res.scenarios[100].wet} buildings flooded`} />
        <Kpi label="1-in-250 loss" value={kes(res.scenarios[250].loss)} sub="interpolated 200↔500" />
        <Kpi label="Technical premium" value={kes(prem.gross)} sub={`illustrative · ${pct(prem.rateOnTiv, 3)} rate`} />
        {live ? (
          <Kpi label="Live event loss" value={kes(live.scenario?.loss ?? 0)} sub={live.rp ? `river at 1-in-${Math.round(live.rp)}` : "river in bank"} tone="cyan" />
        ) : (
          <Kpi label="Value in 1-in-100 flood" value={kes(res.scenarios[100].tivWet)} sub={pct(res.scenarios[100].tivWet / res.tiv, 1) + " of the book"} />
        )}
      </div>

      {aiRows.length > 0 && (
        <div className="rounded-xl border border-cyan-300/30 bg-cyan-300/[0.06] px-4 py-2.5 text-[13px] text-cyan-100">
          {aiRows.length} buildings added through the AI exposure intake changed the result: AAL {dAal >= 0 ? "+" : ""}
          {kes(dAal)}, 1-in-100 {d100 >= 0 ? "+" : ""}
          {kes(d100)}.
        </div>
      )}

      <Pipeline stats={stats} res={res} />

      <div className="grid gap-4 lg:grid-cols-5">
        <Card title="Loss by return period, by construction class" hint="hover a bar for the breakdown" className="lg:col-span-3">
          <StackedLossBars res={res} />
        </Card>
        <Card title="EP curve" hint={aiRows.length ? "teal: with AI-added rows · grey: before" : "loss vs rarity"} className="lg:col-span-2">
          <EpChart losses={lossesOf(res)} baseline={aiRows.length ? lossesOf(baseRes) : null} onsetRp={ONSET_RP} rp={100} liveRp={live?.rp ?? null} height={210} />
          <p className="mt-1 text-[11px] text-slate-500">Each point: the loss with that annual chance of being exceeded. Steep at the frequent end, flat beyond 1-in-50: the flood plain fills early.</p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card title="Loss at key return periods" hint="the EP curve in numbers" className="lg:col-span-3">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Return period</th>
                  <th className={th}>Chance in a year</th>
                  <th className={`${th} text-right`}>Portfolio loss</th>
                  <th className={`${th} text-right`}>% of value</th>
                  <th className={`${th} text-right`}>Buildings flooded</th>
                  <th className={`${th} text-right`}>Value in flood</th>
                </tr>
              </thead>
              <tbody>
                {KEY_RPS.map((r) => {
                  const sc = res.scenarios[r];
                  return (
                    <tr key={r} className={`${tr} ${r === 250 ? "text-violet-200" : "text-slate-200"}`}>
                      <td className={td}>
                        1-in-{r}
                        {r === 250 && <span className="ml-1 text-[10px] text-violet-300/80">interp.</span>}
                      </td>
                      <td className={td}>{pct(1 / r, r >= 200 ? 2 : 1)}</td>
                      <td className={`${td} text-right font-medium`}>{kes(sc.loss)}</td>
                      <td className={`${td} text-right`}>{pct(sc.loss / res.tiv)}</td>
                      <td className={`${td} text-right`}>{sc.wet}</td>
                      <td className={`${td} text-right`}>{kes(sc.tivWet)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Each row applies one JRC return-period map to the whole book (one flood across the reach). 1-in-250 interpolates each building's depth between the 200- and 500-year maps.
          </p>
        </Card>
        <Card title="Hazard: land under water by return period" hint="real JRC data · lake masked" className="lg:col-span-2">
          <HazardBars km2={stats.floodLandKm2} maxDepth={stats.maxDepthLand} />
          <p className="mt-1 text-[11px] text-slate-500">The flooded area grows only ~24% from 1-in-10 to 1-in-500: in the lower Nzoia the flood plain fills even in common floods, so frequent events drive the loss.</p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="By construction class" hint="where the value is vs where the loss comes from">
          <ShareBars res={res} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Class</th>
                  <th className={`${th} text-right`}>Buildings</th>
                  <th className={`${th} text-right`}>Insured value</th>
                  <th className={`${th} text-right`}>AAL</th>
                  <th className={`${th} text-right`}>Share of AAL</th>
                  <th className={`${th} text-right`}>1-in-100</th>
                </tr>
              </thead>
              <tbody>
                {CLASSES.map((c) => (
                  <tr key={c} className={`${tr} text-slate-200`}>
                    <td className={td}>
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ background: CLASS_UI[c] }} />
                      {CLASS_LABEL[c]}
                    </td>
                    <td className={`${td} text-right`}>{res.byClass[c].count}</td>
                    <td className={`${td} text-right`}>{kes(res.byClass[c].tiv)}</td>
                    <td className={`${td} text-right`}>{kes(res.byClass[c].aal)}</td>
                    <td className={`${td} text-right`}>{pct(res.byClass[c].aal / Math.max(res.aal, 1), 0)}</td>
                    <td className={`${td} text-right`}>{kes(res.scenarios[100].byClass[c].loss)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Where the book is concentrated" hint="insured value inside the 1-in-100 flood">
          <div className="space-y-1.5">
            {acc.length === 0 && <div className="text-[13px] text-slate-500">No buildings inside the 1-in-100 footprint.</div>}
            {acc.map((a) => (
              <div key={a.settlement} className="text-[12px]">
                <div className="flex justify-between text-slate-300">
                  <span>
                    {a.settlement} <span className="text-slate-500">· {a.buildings} buildings</span>
                  </span>
                  <span className="tabular-nums">
                    {kes(a.tivInFootprint)} <span className="text-slate-500">· loss {kes(a.loss100)}</span>
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-brand-400/80" style={{ width: `${(a.tivInFootprint / acc[0].tivInFootprint) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card title="Top 10 risks by average annual loss" hint="click to fly there" className="lg:col-span-3">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Building</th>
                  <th className={th}>Class</th>
                  <th className={th}>Near</th>
                  <th className={`${th} text-right`}>Value</th>
                  <th className={`${th} text-right`}>Depth 1-in-100</th>
                  <th className={`${th} text-right`}>AAL</th>
                </tr>
              </thead>
              <tbody>
                {top.map(({ b, aal: a, at100 }) => (
                  <tr key={b.id} className={`${tr} cursor-pointer text-slate-200 hover:bg-white/[0.04]`} onClick={() => onPickBuilding(b)}>
                    <td className={td}>
                      {b.id}
                      {b.src === "ai" && <span className="chip chip-ai ml-1">AI</span>}
                    </td>
                    <td className={td}>{CLASS_LABEL[b.cls]}</td>
                    <td className={td}>{b.settlement && b.settlement !== "other" ? b.settlement : "—"}</td>
                    <td className={`${td} text-right`}>{kes(b.tiv)}</td>
                    <td className={`${td} text-right`}>{at100.depth.toFixed(2)} m</td>
                    <td className={`${td} text-right font-medium text-amber-200`}>{kes(a)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Biggest uncertainty: where losses start" hint="the JRC maps ignore the dykes" className="lg:col-span-2">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className={th}>Losses start at</th>
                <th className={`${th} text-right`}>AAL</th>
                <th className={`${th} text-right`}>vs base</th>
              </tr>
            </thead>
            <tbody>
              {[
                [2, "1-in-2 (bankfull, our base)"],
                [5, "1-in-5"],
                [10, "1-in-10 (dykes hold to the 10-year flood)"],
              ].map(([o, label]) => {
                const v = aal(lossByRp, o as number);
                return (
                  <tr key={o} className={`${tr} text-slate-200`}>
                    <td className={td}>{label}</td>
                    <td className={`${td} text-right`}>{kes(v)}</td>
                    <td className={`${td} text-right`}>{pct(v / res.aal - 1, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-snug text-slate-500">
            Losses at 1-in-10 and rarer do not change; only the frequent end does. The river node is how we would calibrate this: it records the stage at which water actually leaves the channel at Rwambwa.
          </p>
        </Card>
      </div>
    </div>
  );
}

/** the four-stage chain the brief describes, with this book's intermediate outputs */
function Pipeline({ stats, res }: Pick<ReportProps, "stats" | "res">) {
  const at100 = res.scenarios[100];
  const meanDr = at100.tivWet > 0 ? at100.loss / at100.tivWet : 0;
  const prem = technicalPremium(res);
  const steps: [string, string, string, string][] = [
    ["1 · Hazard", "Six JRC return-period depth maps", `${Math.round(stats.floodLandKm2["100"])} km² of land flooded at 1-in-100`, "real"],
    ["2 · Vulnerability", "Depth-damage curve per class", `${Math.round(meanDr * 100)}% average damage to flooded value at 1-in-100`, "assumption"],
    ["3 · Exposure", `${res.count.toLocaleString("en-KE")} buildings`, `${kes(res.tiv)} insured · ${at100.wet} in the 1-in-100 flood`, "synthetic"],
    ["4 · Financial engine", "Loss = damage × value, per return period", `1-in-100 ${kes(at100.loss)} · AAL ${kes(res.aal)}`, "engine"],
    ["Decision", "EP curve, PML, price", `1-in-250 ${kes(res.scenarios[250].loss)} · premium ${kes(prem.gross)} (illustr.)`, "engine"],
  ];
  return (
    <Card title="How the model gets from flood maps to a price" hint="each box shows this book's intermediate output">
      <div className="grid gap-2 md:grid-cols-5">
        {steps.map(([title, what, out, kind], i) => (
          <div key={title} className="relative rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[12px] font-semibold text-slate-100">{title}</div>
              {kind !== "engine" && <span className={`chip chip-${kind === "assumption" ? "assume" : kind}`}>{kind}</span>}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">{what}</div>
            <div className="mt-2 text-[12px] font-medium leading-snug text-brand-200">{out}</div>
            {i < steps.length - 1 && <div className="absolute -right-2 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 rotate-45 border-r-2 border-t-2 border-brand-300/70 md:block" aria-hidden />}
          </div>
        ))}
      </div>
    </Card>
  );
}
