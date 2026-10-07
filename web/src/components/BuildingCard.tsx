import type { BuildingProps, RP } from "../lib/types";
import { RPS } from "../lib/types";
import { CLASS_COLOUR, CLASS_LABEL, ISSUE_COLOUR, WHERE_LABEL, kes } from "../lib/format";

const DENSITY_LABEL = { urban: "urban", peri_urban: "peri-urban", rural: "rural" } as const;

export default function BuildingCard({ b, rp, severityRefM, onClose }: { b: BuildingProps; rp: RP; severityRefM: number; onClose: () => void }) {
  const depth = Number(b[`d${rp}`]);
  const severity = Math.min(depth / severityRefM, 1);
  const dr = Number(b[`dr${rp}`]);
  const loss = Number(b[`loss${rp}`]);
  const tivRatio = b.tivCsv / b.tiv;
  const issue = b.where !== "KE";

  return (
    <div className="glass panel rounded-2xl p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CLASS_COLOUR[b.cls] }} />
            <span className="font-display text-base font-semibold tracking-tight">{b.id}</span>
            <span className="chip chip-synthetic">synthetic</span>
          </div>
          <div className="mt-0.5 text-slate-400">
            {CLASS_LABEL[b.cls]} · {b.area.toLocaleString("en-KE")} m² · {b.lat.toFixed(4)}, {b.lon.toFixed(4)}
          </div>
          {b.density_class && (
            <div className="text-[12px] text-slate-500">
              {b.settlement && b.settlement !== "other" ? `near ${b.settlement} · ` : ""}
              {DENSITY_LABEL[b.density_class]}
              {b.stratum === "floodplain" ? " · floodplain sample" : ""}
            </div>
          )}
        </div>
        <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close building details">
          ✕
        </button>
      </div>

      {issue && (
        <div className="mt-3 rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: `${ISSUE_COLOUR}66`, background: `${ISSUE_COLOUR}14`, color: "#fecdd3" }}>
          ⚠ Location issue: {WHERE_LABEL[b.where]}. Under review with the hackathon hosts.
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label={`Depth · 1-in-${rp}`} value={depth > 0 ? `${depth.toFixed(2)} m` : "dry"} />
        <Metric label="Severity 0–1" value={severity.toFixed(2)} />
        <Metric label="Damage ratio" value={`${(dr * 100).toFixed(0)}%`} />
        <Metric label="Loss" value={kes(loss)} strong />
      </div>

      <div className="mt-3 text-[12px] text-slate-400">
        Insured value <span className="text-slate-200">{kes(b.tiv)}</span> = {b.area} m² × KES {b.cost.toLocaleString("en-KE")}/m²
        {tivRatio > 5 && <span className="text-amber-300"> · CSV says {kes(b.tivCsv)} (×{tivRatio.toFixed(0)})</span>}
      </div>

      <table className="mt-3 w-full text-[12px]">
        <thead className="text-slate-500">
          <tr>
            <th className="py-1 text-left font-medium">Return period</th>
            <th className="text-right font-medium">Depth</th>
            <th className="text-right font-medium">Damage</th>
            <th className="text-right font-medium">Loss</th>
          </tr>
        </thead>
        <tbody>
          {RPS.map((r) => (
            <tr key={r} className={r === rp ? "text-amber-200" : "text-slate-300"}>
              <td className="py-0.5">1-in-{r}</td>
              <td className="text-right tabular-nums">{Number(b[`d${r}`]).toFixed(2)} m</td>
              <td className="text-right tabular-nums">{(Number(b[`dr${r}`]) * 100).toFixed(0)}%</td>
              <td className="text-right tabular-nums">{kes(Number(b[`loss${r}`]))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-0.5 tabular-nums ${strong ? "font-semibold text-amber-200" : "text-slate-100"}`}>{value}</div>
    </div>
  );
}
