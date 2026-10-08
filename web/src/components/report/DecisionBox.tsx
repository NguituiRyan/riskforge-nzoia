import type { ReportProps } from "./Report";
import type { RP } from "../../lib/types";
import { RPS } from "../../lib/types";
import { aal, ONSET_RP } from "../../lib/engine";
import type { ProgrammeResult } from "../../lib/terms";
import { accumulation, topRisks } from "../../lib/report";
import { kes } from "../../lib/format";

const REFER_RATE = 0.005; // ASSUMPTION: a flood AAL above 0.5% of value goes to a senior underwriter

/** round up to 2 significant figures, for a limit an underwriter would write */
const roundUp = (x: number) => {
  if (x <= 0) return 0;
  const m = 10 ** (Math.floor(Math.log10(x)) - 1);
  return Math.ceil(x / m) * m;
};
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

/**
 * The answer first: a rule-based recommendation with the reinsurer's price and event limit, where the loss
 * concentrates, the top risks and the biggest caveat. Every figure follows the financial terms below it.
 */
export default function DecisionBox({ buildings, res, gazetteer, onPickBuilding, prog }: ReportProps & { prog: ProgrammeResult }) {
  const premium = prog.reinsurerPremium;
  const rate = premium / Math.max(res.tiv, 1);
  const eventLimit = roundUp(prog.byRp[250].reinsurer);

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
        <span className="text-[11px] text-slate-500">rule-based · follows the financial terms below</span>
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
        <Fact label="Reinsurer premium" value={kes(premium)} sub={`technical · ${pct(rate, 3)} of value`} />
        <Fact label="Reinsurer event limit" value={kes(eventLimit)} sub="its 1-in-250 loss, rounded up" />
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
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Average annual loss, who pays</div>
          <div className="mt-1 grid grid-cols-2 gap-1.5 text-[12px]">
            {[
              ["Ground-up", prog.aal.gu],
              ["Gross", prog.aal.gross],
              ["Reinsurer", prog.aal.reinsurer],
              ["Cedant net", prog.aal.net],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-slate-300">
                <span>{k}</span>
                <span className="tabular-nums text-slate-100">{kes(v as number)}</span>
              </div>
            ))}
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
