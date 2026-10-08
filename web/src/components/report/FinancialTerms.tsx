import { useState } from "react";
import type { Programme, ProgrammeResult } from "../../lib/terms";
import { KEY_RPS } from "../../lib/engine";
import { kes } from "../../lib/format";

/** who pays: the owner (deductible, above the limit), the reinsurer (quota share + cat XL), the cedant (net) */
const PARTS = [
  { key: "net", label: "Cedant keeps (net)", colour: "var(--chart-fill)" },
  { key: "reinsurer", label: "Reinsurer (QS + cat XL)", colour: "#f59e0b" },
  { key: "owner", label: "Owner (deductible, above limit)", colour: "rgb(148 163 184 / .45)" },
] as const;

const short = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}bn` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${Math.round(n)}`);

/**
 * Ground-up -> deductible -> limit -> gross -> quota share -> cat XL -> net, at every return period.
 * `editable` shows the term inputs; `reinsurerName` relabels the reinsurer (e.g. "Kenya Re 80%").
 */
export default function FinancialTerms({
  programme,
  setProgramme,
  result,
  reinsurerName = "Reinsurer",
}: {
  programme: Programme;
  setProgramme?: (p: Programme) => void;
  result: ProgrammeResult;
  reinsurerName?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const rps = KEY_RPS;
  const max = Math.max(...rps.map((r) => result.byRp[r].gu), 1);
  const W = 520;
  const H = 170;
  const pad = { l: 40, r: 8, t: 10, b: 22 };
  const bw = (W - pad.l - pad.r) / rps.length;
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const at = result.byRp[hover ?? 100];
  const labels: Record<string, string> = { net: "Cedant keeps (net)", reinsurer: reinsurerName, owner: "Owner (deductible, above limit)" };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <div className="mb-1 flex flex-wrap gap-3 text-[11px] text-slate-300">
          {PARTS.map((p) => (
            <span key={p.key} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.colour }} />
              {labels[p.key]}
            </span>
          ))}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Loss split between owner, reinsurer and cedant at each return period">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--chart-grid)" />
              <text x={pad.l - 4} y={y(max * f) + 3} textAnchor="end" className="fill-slate-500 text-[9px]">
                {short(max * f)}
              </text>
            </g>
          ))}
          {rps.map((r, i) => {
            const l = result.byRp[r];
            let base = 0;
            return (
              <g key={r} onMouseEnter={() => setHover(r)} onMouseLeave={() => setHover(null)} className="cursor-default">
                <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill={hover === r ? "rgb(148 163 184 / .08)" : "transparent"} />
                {PARTS.map((p) => {
                  const v = l[p.key];
                  const top = y(base + v);
                  const h = y(base) - top;
                  base += v;
                  return h > 0 ? <rect key={p.key} x={pad.l + i * bw + bw * 0.18} y={top} width={bw * 0.64} height={h} fill={p.colour} rx={1.5} /> : null;
                })}
                <text x={pad.l + i * bw + bw / 2} y={H - 8} textAnchor="middle" className={`text-[9px] ${r === 250 ? "fill-slate-500" : "fill-slate-400"}`}>
                  1-in-{r}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="grid grid-cols-3 gap-2 text-[11px] sm:grid-cols-6">
          {[
            ["Ground-up", at.gu],
            ["Owner", at.owner],
            ["Gross", at.gross],
            ["Quota share", at.qs],
            ["Cat XL", at.xl],
            ["Net", at.net],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-lg bg-white/[0.04] px-2 py-1.5">
              <div className="text-slate-500">{k}</div>
              <div className="font-display text-[14px] text-slate-100">{kes(v as number)}</div>
            </div>
          ))}
        </div>
        <div className="mt-1 text-[11px] text-slate-500">At 1-in-{hover ?? 100} · hover a bar for another flood</div>
      </div>

      <div className="space-y-2 lg:col-span-2">
        {setProgramme && (
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <Num label="Deductible per risk, KES" value={programme.deductible} step={5000} onChange={(v) => setProgramme({ ...programme, deductible: v })} />
            <Num label="Limit per risk, KES (0 = value)" value={programme.limit} step={100000} onChange={(v) => setProgramme({ ...programme, limit: v })} />
            <Num label="Quota share ceded, %" value={programme.qs * 100} step={5} onChange={(v) => setProgramme({ ...programme, qs: Math.min(v, 100) / 100 })} />
            <span />
            <Num label="Cat XL attaches at, KES" value={programme.xlAttach} step={500000} onChange={(v) => setProgramme({ ...programme, xlAttach: v })} />
            <Num label="Cat XL limit, KES (0 = none)" value={programme.xlLimit} step={500000} onChange={(v) => setProgramme({ ...programme, xlLimit: v })} />
          </div>
        )}
        <table className="w-full text-[12px]">
          <tbody>
            {[
              ["Average annual loss, ground-up", result.aal.gu],
              ["… gross (after deductible and limit)", result.aal.gross],
              [`… ${reinsurerName}`, result.aal.reinsurer],
              ["… cedant net", result.aal.net],
              [`Technical premium, ${reinsurerName}`, result.reinsurerPremium],
            ].map(([k, v], i) => (
              <tr key={k as string} className={`border-t border-white/[0.06] ${i === 4 ? "text-amber-200" : "text-slate-300"}`}>
                <td className="py-1">{k}</td>
                <td className="py-1 text-right tabular-nums">{kes(v as number)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Num({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-slate-400">
      <span className="text-[11px]">{label}</span>
      <input type="number" min={0} step={step} value={Math.round(value * 100) / 100} onChange={(e) => onChange(Math.max(Number(e.target.value) || 0, 0))} className="w-full rounded bg-white/[0.06] px-2 py-1 text-right text-slate-100" />
    </label>
  );
}
