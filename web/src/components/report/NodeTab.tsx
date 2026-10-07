import { useState } from "react";
import { Badge, Card, Kpi, td, th, tr } from "./ui";
import type { ReportProps } from "./Report";
import { alertFor, priceTrigger, rpForStage } from "../../lib/node";
import { kes } from "../../lib/format";

export default function NodeTab({ nd, res, trigger, setTrigger, live }: ReportProps) {
  const price = priceTrigger(nd, trigger, res);
  const [spoof, setSpoof] = useState<string | null>(null);

  async function sendSpoof() {
    setSpoof("sending…");
    const body = { node: nd.node.id, seq: 999, ts: Math.floor(Date.now() / 1000), level_cm: 25, sig: "00".repeat(32) };
    try {
      const r = await fetch("/api/node", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      setSpoof(`HTTP ${r.status} · ${j.error ?? (j.ok ? "accepted" : "rejected")}`);
    } catch (e) {
      setSpoof(String(e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="What the node does for the model">
          <ol className="list-decimal space-y-2 pl-4 text-[13px] leading-snug text-slate-300">
            <li>
              <b>Live event loss.</b> During a flood the stage at Rwambwa maps to a return period, the matching flood footprint and the portfolio loss: reserves and cedant alerts within minutes.
            </li>
            <li>
              <b>Parametric trigger.</b> A fixed payout when the river passes a set level, priced below. No loss adjuster, paid in days.
            </li>
            <li>
              <b>Local calibration.</b> The stage at which water leaves the channel sets where losses start - the assumption that moves AAL most (see Summary).
            </li>
          </ol>
          <p className="mt-3 text-[11px] text-slate-500">It does not set the price on its own and gives under a day of warning (GloFAS peaks reach Rwambwa from Webuye within a day); forecasts come from rainfall.</p>
        </Card>

        <Card title="Live reading" hint={live ? "from the Live river node panel" : undefined}>
          {live ? (
            <div className="grid grid-cols-2 gap-2">
              <Kpi label="Stage" value={`${live.stage.toFixed(2)} m`} sub={alertFor(nd, live.stage).label} tone="cyan" />
              <Kpi label="Return period" value={live.rp ? `1-in-${Math.round(live.rp)}` : "in bank"} />
              <Kpi label="Event loss" value={kes(live.scenario?.loss ?? 0)} tone="amber" />
              <Kpi label="Buildings flooded" value={live.scenario?.wet ?? 0} />
            </div>
          ) : (
            <p className="text-[13px] text-slate-400">Switch the map panel to “Live river node” to stream from the node (USB), replay the September 2020 flood, or simulate a stage.</p>
          )}
        </Card>

        <Card title="Device API and security">
          <ul className="list-disc space-y-1.5 pl-4 text-[12px] leading-snug text-slate-300">
            <li>
              Field nodes POST <code>{"{ node, seq, ts, level_cm, sig }"}</code> to <code>/api/node</code> over GSM.
            </li>
            <li>
              <code>sig</code> = HMAC-SHA256 of the reading with a per-node secret. Wrong signature → rejected; old timestamp → rejected as a replay.
            </li>
            <li>The reply tells the node its alert level and LED colour.</li>
            <li>USB (the demo) is trusted by physical connection.</li>
          </ul>
          <button onClick={sendSpoof} className="mt-3 rounded-lg bg-rose-500/80 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-rose-500">
            Send a forged reading (25 cm = flood)
          </button>
          {spoof && <div className="mt-2 rounded bg-black/40 px-2 py-1 font-mono text-[11px] text-rose-200">{spoof}</div>}
        </Card>
      </div>

      <Card title="Parametric cover on the node" hint="ASSUMPTION: stage table below; frequency from GloFAS">
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="space-y-3 text-[12px] text-slate-300 lg:col-span-2">
            <label className="block">
              Trigger: Rwambwa stage ≥ <b>{trigger.triggerStage.toFixed(1)} m</b> (≈ 1-in-{Math.round(rpForStage(nd, trigger.triggerStage) ?? 2)})
              <input type="range" min={3} max={7} step={0.1} value={trigger.triggerStage} onChange={(e) => setTrigger({ ...trigger, triggerStage: Number(e.target.value) })} className="mt-1 w-full accent-rose-400" />
            </label>
            <label className="flex items-center justify-between gap-2">
              Payout per event
              <span>
                KES{" "}
                <input type="number" step={1_000_000} min={0} value={trigger.payout} onChange={(e) => setTrigger({ ...trigger, payout: Number(e.target.value) || 0 })} className="w-32 rounded bg-white/[0.06] px-2 py-1 text-right text-slate-100" />
              </span>
            </label>
            <label className="flex items-center justify-between gap-2">
              Loading on expected payout
              <span>
                <input type="number" step={0.05} min={0} value={trigger.load} onChange={(e) => setTrigger({ ...trigger, load: Number(e.target.value) || 0 })} className="w-20 rounded bg-white/[0.06] px-2 py-1 text-right text-slate-100" /> ×
              </span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Kpi label="Chance of payout / yr" value={`${(price.annualProb * 100).toFixed(1)}%`} />
              <Kpi label="Expected payout / yr" value={kes(price.expectedPayout)} />
              <Kpi label="Risk premium" value={kes(price.premium)} sub={`rate on line ${((price.premium / Math.max(trigger.payout, 1)) * 100).toFixed(1)}%`} tone="amber" />
              <Kpi label="Book AAL (indemnity)" value={kes(res.aal)} sub="for comparison" />
            </div>
          </div>
          <div className="lg:col-span-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Basis risk: payout vs the book's modelled loss</div>
            <table className="mt-1 w-full text-[12px]">
              <thead>
                <tr>
                  <th className={th}>Flood</th>
                  <th className={`${th} text-right`}>Modelled loss</th>
                  <th className={`${th} text-right`}>Parametric pays</th>
                  <th className={`${th} text-right`}>Covers</th>
                </tr>
              </thead>
              <tbody>
                {price.basis.map((b) => (
                  <tr key={b.rp} className={`${tr} text-slate-200`}>
                    <td className={td}>1-in-{b.rp}</td>
                    <td className={`${td} text-right`}>{kes(b.loss)}</td>
                    <td className={`${td} text-right`}>{b.pays ? kes(b.pays) : "nothing"}</td>
                    <td className={`${td} text-right`}>{b.cover === null ? "—" : `${Math.round(b.cover * 100)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] leading-snug text-slate-500">
              Rows paying nothing while losses are real are the basis risk the cedant keeps; rows paying more than the loss are over-compensation. The catastrophe model is what lets Kenya Re price and explain both.
            </p>
          </div>
        </div>
      </Card>

      <Card title="Calibration (stage → return period → flow)" hint={<span>anchored on the 2.8 m Rwambwa alert level · <Badge kind="assumption" /></span>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12px]">
            <thead>
              <tr>
                <th className={th}>Stage at Rwambwa</th>
                <th className={th}>Return period</th>
                <th className={`${th} text-right`}>Flow (Gumbel on GloFAS)</th>
                <th className={th}>Alert</th>
              </tr>
            </thead>
            <tbody>
              {nd.stageTable.map((r) => (
                <tr key={r.stage} className={`${tr} text-slate-200`}>
                  <td className={td}>{r.stage.toFixed(1)} m</td>
                  <td className={td}>1-in-{r.rp}</td>
                  <td className={`${td} text-right`}>{r.q.toLocaleString("en-KE")} m³/s</td>
                  <td className={td}>{alertFor(nd, r.stage).label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-slate-500">
          Gumbel μ = {nd.gumbel.mu}, β = {nd.gumbel.beta} m³/s fitted to {nd.gumbel.years} annual maxima ({nd.gumbel.source}). GloFAS is a model, so we use its return periods, not its absolute flows. In production this table is replaced by WRA's Rwambwa rating curve and the node's own record.
        </p>
      </Card>
    </div>
  );
}
