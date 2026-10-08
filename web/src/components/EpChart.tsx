import type { RP } from "../lib/types";
import { RPS } from "../lib/types";

function shortKes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}bn`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return `${Math.round(n)}`;
}

interface Props {
  /** portfolio loss at each return period (the six JRC maps, plus 250 if given) */
  losses: Record<number, number>;
  /** optional comparison curve (e.g. the book before AI-added rows), drawn muted underneath */
  baseline?: Record<number, number> | null;
  onsetRp: number;
  rp?: number | null;
  liveRp?: number | null;
  onPick?: (r: RP) => void;
  height?: number;
  /** drawing width in px; pass the rendered width so text stays at its true size */
  width?: number;
  /** axis label size in px */
  fontSize?: number;
}

/** Loss vs return period on a log axis (the EP curve as underwriters read it) */
export default function EpChart({ losses, baseline, onsetRp, rp, liveRp, onPick, height = 156, width = 300, fontSize = 9 }: Props) {
  const W = width;
  const PAD = { l: Math.round(fontSize * 5), r: 12, t: 12, b: Math.round(fontSize * 2.6) };
  const H = height;
  const lo = Math.log10(onsetRp);
  const hi = Math.log10(500);
  const x = (r: number) => PAD.l + ((Math.log10(r) - lo) / (hi - lo)) * (W - PAD.l - PAD.r);
  const rps = Object.keys(losses).map(Number).sort((a, b) => a - b);
  const maxLoss = Math.max(...rps.map((r) => Math.max(losses[r], baseline?.[r] ?? 0)), 1) * 1.15;
  const y = (l: number) => H - PAD.b - (l / maxLoss) * (H - PAD.t - PAD.b);
  const pts: [number, number][] = [[onsetRp, 0], ...rps.map((r): [number, number] => [r, losses[r]])];
  const line = pts.map(([r, l], i) => `${i ? "L" : "M"}${x(r).toFixed(1)},${y(l).toFixed(1)}`).join(" ");
  const area = `${line} L${x(500).toFixed(1)},${y(0).toFixed(1)} L${x(onsetRp).toFixed(1)},${y(0).toFixed(1)} Z`;
  const ticks = [0, maxLoss / 2, maxLoss / 1.15];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Exceedance probability curve: loss by return period">
      <defs>
        <linearGradient id="epFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" style={{ stopColor: "var(--chart-fill)" }} stopOpacity="0.45" />
          <stop offset="100%" style={{ stopColor: "var(--chart-fill)" }} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} style={{ stroke: "var(--chart-grid)" }} />
          <text x={PAD.l - 6} y={y(t) + fontSize / 3} textAnchor="end" className="fill-slate-400" fontSize={fontSize}>
            {shortKes(t)}
          </text>
        </g>
      ))}
      {[onsetRp, 10, 50, 100, 250, 500].map((r) => (
        <text key={r} x={x(r)} y={H - fontSize * 0.8} textAnchor="middle" className="fill-slate-400" fontSize={fontSize}>
          {r === onsetRp ? `${r}y` : r}
        </text>
      ))}
      <path d={area} fill="url(#epFill)" />
      {baseline && (
        <path
          d={[[onsetRp, 0] as [number, number], ...rps.map((r): [number, number] => [r, baseline[r]])].map(([r, l], i) => `${i ? "L" : "M"}${x(r).toFixed(1)},${y(l).toFixed(1)}`).join(" ")}
          fill="none"
          style={{ stroke: "var(--chart-ref)" }}
          strokeWidth={1.5}
        />
      )}
      <path d={line} fill="none" style={{ stroke: "var(--chart-line)" }} strokeWidth={2} strokeLinejoin="round" />
      {rp && <line x1={x(rp)} x2={x(rp)} y1={PAD.t} y2={H - PAD.b} style={{ stroke: "var(--chart-mark)" }} strokeDasharray="3 3" strokeOpacity={0.7} />}
      {liveRp && liveRp > onsetRp && (
        <g>
          <line x1={x(Math.min(liveRp, 500))} x2={x(Math.min(liveRp, 500))} y1={PAD.t} y2={H - PAD.b} style={{ stroke: "var(--chart-live)" }} strokeWidth={1.5} />
          <text x={x(Math.min(liveRp, 500)) + 3} y={PAD.t + 8} style={{ fill: "var(--chart-live)" }} fontSize={fontSize}>
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
              style={{ fill: r === rp ? "var(--chart-mark)" : isMap ? "var(--chart-dot)" : "var(--chart-dot-stroke)", stroke: isMap ? "var(--chart-dot-stroke)" : "var(--chart-dot)" }}
              strokeWidth={1.5}
            />
          </g>
        );
      })}
    </svg>
  );
}
