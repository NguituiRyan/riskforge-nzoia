import type { BuildingProps, RP } from "../lib/types";
import { RPS } from "../lib/types";
import { aal, buildingAt, contentsOf, KEY_RPS, ONSET_RP, severity, valueOf, weightOf } from "../lib/engine";
import EpChart from "./EpChart";
import { CLASS_UI, CLASS_LABEL, ISSUE_COLOUR, WHERE_LABEL, kes } from "../lib/format";

/** One building, tapped on the map: hazard -> vulnerability -> exposure -> financial, its loss at every return
 *  period and its own EP curve. The full numbers fold away under "Numbers". */
export default function BuildingCard({ b, rp, liveRp, onClose }: { b: BuildingProps; rp: RP; liveRp: number | null; onClose: () => void }) {
  const showRp = liveRp ?? rp;
  const now = buildingAt(b, showRp);
  const w = weightOf(b);
  const c = contentsOf(b);
  const contents = c.stock + c.machinery + c.other;
  const value = valueOf(b);
  const losses = Object.fromEntries(KEY_RPS.map((r) => [r, buildingAt(b, r).loss])) as Record<number, number>;
  const ownAal = aal(Object.fromEntries(RPS.map((r) => [r, losses[r]])) as Record<RP, number>);
  const rpLabel = liveRp ? (liveRp > 2 ? `live ≈1-in-${Math.round(liveRp)}` : "live, in bank") : `1-in-${rp}`;
  const hazardSource = b.hz === "site" ? "site history" : "JRC map";
  const floor = Number(b.floor) || 0;
  const damage = value > 0 ? now.loss / value : 0;

  return (
    <div className="glass panel rounded-2xl p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CLASS_UI[b.cls] }} />
            <span className="font-display text-base tracking-tight">{typeof b.name === "string" ? b.name : b.id}</span>
            {b.src === "ai" ? <span className="chip chip-ai">AI · {Math.round((b.confidence ?? 0) * 100)}%</span> : <span className="chip chip-synthetic">synthetic</span>}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-slate-400">
            {CLASS_LABEL[b.cls]} · {b.area.toLocaleString("en-KE")} m²{b.settlement && b.settlement !== "other" ? ` · ${b.settlement}` : ""}
          </div>
        </div>
        <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close building details">
          ✕
        </button>
      </div>

      {b.where !== "KE" && (
        <div className="mt-2 rounded-lg border px-3 py-1.5 text-[12px] text-rose-200" style={{ borderColor: `${ISSUE_COLOUR}66`, background: `${ISSUE_COLOUR}14` }}>
          ⚠ {WHERE_LABEL[b.where]}
          {b.w === 0 ? " · not in portfolio results" : ""}
        </div>
      )}

      {/* the pipeline for this building at the chosen flood */}
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <Stage n="1" label="Hazard" value={now.depth > 0 ? `${now.depth.toFixed(2)} m` : "dry"} sub={`${rpLabel} · ${hazardSource}`} kind={b.hz === "site" ? "ai" : "real"} />
        <Stage n="2" label="Vulnerability" value={`${(damage * 100).toFixed(0)}% damaged`} sub={floor > 0 ? `floor raised ${floor} m` : `severity ${severity(now.depth).toFixed(2)}`} kind="assumption" />
        <Stage n="3" label="Exposure" value={kes(value)} sub={contents > 0 ? `incl. ${kes(contents)} contents` : `KES ${b.cost.toLocaleString("en-KE")}/m²`} kind={b.src === "ai" ? "ai" : "synthetic"} />
        <Stage n="4" label="Financial" value={kes(now.loss)} sub={w !== 1 ? `×${w.toFixed(2)} in book = ${kes(now.loss * w)}` : `AAL ${kes(ownAal)}`} strong />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Loss by return period</div>
          <LossBars b={b} losses={losses} rp={liveRp ? null : rp} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">EP curve · AAL {kes(ownAal)}</div>
          <EpChart losses={losses} onsetRp={ONSET_RP} rp={liveRp ? null : rp} liveRp={liveRp} height={132} />
        </div>
      </div>

      <details className="group mt-2 text-[12px]">
        <summary className="cursor-pointer list-none text-slate-400 hover:text-slate-200">
          <span className="inline-block transition group-open:rotate-90">›</span> Numbers
        </summary>
        <table className="mt-1 w-full">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 text-left font-medium">Flood</th>
              <th className="text-right font-medium">Depth</th>
              <th className="text-right font-medium">Severity</th>
              <th className="text-right font-medium">Damage</th>
              <th className="text-right font-medium">Loss</th>
            </tr>
          </thead>
          <tbody>
            {RPS.map((r) => {
              const x = buildingAt(b, r);
              return (
                <tr key={r} className={!liveRp && r === rp ? "text-amber-200" : "text-slate-300"}>
                  <td className="py-0.5">1-in-{r}</td>
                  <td className="text-right tabular-nums">{x.depth.toFixed(2)} m</td>
                  <td className="text-right tabular-nums">{severity(x.depth).toFixed(2)}</td>
                  <td className="text-right tabular-nums">{value > 0 ? ((x.loss / value) * 100).toFixed(0) : 0}%</td>
                  <td className="text-right tabular-nums">{kes(x.loss)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-1 text-slate-500">
          Structure {kes(b.tiv)}
          {contents > 0 ? ` · stock ${kes(c.stock)} · machinery ${kes(c.machinery)}` : ""}
          {typeof b.cal === "number" && b.cal !== 1 ? ` · calibrated ×${b.cal.toFixed(2)} to site claims` : ""}
          {b.tivCsv / b.tiv > 5 ? ` · CSV value ${kes(b.tivCsv)} (×${(b.tivCsv / b.tiv).toFixed(0)})` : ""}
        </div>
      </details>
    </div>
  );
}

/** where a number comes from, as a dot: real data, assumption, synthetic, or AI-extracted */
const SOURCE = {
  real: { colour: "rgb(var(--chip-real))", label: "real data" },
  assumption: { colour: "rgb(var(--chip-assume))", label: "assumption" },
  synthetic: { colour: "rgb(var(--chip-synthetic))", label: "synthetic" },
  ai: { colour: "rgb(var(--chip-ai))", label: "AI-extracted" },
} as const;

function Stage({ n, label, value, sub, kind, strong }: { n: string; label: string; value: string; sub: string; kind?: keyof typeof SOURCE; strong?: boolean }) {
  return (
    <div className={`min-w-0 rounded-xl px-2.5 py-2 ${strong ? "bg-amber-300/10 ring-1 ring-amber-300/25" : "bg-white/[0.04]"}`}>
      <div className="flex items-center justify-between gap-1 text-[10px] uppercase tracking-wider text-slate-500">
        <span className="truncate">
          {n} · {label}
        </span>
        {kind && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SOURCE[kind].colour }} title={SOURCE[kind].label} aria-label={SOURCE[kind].label} />}
      </div>
      <div className={`mt-0.5 truncate font-display text-[15px] ${strong ? "text-amber-200" : "text-slate-50"}`}>{value}</div>
      <div className="truncate text-[10px] text-slate-500">{sub}</div>
    </div>
  );
}

const short = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}bn` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : n > 0 ? `${Math.round(n)}` : "0");

/** this building's loss at each JRC return period, with the flood depth under each bar */
function LossBars({ b, losses, rp }: { b: BuildingProps; losses: Record<number, number>; rp: number | null }) {
  const W = 300;
  const H = 132;
  const pad = { t: 14, b: 30 };
  const max = Math.max(...RPS.map((r) => losses[r]), 1);
  const bw = W / RPS.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Loss by return period for this building">
      {RPS.map((r, i) => {
        const h = (losses[r] / max) * (H - pad.t - pad.b);
        const on = r === rp;
        return (
          <g key={r}>
            <rect x={i * bw + bw * 0.2} y={H - pad.b - h} width={bw * 0.6} height={Math.max(h, losses[r] > 0 ? 1 : 0)} rx={2} fill={on ? "#fbbf24" : "var(--chart-fill)"} opacity={on ? 1 : 0.8} />
            <text x={i * bw + bw / 2} y={H - pad.b - h - 3} textAnchor="middle" className={`text-[9px] ${on ? "fill-amber-200" : "fill-slate-400"}`}>
              {short(losses[r])}
            </text>
            <text x={i * bw + bw / 2} y={H - 16} textAnchor="middle" className={`text-[9px] ${on ? "fill-amber-200" : "fill-slate-400"}`}>
              {r}
            </text>
            <text x={i * bw + bw / 2} y={H - 4} textAnchor="middle" className="fill-slate-500 text-[8px]">
              {Number(b[`d${r}`]) > 0 ? `${Number(b[`d${r}`]).toFixed(1)}m` : "dry"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
