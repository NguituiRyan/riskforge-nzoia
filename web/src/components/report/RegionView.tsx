import { useMemo, useState } from "react";
import type { BuildingProps } from "../../lib/types";
import { buildingAt, KEY_RPS, ONSET_RP, runPortfolio, valueOf } from "../../lib/engine";
import { runProgramme, type Programme } from "../../lib/terms";
import { kes } from "../../lib/format";
import { useWidth } from "../../lib/useWidth";
import EpChart from "../EpChart";
import FinancialTerms from "./FinancialTerms";
import { Kpi } from "./ui";

export interface RegionGroup {
  label: string;
  place: string;
  county: string;
  /** how the group was placed (riverside on the nearest mapped flood plain, …) */
  note: string;
  ids: string[];
}

/** a yearly rate as people say it: per mille when small, per cent when large */
const rateText = (x: number) => (x >= 0.01 ? `${(x * 100).toFixed(1)}%` : `${(x * 1000).toFixed(2)}‰`);

/** a reinsurer's starting terms for a new region: editable on the page */
const START: Programme = { deductible: 50_000, limit: 0, qs: 0.4, xlAttach: 0, xlLimit: 0 };

/**
 * What a reinsurer needs about a batch of buildings anywhere in Kenya, before they join the book:
 * size, expected loss, the rare-flood losses, the price for its share, where the losses pile up, and how sure we are.
 */
