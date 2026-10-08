import { useMemo, useState } from "react";
import type { ReportProps } from "./Report";
import type { RP } from "../../lib/types";
import { RPS } from "../../lib/types";
import { aal, netOfTerms, ONSET_RP, type PolicyTerms } from "../../lib/engine";
import { accumulation, topRisks } from "../../lib/report";
import { kes } from "../../lib/format";

const COST_OF_CAPITAL = 0.1;
const EXPENSE_LOAD = 0.15;
const REFER_RATE = 0.005; // ASSUMPTION: a flood AAL above 0.5% of value goes to a senior underwriter

/** round up to 2 significant figures, for a limit an underwriter would write */
const roundUp = (x: number) => {
  if (x <= 0) return 0;
  const m = 10 ** (Math.floor(Math.log10(x)) - 1);
  return Math.ceil(x / m) * m;
};
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

/**
 * The answer first: a rule-based recommendation with limits, rate, top risks and the biggest caveat, and the policy
 * terms (excess, Kenya Re share) that turn the gross model into what Kenya Re would pay. Illustrative rules, stated.
 */
export default function DecisionBox({ buildings, res, gazetteer, onPickBuilding }: ReportProps) {
  const [terms, setTerms] = useState<PolicyTerms>({ excessPct: 0.1, excessMin: 25_000, share: 1 });
  const net = useMemo(() => netOfTerms(buildings, terms), [buildings, terms]);

  const risk = net.aal + COST_OF_CAPITAL * Math.max(net.lossByRp[200] - net.aal, 0);
  const premium = risk / (1 - EXPENSE_LOAD);
  const shareValue = res.tiv * terms.share;
  const rate = premium / Math.max(shareValue, 1);
  const eventLimit = roundUp(net.lossByRp[250]);

  const places = accumulation(buildings, gazetteer).sort((a, b) => b.loss100 - a.loss100);
  const top3 = places.slice(0, 3);
  const loss100 = res.scenarios[100].loss;
  const concentration = top3.reduce((s, a) => s + a.loss100, 0) / Math.max(loss100, 1);
  const valueInTop3 = top3.reduce((s, a) => s + a.tivInFootprint, 0);
  const risks = topRisks(buildings, res, 3);

  const grossByRp = Object.fromEntries(RPS.map((r) => [r, res.scenarios[r].loss])) as Record<RP, number>;
  const dykeDrop = 1 - aal(grossByRp, 10) / Math.max(res.aal, 1);
  const refer = res.aal / Math.max(res.tiv, 1) > REFER_RATE;
  const names = top3.map((a) => a.settlement).join(", ");

  return (
    <section className="rounded-2xl border border-brand-400/30 bg-brand-400/[0.06] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-[17px] text-slate-50">Underwriting decision</h3>
        <span className="text-[11px] text-slate-500">rule-based, illustrative · terms below change every figure</span>
      </div>
      <p className="mt-1.5 text-[14px] leading-snug text-slate-100">
        {refer ? (
          <>
            <b>Refer.</b> Flood AAL is {pct(res.aal / res.tiv, 2)} of value, above the {pct(REFER_RATE, 1)} appetite line.
          </>
        ) : (
          <>
            <b>Accept at the technical rate</b>
            {top3.length ? (
              <>
                , with an accumulation cap: {names} hold {pct(concentration, 0)} of the 1-in-100 loss.
              </>
            ) : (
              "."
            )}
          </>
        )}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Fact label="Technical premium, net" value={kes(premium)} sub={`${pct(rate, 3)} of ${terms.share < 1 ? "Kenya Re's share of " : ""}value`} />
        <Fact label="Event limit" value={kes(eventLimit)} sub="1-in-250 loss after terms, rounded up" />
        <Fact label="Accumulation cap" value={kes(valueInTop3)} sub={top3.length ? `value inside the 1-in-100 flood at ${names}: hold it here` : "no flooded value"} />
        <Fact label="Biggest caveat" value={`AAL −${pct(dykeDrop, 0)}`} sub={`if the Budalangi dykes hold to 1-in-10 (model assumes losses from 1-in-${ONSET_RP})`} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Top 3 risks · share of the book's AAL</div>
          <ul className="mt-1 space-y-1">
            {risks.map(({ b, aal: a, share }) => (
              <li key={b.id}>
                <button onClick={() => onPickBuilding(b)} className="flex w-full items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-left text-[12px] text-slate-200 hover:bg-white/[0.08]">
                  <span>
                    {b.id} · {b.settlement && b.settlement !== "other" ? b.settlement : "basin"}
                  </span>
                  <span className="tabular-nums text-amber-200">
                    {kes(a)} · {pct(share, 0)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Terms · per building and event</div>
          <div className="mt-1 grid grid-cols-3 gap-2 text-[12px]">
            <Num label="Excess, % of loss" value={terms.excessPct * 100} step={5} onChange={(v) => setTerms({ ...terms, excessPct: Math.min(Math.max(v, 0), 100) / 100 })} />
            <Num label="Minimum excess, KES" value={terms.excessMin} step={5000} onChange={(v) => setTerms({ ...terms, excessMin: Math.max(v, 0) })} />
            <Num label="Kenya Re share, %" value={terms.share * 100} step={5} onChange={(v) => setTerms({ ...terms, share: Math.min(Math.max(v, 0), 100) / 100 })} />
          </div>
          <div className="mt-2 text-[12px] text-slate-400">
            Gross → net: AAL {kes(res.aal)} → <b className="text-slate-200">{kes(net.aal)}</b> · 1-in-100 {kes(loss100)} → <b className="text-slate-200">{kes(net.lossByRp[100])}</b>
          </div>
        </div>
      </div>
    </section>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 font-display text-[18px] text-slate-50">{value}</div>
      <div className="text-[11px] leading-snug text-slate-500">{sub}</div>
    </div>
  );
}

function Num({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-slate-400">
      <span className="text-[11px]">{label}</span>
      <input type="number" value={Math.round(value * 100) / 100} step={step} min={0} onChange={(e) => onChange(Number(e.target.value) || 0)} className="w-full rounded bg-white/[0.06] px-2 py-1 text-right text-slate-100" />
    </label>
  );
}
