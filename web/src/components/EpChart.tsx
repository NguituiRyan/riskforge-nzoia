import type { PortfolioStats, RP } from "../lib/types";
import { RPS } from "../lib/types";

const W = 300;
const H = 156;
const PAD = { l: 46, r: 12, t: 12, b: 24 };

function shortKes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}bn`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return `${Math.round(n)}`;
}

/** Loss vs return period on a log axis, with the selected return period highlighted. */
export default function EpChart({ stats, rp, onsetRp, onPick }: { stats: PortfolioStats; rp: RP; onsetRp: number; onPick: (r: RP) => void }) {
  const lo = Math.log10(onsetRp);
  const hi = Math.log10(500);
  const x = (r: number) => PAD.l + ((Math.log10(r) - lo) / (hi - lo)) * (W - PAD.l - PAD.r);
  const maxLoss = Math.max(...RPS.map((r) => stats.perRp[r].loss), 1) * 1.15;
  const y = (l: number) => H - PAD.b - (l / maxLoss) * (H - PAD.t - PAD.b);
  const pts: [number, number][] = [[onsetRp, 0], ...RPS.map((r): [number, number] => [r, stats.perRp[r].loss])];
  const line = pts.map(([r, l], i) => `${i ? "L" : "M"}${x(r).toFixed(1)},${y(l).toFixed(1)}`).join(" ");
  const area = `${line} L${x(500).toFixed(1)},${y(0).toFixed(1)} L${x(onsetRp).toFixed(1)},${y(0).toFixed(1)} Z`;
  const ticks = [0, maxLoss / 2, maxLoss / 1.15];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Exceedance probability curve: loss by return period">
      <defs>
        <linearGradient id="epFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgb(148 163 184 / 0.15)" />
          <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-400 text-[9px]">
            {shortKes(t)}
          </text>
        </g>
      ))}
      {[onsetRp, 10, 50, 100, 500].map((r) => (
        <text key={r} x={x(r)} y={H - 8} textAnchor="middle" className="fill-slate-400 text-[9px]">
          {r === onsetRp ? `${r}y` : r}
        </text>
      ))}
      <path d={area} fill="url(#epFill)" />
      <path d={line} fill="none" stroke="#7dd3fc" strokeWidth={2} strokeLinejoin="round" />
      <line x1={x(rp)} x2={x(rp)} y1={PAD.t} y2={H - PAD.b} stroke="#fbbf24" strokeDasharray="3 3" strokeOpacity={0.7} />
      {RPS.map((r) => (
        <g key={r} onClick={() => onPick(r)} className="cursor-pointer">
          <circle cx={x(r)} cy={y(stats.perRp[r].loss)} r={12} fill="transparent" />
          <circle cx={x(r)} cy={y(stats.perRp[r].loss)} r={r === rp ? 5 : 3} fill={r === rp ? "#fbbf24" : "#e0f2fe"} stroke="#050b14" strokeWidth={1.5} />
        </g>
      ))}
    </svg>
  );
}
