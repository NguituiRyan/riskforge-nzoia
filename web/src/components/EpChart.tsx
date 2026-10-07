import type { RP } from "../lib/types";
import { RPS } from "../lib/types";

const PAD = { l: 46, r: 12, t: 12, b: 24 };

function shortKes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}bn`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return `${Math.round(n)}`;
}

interface Props {
  /** portfolio loss at each return period (the six JRC maps, plus 250 if given) */
  losses: Record<number, number>;
  onsetRp: number;
  rp?: number | null;
  liveRp?: number | null;
  onPick?: (r: RP) => void;
  height?: number;
}

/** Loss vs return period on a log axis (the EP curve as underwriters read it) */
export default function EpChart({ losses, onsetRp, rp, liveRp, onPick, height = 156 }: Props) {
  const W = 300;
  const H = height;
  const lo = Math.log10(onsetRp);
  const hi = Math.log10(500);
  const x = (r: number) => PAD.l + ((Math.log10(r) - lo) / (hi - lo)) * (W - PAD.l - PAD.r);
  const rps = Object.keys(losses).map(Number).sort((a, b) => a - b);
  const maxLoss = Math.max(...rps.map((r) => losses[r]), 1) * 1.15;
  const y = (l: number) => H - PAD.b - (l / maxLoss) * (H - PAD.t - PAD.b);
  const pts: [number, number][] = [[onsetRp, 0], ...rps.map((r): [number, number] => [r, losses[r]])];
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
      {[onsetRp, 10, 50, 100, 250, 500].map((r) => (
        <text key={r} x={x(r)} y={H - 8} textAnchor="middle" className="fill-slate-400 text-[9px]">
          {r === onsetRp ? `${r}y` : r}
        </text>
      ))}
      <path d={area} fill="url(#epFill)" />
      <path d={line} fill="none" stroke="#7dd3fc" strokeWidth={2} strokeLinejoin="round" />
      {rp && <line x1={x(rp)} x2={x(rp)} y1={PAD.t} y2={H - PAD.b} stroke="#fbbf24" strokeDasharray="3 3" strokeOpacity={0.7} />}
      {liveRp && liveRp > onsetRp && (
        <g>
          <line x1={x(Math.min(liveRp, 500))} x2={x(Math.min(liveRp, 500))} y1={PAD.t} y2={H - PAD.b} stroke="#22d3ee" strokeWidth={1.5} />
          <text x={x(Math.min(liveRp, 500)) + 3} y={PAD.t + 8} className="fill-cyan-300 text-[9px]">
            live
          </text>
        </g>
      )}
      {rps.map((r) => {
        const isMap = (RPS as number[]).includes(r);
        return (
          <g key={r} onClick={() => isMap && onPick?.(r as RP)} className={isMap && onPick ? "cursor-pointer" : ""}>
            <circle cx={x(r)} cy={y(losses[r])} r={12} fill="transparent" />
            <circle
              cx={x(r)}
              cy={y(losses[r])}
              r={r === rp ? 5 : 3}
              fill={r === rp ? "#fbbf24" : isMap ? "#e0f2fe" : "#050b14"}
              stroke={isMap ? "#050b14" : "#e0f2fe"}
              strokeWidth={1.5}
            />
          </g>
        );
      })}
    </svg>
  );
}
