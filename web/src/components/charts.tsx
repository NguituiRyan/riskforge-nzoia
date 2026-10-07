/**
 * Charts that follow the brief (Step 6): exposure, loss at key return periods, EP curve, class breakdown,
 * hazard by return period, and Step 1's depth-versus-rarity curve for a building.
 * Colours: class identity from the validated categorical palette (CSS variables, light and dark steps);
 * text stays in text tokens; thin marks with 2 px surface gaps; hover tooltips on every mark.
 */
import { useState, type ReactNode } from "react";
import type { HousingClass } from "../lib/types";
import { CLASSES, RPS } from "../lib/types";
import { KEY_RPS, buildingAt, type PortfolioResult } from "../lib/engine";
import type { BuildingProps } from "../lib/types";
import { CLASS_LABEL, CLASS_UI, kes } from "../lib/format";

function shortKes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}bn`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return `${Math.round(n)}`;
}

/** wrapper that shows an HTML tooltip at the pointer */
function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const show = (e: React.MouseEvent, body: ReactNode) => {
    const host = (e.currentTarget as Element).closest("[data-chart]") as HTMLElement | null;
    const r = host?.getBoundingClientRect();
    if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top, body });
  };
  const el = tip && (
    <div
      className="pointer-events-none absolute z-10 min-w-[150px] -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg border border-white/10 bg-[var(--glass-solid)] px-2.5 py-1.5 text-[11px] text-slate-200 shadow-lg"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.body}
    </div>
  );
  return { show, hide: () => setTip(null), el };
}

export function ClassLegend({ classes = CLASSES }: { classes?: HousingClass[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-300">
      {classes.map((c) => (
        <span key={c} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: CLASS_UI[c] }} />
          {CLASS_LABEL[c]}
        </span>
      ))}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

/** Step 4/6: portfolio loss at each key return period, stacked by construction class */
export function StackedLossBars({ res }: { res: PortfolioResult }) {
  const tip = useTip();
  const W = 600;
  const H = 250;
  const P = { l: 48, r: 10, t: 12, b: 34 };
  const rps = [...KEY_RPS];
  const max = Math.max(...rps.map((r) => res.scenarios[r].loss), 1) * 1.1;
  const band = (W - P.l - P.r) / rps.length;
  const bw = Math.min(46, band * 0.6);
  const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
  const ticks = [0, max / 3, (2 * max) / 3, max / 1.1];
  return (
    <div data-chart className="relative">
      <div className="mb-2">
        <ClassLegend />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Portfolio loss at each return period, stacked by construction class" onMouseLeave={tip.hide}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} style={{ stroke: "var(--chart-grid)" }} />
            <text x={P.l - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
              {shortKes(t)}
            </text>
          </g>
        ))}
        {rps.map((rp, i) => {
          const sc = res.scenarios[rp];
          const x = P.l + band * i + (band - bw) / 2;
          let acc = 0;
          const segs = CLASSES.map((c) => ({ c, v: sc.byClass[c].loss })).filter((s) => s.v > 0);
          return (
            <g
              key={rp}
              onMouseMove={(e) =>
                tip.show(
                  e,
                  <div>
                    <div className="mb-1 font-semibold text-slate-100">
                      1-in-{rp}
                      {rp === 250 ? " (interpolated)" : ""} · {kes(sc.loss)}
                    </div>
                    {CLASSES.map((c) => (
                      <div key={c} className="flex justify-between gap-3">
                        <span className="flex items-center gap-1">
                          <span className="h-2 w-2 rounded-sm" style={{ background: CLASS_UI[c] }} />
                          {CLASS_LABEL[c]}
                        </span>
                        <span className="tabular-nums">{kes(sc.byClass[c].loss)}</span>
                      </div>
                    ))}
                  </div>,
                )
              }
            >
              <rect x={P.l + band * i} y={P.t} width={band} height={H - P.t - P.b} fill="transparent" />
              {segs.map((s, j) => {
                const y0 = y(acc);
                acc += s.v;
                const y1 = y(acc);
                const h = Math.max(y0 - y1 - (j > 0 ? 2 : 0), 0.5); // 2 px surface gap between segments
                const top = j === segs.length - 1;
                return top ? <path key={s.c} d={roundedTop(x, y1, bw, h, 4)} style={{ fill: CLASS_UI[s.c] }} /> : <rect key={s.c} x={x} y={y1} width={bw} height={h} style={{ fill: CLASS_UI[s.c] }} />;
              })}
              <text x={x + bw / 2} y={H - P.b + 14} textAnchor="middle" className={`text-[10px] ${rp === 250 ? "fill-violet-300" : "fill-slate-400"}`}>
                1-in-{rp}
              </text>
              {(rp === 10 || rp === 100 || rp === 500) && (
                <text x={x + bw / 2} y={y(sc.loss) - 6} textAnchor="middle" className="fill-slate-200 text-[10px] font-medium">
                  {shortKes(sc.loss)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} style={{ stroke: "var(--chart-grid)" }} />
      </svg>
      {tip.el}
    </div>
  );
}

/** Step 3/6: where the value is vs where the loss comes from, by class */
export function ShareBars({ res }: { res: PortfolioResult }) {
  const tip = useTip();
  const rows = CLASSES.map((c) => ({ c, tiv: res.byClass[c].tiv / Math.max(res.tiv, 1), aal: res.byClass[c].aal / Math.max(res.aal, 1), count: res.byClass[c].count }));
  const Col = ({ title, k }: { title: string; k: "tiv" | "aal" }) => (
    <div>
      <div className="mb-1.5 text-[11px] text-slate-400">{title}</div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.c}
            onMouseMove={(e) =>
              tip.show(
                e,
                <div>
                  <div className="font-semibold text-slate-100">{CLASS_LABEL[r.c]}</div>
                  <div>
                    {r.count} buildings · {kes(res.byClass[r.c].tiv)} insured
                  </div>
                  <div>AAL {kes(res.byClass[r.c].aal)}</div>
                </div>,
              )
            }
            onMouseLeave={tip.hide}
          >
            <div className="flex justify-between text-[11px] text-slate-300">
              <span>{CLASS_LABEL[r.c]}</span>
              <span className="tabular-nums">{Math.round(r[k] * 100)}%</span>
            </div>
            <div className="mt-0.5 h-2 rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full" style={{ width: `${Math.max(r[k] * 100, 0.5)}%`, background: CLASS_UI[r.c] }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div data-chart className="relative grid gap-5 sm:grid-cols-2">
      <Col title="Share of insured value" k="tiv" />
      <Col title="Share of average annual loss" k="aal" />
      {tip.el}
    </div>
  );
}

/** Step 1: the hazard grows with rarity - flooded land and deepest land cell per return period (real JRC data) */
export function HazardBars({ km2, maxDepth }: { km2: Record<string, number>; maxDepth: Record<string, number> }) {
  const tip = useTip();
  const W = 360;
  const H = 190;
  const P = { l: 34, r: 6, t: 18, b: 28 };
  const max = Math.max(...RPS.map((r) => km2[r])) * 1.12;
  const band = (W - P.l - P.r) / RPS.length;
  const bw = Math.min(44, band * 0.55);
  const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
  return (
    <div data-chart className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Flooded land area by return period" onMouseLeave={tip.hide}>
        {[0, max / 2, max / 1.12].map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} style={{ stroke: "var(--chart-grid)" }} />
            <text x={P.l - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {RPS.map((rp, i) => {
          const x = P.l + band * i + (band - bw) / 2;
          return (
            <g key={rp} onMouseMove={(e) => tip.show(e, <div><div className="font-semibold text-slate-100">1-in-{rp}</div><div>{km2[rp]} km² of land under water</div><div>deepest land cell {maxDepth[rp]} m</div></div>)}>
              <rect x={P.l + band * i} y={P.t} width={band} height={H - P.t - P.b} fill="transparent" />
              <path d={roundedTop(x, y(km2[rp]), bw, H - P.b - y(km2[rp]), 4)} style={{ fill: "var(--chart-fill)" }} />
              <text x={x + bw / 2} y={H - P.b + 14} textAnchor="middle" className="fill-slate-400 text-[10px]">
                {rp}
              </text>
              {(i === 0 || i === RPS.length - 1) && (
                <text x={x + bw / 2} y={y(km2[rp]) - 5} textAnchor="middle" className="fill-slate-200 text-[10px] font-medium">
                  {Math.round(km2[rp])} km²
                </text>
              )}
            </g>
          );
        })}
        <text x={4} y={10} className="fill-slate-500 text-[10px]">
          km² flooded · x: return period (years)
        </text>
      </svg>
      {tip.el}
    </div>
  );
}

/** Step 1 for one building: flood depth against rarity (log return-period axis), with its loss in the tooltip */
export function DepthCurve({ b, highlight }: { b: BuildingProps; highlight?: number | null }) {
  const tip = useTip();
  const W = 340;
  const H = 120;
  const P = { l: 34, r: 10, t: 10, b: 22 };
  const pts = RPS.map((rp) => ({ rp, ...buildingAt(b, rp) }));
  const max = Math.max(1, ...pts.map((p) => p.depth)) * 1.15;
  const lo = Math.log10(10);
  const hi = Math.log10(500);
  const x = (rp: number) => P.l + ((Math.log10(rp) - lo) / (hi - lo)) * (W - P.l - P.r);
  const y = (d: number) => H - P.b - (d / max) * (H - P.t - P.b);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.rp).toFixed(1)},${y(p.depth).toFixed(1)}`).join(" ");
  return (
    <div data-chart className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Flood depth at this building by return period" onMouseLeave={tip.hide}>
        {[0, max / 2, max / 1.15].map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} style={{ stroke: "var(--chart-grid)" }} />
            <text x={P.l - 5} y={y(t) + 3} textAnchor="end" className="fill-slate-400 text-[9px]">
              {t.toFixed(1)}m
            </text>
          </g>
        ))}
        <path d={line} fill="none" style={{ stroke: "var(--chart-line)" }} strokeWidth={2} strokeLinejoin="round" />
        {pts.map((p) => (
          <g key={p.rp} onMouseMove={(e) => tip.show(e, <div><div className="font-semibold text-slate-100">1-in-{p.rp}</div><div>depth {p.depth.toFixed(2)} m</div><div>damage {(p.dr * 100).toFixed(0)}% · loss {kes(p.loss)}</div></div>)}>
            <circle cx={x(p.rp)} cy={y(p.depth)} r={10} fill="transparent" />
            <circle cx={x(p.rp)} cy={y(p.depth)} r={p.rp === highlight ? 5 : 4} style={{ fill: p.rp === highlight ? "var(--chart-mark)" : "var(--chart-dot)", stroke: "var(--chart-dot-stroke)" }} strokeWidth={2} />
            <text x={x(p.rp)} y={H - 6} textAnchor="middle" className="fill-slate-400 text-[9px]">
              {p.rp}
            </text>
          </g>
        ))}
      </svg>
      {tip.el}
    </div>
  );
}