export default function RegionView({ buildings, groups, generated, source }: { buildings: BuildingProps[]; groups: RegionGroup[]; generated: boolean; source: string }) {
  const [programme, setProgramme] = useState<Programme>(START);
  const res = useMemo(() => runPortfolio(buildings), [buildings]);
  const prog = useMemo(() => runProgramme(buildings, programme), [buildings, programme]);
  const [box, width] = useWidth<HTMLDivElement>();
  const losses = Object.fromEntries(KEY_RPS.map((r) => [r, res.scenarios[r].loss])) as Record<number, number>;
  const tiv = res.tiv;
  const share = programme.qs;
  const wet = (rp: number) => buildings.filter((b) => buildingAt(b, rp).depth > 0).length;
  const maxDepth = Math.max(0, ...buildings.map((b) => buildingAt(b, 100).depth));
  const counties = [...new Set(groups.map((g) => g.county).filter(Boolean))];
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const rows = groups
    .map((g) => {
      const bs = g.ids.map((id) => byId.get(id)).filter((b): b is BuildingProps => !!b);
      const l100 = bs.reduce((s, b) => s + buildingAt(b, 100).loss, 0);
      return { g, n: bs.length, value: bs.reduce((s, b) => s + valueOf(b), 0), l100, depth: Math.max(0, ...bs.map((b) => buildingAt(b, 100).depth)) };
    })
    .sort((a, b) => b.l100 - a.l100);
  const total100 = rows.reduce((s, r) => s + r.l100, 0);
  const rate = tiv > 0 ? prog.reinsurerPremium / (tiv * Math.max(share, 0.01)) : 0;
  // buildings already under water in the 1-in-10 flood: frequent (attritional) losses, not catastrophe risk
  const frequent = buildings.filter((b) => buildingAt(b, 10).depth > 0);
  const rest = buildings.filter((b) => buildingAt(b, 10).depth <= 0);
  const restProg = useMemo(() => (frequent.length && rest.length ? runProgramme(rest, programme) : null), [frequent.length, rest, programme]);
  const restTiv = rest.reduce((s, b) => s + valueOf(b), 0);
  const frequentAal = frequent.length ? res.aal - (rest.length ? runPortfolio(rest).aal : 0) : 0;

  return (
    <section className="space-y-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.03] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-[17px] text-slate-50">
          Reinsurer view · {counties.length ? counties.join(", ") : "Kenya"}
          {generated && <span className="ml-2 align-middle text-[11px] font-normal text-cyan-200/80">fictional sample</span>}
        </h3>
        <span className="text-[12px] text-slate-400">before these buildings join the book</span>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Kpi label="Buildings · value" value={kes(tiv)} sub={`${buildings.length} buildings`} />
        <Kpi label="Average annual loss" value={kes(res.aal)} sub={`${rateText(res.aal / Math.max(tiv, 1))} of value a year`} tone="amber" />
        <Kpi label="1-in-100 loss" value={kes(losses[100])} sub={`${wet(100)} of ${buildings.length} under water · max ${maxDepth.toFixed(1)} m`} />
        <Kpi label="1-in-250 loss" value={kes(losses[250])} sub={`${((losses[250] / Math.max(tiv, 1)) * 100).toFixed(1)}% of value`} />
        <Kpi label={`Price for ${Math.round(share * 100)}% share`} value={kes(prog.reinsurerPremium)} sub={`${rateText(rate)} of the share's value`} tone="cyan" />
      </div>

      {frequent.length > 0 && (
        <div className="rounded-xl border border-amber-300/30 bg-amber-300/[0.07] px-3 py-2 text-[13px] text-amber-50">
          <b>
            {frequent.length} of {buildings.length} buildings flood already in the 1-in-10 flood
          </b>{" "}
          and carry {res.aal > 0 ? Math.round((frequentAal / res.aal) * 100) : 0}% of the expected loss: that is frequent, attritional loss, not catastrophe risk. Exclude them, or put a large flood deductible on them.
          {restProg && (
            <span className="text-amber-100/90">
              {" "}
              Without them: {rest.length} buildings, {kes(restTiv)},{" "}
              {restProg.reinsurerPremium > 0
                ? `price ${kes(restProg.reinsurerPremium)} for the ${Math.round(share * 100)}% share (${rateText(restProg.reinsurerPremium / Math.max(restTiv * share, 1))} of its value).`
                : "dry in every mapped flood: no flood catastrophe price on them, only a minimum premium."}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl bg-white/[0.03] p-3">
          <div className="text-[13px] font-medium text-slate-200">EP curve</div>
          <div className="text-[12px] text-slate-400">
            buildings flooded: {wet(10)} at 1-in-10 · {wet(100)} at 1-in-100 · {wet(500)} at 1-in-500
          </div>
          <div ref={box} className="mt-2">
            <EpChart losses={losses} onsetRp={ONSET_RP} rp={100} height={180} width={width} fontSize={12} />
          </div>
        </div>
        <div className="rounded-xl bg-white/[0.03] p-3">
          <div className="text-[13px] font-medium text-slate-200">Where the 1-in-100 loss piles up</div>
          <table className="mt-2 w-full text-[12px]">
            <thead className="text-slate-400">
              <tr>
                <th className="py-1 text-left font-medium">Group · place</th>
                <th className="text-right font-medium">Value</th>
                <th className="text-right font-medium">Depth</th>
                <th className="text-right font-medium">1-in-100</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ g, n, value, l100, depth }) => (
                <tr key={g.label + g.place} className="border-t border-white/5 align-top text-slate-200">
                  <td className="py-1.5 pr-2">
                    {g.label}
                    <div className="text-[11px] text-slate-400">
                      {n} at {g.place} · {g.note}
                    </div>
                  </td>
                  <td className="text-right tabular-nums">{kes(value)}</td>
                  <td className={`text-right tabular-nums ${depth > 0 ? "text-sky-300" : "text-slate-500"}`}>{depth > 0 ? `${depth.toFixed(1)} m` : "dry"}</td>
                  <td className="text-right tabular-nums">
                    {kes(l100)}
                    {total100 > 0 && <div className="text-[11px] text-slate-400">{Math.round((l100 / total100) * 100)}%</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl bg-white/[0.03] p-3">
        <div className="mb-2 text-[13px] font-medium text-slate-200">Financial engine · ground-up to net (edit the terms)</div>
        <FinancialTerms programme={programme} setProgramme={setProgramme} result={prog} reinsurerName={`Kenya Re ${Math.round(share * 100)}%`} />
      </div>

      <ul className="list-disc space-y-0.5 pl-5 text-[12px] text-slate-400">
        <li>Hazard: {source}</li>
        <li>Damage: the same class curves as the Nzoia book (JRC Africa, adapted per construction class); no local claims to calibrate them here.</li>
        {buildings.some((b) => b.placed === "approx") && <li className="text-amber-200/90">Some groups are placed approximately (no exact place in the text): depths can change by metres within a kilometre.</li>}
        {rows.some((r) => r.depth === 0) && <li className="text-amber-200/90">Dry groups are either away from the river or on rivers the 2016 JRC maps do not model (they cover the larger rivers only): dry is not the same as safe.</li>}
        {generated && <li>Buildings, values and names are fictional, created by Risk Forge AI from the request.</li>}
      </ul>
    </section>
  );
}
