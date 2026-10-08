import { useState } from "react";
import type { Programme, ProgrammeResult } from "../../lib/terms";
import { KEY_RPS } from "../../lib/engine";
import { kes } from "../../lib/format";
import { useWidth } from "../../lib/useWidth";

/** who pays: the owner (deductible, above the limit), the reinsurer (quota share + cat XL), the cedant (net) */
const PARTS = [
  { key: "net", label: "Cedant keeps (net)", colour: "var(--chart-fill)" },
  { key: "reinsurer", label: "Reinsurer (QS + cat XL)", colour: "#f59e0b" },
  { key: "owner", label: "Owner (deductible, above limit)", colour: "#fb7185" },
] as const;

const short = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}bn` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${Math.round(n)}`);

/** the owner's slice is small next to the whole loss; never draw it thinner than this, so it can be seen */
const MIN_OWNER_PX = 4;
const FONT = 11;

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
  const [box, W] = useWidth<HTMLDivElement>(520);
  const H = 200;
  const pad = { l: 44, r: 8, t: 22, b: 24 };
  const bw = (W - pad.l - pad.r) / rps.length;
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const at = result.byRp[hover ?? 100];
  const labels: Record<string, string> = { net: "Cedant keeps (net)", reinsurer: reinsurerName, owner: "Owner (deductible, above limit)" };
  const ownerShare = result.byRp[100].gu > 0 ? result.byRp[100].owner / result.byRp[100].gu : 0;
  const tipIndex = hover === null ? -1 : rps.indexOf(hover as (typeof rps)[number]);

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <div className="mb-1 flex flex-wrap gap-3 text-[11px] text-slate-300">
          {PARTS.map((p) => (
            <span key={p.key} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.colour }} />
              {labels[p.key]}
              {p.key === "owner" && ownerShare > 0 && <span className="text-slate-500">· {(ownerShare * 100).toFixed(1)}% at 1-in-100</span>}
            </span>
          ))}
        </div>
        <div ref={box} className="relative" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Loss split between owner, reinsurer and cedant at each return period">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--chart-grid)" />
              <text x={pad.l - 5} y={y(max * f) + 4} textAnchor="end" fontSize={FONT} className="fill-slate-400">
                {short(max * f)}
              </text>
            </g>
          ))}
          {rps.map((r, i) => {
            const l = result.byRp[r];
            let base = 0;
            let stackTop = y(0);
            return (
              <g key={r} onMouseEnter={() => setHover(r)} onClick={() => setHover(r)} className="cursor-pointer">
                <rect x={pad.l + i * bw} y={0} width={bw} height={H} fill={hover === r ? "rgb(148 163 184 / .08)" : "transparent"} />
                {PARTS.map((p) => {
                  const v = l[p.key];
                  if (v <= 0) return null;
                  // stack from the bottom; the owner's thin slice gets a minimum height so it shows
                  const bottom = y(base);
                  const h = Math.max(bottom - y(base + v), p.key === "owner" ? MIN_OWNER_PX : 0);
                  base += v;
                  stackTop = bottom - h;
                  return <rect key={p.key} x={pad.l + i * bw + bw * 0.18} y={bottom - h} width={bw * 0.64} height={h} fill={p.colour} rx={1.5} />;
                })}
                <text x={pad.l + i * bw + bw / 2} y={stackTop - 5} textAnchor="middle" fontSize={FONT} className={hover === r ? "fill-slate-100" : "fill-slate-400"}>
                  {short(l.gu)}
                </text>
                <text x={pad.l + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize={FONT} className={hover === r ? "fill-slate-100" : r === 250 ? "fill-slate-500" : "fill-slate-400"}>
                  {bw > 60 ? `1-in-${r}` : r}
                </text>
              </g>
            );
          })}
        </svg>
        {tipIndex >= 0 && (
          <BarTip
            layers={result.byRp[rps[tipIndex]]}
            reinsurerName={reinsurerName}
            left={tipLeft(pad.l + tipIndex * bw, bw, W)}
            top={pad.t}
          />
        )}
        </div>
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
        <div className="mt-1 text-[11px] text-slate-500">At 1-in-{hover ?? 100} · hover or tap a bar for its full split</div>
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

const TIP_W = 256;
/** beside the bar when there is room (right of it on the left half, left of it on the right half), else centred */
function tipLeft(barX: number, bw: number, W: number) {
  if (W < TIP_W + 2 * bw + 40) return Math.max((W - TIP_W) / 2, 0);
  return barX + bw / 2 < W / 2 ? barX + bw * 0.86 : barX + bw * 0.14 - TIP_W;
}

/** the full ground-up to net split for one flood, shown over its bar */
function BarTip({ layers: l, reinsurerName, left, top }: { layers: ProgrammeResult["byRp"][number]; reinsurerName: string; left: number; top: number }) {
  const rows: [string, number, string?, boolean?][] = [
    ["Ground-up loss", l.gu, undefined, true],
    ["− Owner pays", l.owner, "#fb7185"],
    ["= Gross (insured)", l.gross, undefined, true],
    ["Quota share", l.qs, "#f59e0b"],
    ["Cat XL", l.xl, "#f59e0b"],
    [`= ${reinsurerName}`, l.reinsurer, "#f59e0b", true],
    ["= Cedant keeps (net)", l.net, "var(--chart-fill)", true],
  ];
  return (
    <div
      className="pointer-events-none absolute z-10 whitespace-nowrap rounded-xl border border-white/10 bg-[var(--glass-solid)] px-3 py-2 text-[12px] text-slate-200 shadow-xl"
      style={{ left, top, width: TIP_W }}
      role="tooltip"
    >
      <div className="mb-1 font-display text-[13px] text-slate-50">1-in-{l.rp} flood</div>
      {rows.map(([k, v, colour, strong]) => (
        <div key={k} className={`flex items-center justify-between gap-3 py-[1px] ${strong ? "font-medium text-slate-50" : "text-slate-300"}`}>
          <span className="flex items-center gap-1.5">
            {colour ? <span className="h-2 w-2 rounded-[2px]" style={{ background: colour }} /> : <span className="w-2" />}
            {k}
          </span>
          <span className="tabular-nums">{kes(v)}</span>
        </div>
      ))}
      {l.gu > 0 && <div className="mt-1 border-t border-white/10 pt-1 text-[11px] text-slate-400">owner {((l.owner / l.gu) * 100).toFixed(1)}% · reinsurer {((l.reinsurer / l.gu) * 100).toFixed(0)}% · net {((l.net / l.gu) * 100).toFixed(0)}%</div>}
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
