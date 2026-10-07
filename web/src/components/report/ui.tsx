import type { ReactNode } from "react";

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "amber" | "cyan" }) {
  const ring = tone === "amber" ? "bg-amber-300/10 ring-1 ring-amber-300/25" : tone === "cyan" ? "bg-cyan-300/10 ring-1 ring-cyan-300/25" : "bg-white/[0.04]";
  return (
    <div className={`rounded-xl px-3.5 py-3 ${ring}`}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 font-display text-[19px] font-semibold tabular-nums ${tone === "amber" ? "text-amber-200" : tone === "cyan" ? "text-cyan-200" : "text-slate-50"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

export function Card({ title, hint, children, className = "" }: { title: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-white/10 bg-white/[0.02] p-4 ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-300">{title}</h3>
        {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
      </div>
      {children}
    </section>
  );
}

export function Badge({ kind }: { kind: "real" | "synthetic" | "assumption" | "ai" }) {
  const cls = { real: "chip chip-real", synthetic: "chip chip-synthetic", assumption: "chip chip-assume", ai: "chip chip-ai" }[kind];
  return <span className={cls}>{kind === "ai" ? "AI" : kind}</span>;
}

export const th = "px-2 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500";
export const td = "px-2 py-1.5 tabular-nums";
export const tr = "border-t border-white/[0.06]";
