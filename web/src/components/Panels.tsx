import type { ReactNode } from "react";
import AnimatedValue from "./AnimatedValue";
import EpChart from "./EpChart";
import ThemeToggle from "./ThemeToggle";
import type { Theme } from "../lib/theme";
import { WATER_EXAGGERATION, type CameraPreset } from "./MapScene";
import type { ColourMode, PortfolioView, RP, Stats } from "../lib/types";
import { CLASSES, RPS } from "../lib/types";
import { KEY_RPS, ONSET_RP, SEVERITY_REF_M, type PortfolioResult } from "../lib/engine";
import { CLASS_UI, CLASS_LABEL, DAMAGE_STOPS, DEPTH_STOPS, ISSUE_COLOUR, kes } from "../lib/format";

export type Mode = "scenario" | "live";

export interface ViewState {
  rp: RP;
  colourMode: ColourMode;
  showIssues: boolean;
  portfolio: PortfolioView;
  playing: boolean;
  mode: Mode;
  liveRp: number | null;
}

export interface ViewActions {
  setRp: (r: RP) => void;
  setColourMode: (m: ColourMode) => void;
  setShowIssues: (v: boolean) => void;
  setPortfolio: (p: PortfolioView) => void;
  togglePlay: () => void;
  fly: (p: CameraPreset) => void;
  setMode: (m: Mode) => void;
  openReport: (tab?: ReportTab) => void;
}

export type ReportTab = "summary" | "benchmark" | "buildings" | "vulnerability" | "ai" | "node" | "sources";

const fmtKes = (n: number) => kes(n);
const fmtInt = (n: number) => Math.round(n).toLocaleString("en-KE");
const fmtKm2 = (n: number) => `${Math.round(n).toLocaleString("en-KE")} km²`;

export function lossesOf(res: PortfolioResult): Record<number, number> {
  return Object.fromEntries(KEY_RPS.map((r) => [r, res.scenarios[r].loss]));
}

export function Brand({ stats, portfolio, res, aiCount, onReport, theme, onToggleTheme }: { stats: Stats; portfolio: PortfolioView; res: PortfolioResult; aiCount: number; onReport: () => void; theme: Theme; onToggleTheme: () => void }) {
  const flagged = stats.starterFlags.UG + stats.starterFlags.LAKE;
  return (
    <div className="glass panel rounded-2xl px-4 py-3">
      <div className="flex items-center gap-3">
        <Logo />
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-bold leading-none tracking-tight">
            Risk <span className="text-sky-300">Forge</span>
          </div>
          <div className="mt-1 truncate text-xs text-slate-400">Nzoia Basin · river flood catastrophe model</div>
        </div>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="chip chip-real">JRC hazard · real</span>
        <span className="chip chip-synthetic">Portfolio · synthetic</span>
        <span className="chip chip-assume">Damage curves · assumption</span>
        {aiCount > 0 && <span className="chip chip-ai">{aiCount} AI-added</span>}
      </div>
      <div className="mt-2 hidden text-[11px] leading-snug sm:block">
        {portfolio === "book" ? (
          <span className="text-slate-400">
            {res.count.toLocaleString("en-KE")} synthetic buildings on real population (WorldPop 2020), Kenyan land only · {kes(res.tiv)} insured
          </span>
        ) : (
          <span className="text-rose-200/80">
            {flagged} of {stats.portfolios.starter.count} starter locations under review with the hosts
          </span>
        )}
      </div>
      <button
        onClick={onReport}
        className="mt-3 flex w-full items-center justify-between rounded-xl bg-gradient-to-r from-sky-400 to-cyan-300 px-3 py-2 text-[13px] font-semibold text-slate-950 shadow-[0_8px_30px_-8px_#38bdf8] transition hover:brightness-110"
      >
        <span>Underwriter report</span>
        <span className="text-[11px] font-medium opacity-80">all data, AI, node →</span>
      </button>
    </div>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-9 w-9 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#0b1626" stroke="rgb(148 163 184 / .2)" />
      <path d="M16 5c4 5 7 8.6 7 12.4A7 7 0 0 1 9 17.4C9 13.6 12 10 16 5z" fill="#38bdf8" />
      <rect x="12" y="19" width="2.4" height="5" rx=".6" fill="#fbbf24" />
      <rect x="15.2" y="16" width="2.4" height="8" rx=".6" fill="#fbbf24" />
      <rect x="18.4" y="18" width="2.4" height="6" rx=".6" fill="#fbbf24" />
    </svg>
  );
}

export function ModeTabs({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/[0.05] p-1">
      {(
        [
          ["scenario", "Flood scenarios"],
          ["live", "Live river node"],
        ] as [Mode, string][]
      ).map(([m, label]) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          aria-pressed={mode === m}
          className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[12px] font-medium transition ${mode === m ? "bg-white/[0.14] text-white" : "text-slate-400 hover:text-slate-200"}`}
        >
          {m === "live" && <span className={`h-1.5 w-1.5 rounded-full ${mode === "live" ? "animate-pulse bg-cyan-300" : "bg-slate-500"}`} />}
          {label}
        </button>
      ))}
    </div>
  );
}

export function Controls({ stats, res, s, a, compact }: { stats: Stats; res: PortfolioResult; s: ViewState; a: ViewActions; compact?: boolean }) {
  const at = res.scenarios[s.rp];
  return (
    <div className="space-y-4">
      <Section title="Flood scenario" hint="return period">
        <div className="grid grid-cols-6 gap-1">
          {RPS.map((r) => (
            <button
              key={r}
              onClick={() => a.setRp(r)}
              className={`rounded-lg px-1 py-1.5 text-[12px] font-medium tabular-nums transition ${
                r === s.rp ? "bg-sky-400 text-slate-950 shadow-[0_0_20px_-4px_#38bdf8]" : "bg-white/[0.05] text-slate-300 hover:bg-white/10"
              }`}
              aria-pressed={r === s.rp}
              title={`1-in-${r}-year flood (${(100 / r).toFixed(1)}% chance in any year)`}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
          <span>
            1-in-{s.rp} flood · {(100 / s.rp).toFixed(1)}% chance each year
          </span>
          <button onClick={a.togglePlay} className="rounded-md bg-white/[0.06] px-2 py-1 text-slate-200 hover:bg-white/10">
            {s.playing ? "❚❚ Pause" : "▶ Raise the river"}
          </button>
        </div>
      </Section>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Total exposure">
          <AnimatedValue value={res.tiv} format={fmtKes} />
        </Stat>
        <Stat label="Flooded land" tag="real">
          <AnimatedValue value={stats.floodLandKm2[s.rp]} format={fmtKm2} />
        </Stat>
        <Stat label={`Loss · 1-in-${s.rp}`} highlight>
          <AnimatedValue value={at.loss} format={fmtKes} />
        </Stat>
        <Stat label="Buildings in flood">
          <AnimatedValue value={at.wet} format={fmtInt} />
          <span className="text-slate-500"> / {res.count}</span>
        </Stat>
        <Stat label="Avg annual loss">
          <AnimatedValue value={res.aal} format={fmtKes} />
        </Stat>
        <Stat label="1-in-250" tag="interp">
          <AnimatedValue value={res.scenarios[250].loss} format={fmtKes} />
        </Stat>
      </div>

      <Section title="Portfolio">
        <Segmented
          value={s.portfolio}
          onChange={a.setPortfolio}
          options={[
            ["book", `Risk Forge book (${stats.portfolios.book.count.toLocaleString("en-KE")})`],
            ["starter", `Starter CSV (${stats.portfolios.starter.count})`],
          ]}
        />
        {s.portfolio === "book" ? (
          <p className="mt-2 text-[11px] leading-snug text-slate-500">
            Placed by population with a town uplift for insurance take-up. {stats.bookStrata.floodplain} buildings drawn from the floodplain zone so flood risk can be analysed; each row carries a sample weight.
          </p>
        ) : (
          <label className="mt-2 flex cursor-pointer items-center justify-between gap-3 text-[12px] text-slate-300">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: ISSUE_COLOUR }} />
              Highlight location issues ({stats.starterFlags.UG} Uganda · {stats.starterFlags.LAKE} in lake)
            </span>
            <input type="checkbox" className="toggle" checked={s.showIssues} onChange={(e) => a.setShowIssues(e.target.checked)} />
          </label>
        )}
      </Section>

      <Section title="Colour buildings by">
        <Segmented
          value={s.colourMode}
          onChange={a.setColourMode}
          options={[
            ["class", "Construction class"],
            ["damage", `Damage at 1-in-${s.rp}`],
          ]}
        />
      </Section>

      {!compact && (
        <Section title="Camera">
          <div className="grid grid-cols-3 gap-1">
            <CamButton onClick={() => a.fly("basin")}>Basin</CamButton>
            <CamButton onClick={() => a.fly("floodplain")}>Budalangi</CamButton>
            <CamButton onClick={() => a.fly("tour")}>Elgon → lake</CamButton>
          </div>
        </Section>
      )}
    </div>
  );
}

export function Insights({ res, s, a }: { res: PortfolioResult; s: ViewState; a: ViewActions }) {
  const rpForBars = s.mode === "live" ? 100 : s.rp;
  const byClass = res.scenarios[rpForBars].byClass;
  const maxClass = Math.max(...CLASSES.map((c) => byClass[c].loss), 1);
  return (
    <div className="space-y-4">
      <Section title="Loss by return period" hint="EP curve">
        <EpChart losses={lossesOf(res)} onsetRp={ONSET_RP} rp={s.mode === "scenario" ? s.rp : null} liveRp={s.mode === "live" ? s.liveRp : null} onPick={a.setRp} />
        <div className="mt-1 grid grid-cols-4 gap-1 text-center text-[10px] text-slate-400">
          {[10, 100, 250, 500].map((r) => (
            <div key={r} className="rounded bg-white/[0.04] py-1">
              <div>1-in-{r}</div>
              <div className="tabular-nums text-slate-200">{kes(res.scenarios[r].loss)}</div>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
          Losses assumed to start at the 1-in-{ONSET_RP} flood. JRC maps ignore the Budalangi dykes, so this onset is our biggest uncertainty.
        </p>
      </Section>

      <Section title={`Loss by construction · 1-in-${rpForBars}`}>
        <div className="space-y-1.5">
          {CLASSES.map((c) => (
            <div key={c} className="text-[12px]">
              <div className="flex justify-between text-slate-300">
                <span>{CLASS_LABEL[c]}</span>
                <span className="tabular-nums text-slate-400">{kes(byClass[c].loss)}</span>
              </div>
              <div className="mt-0.5 h-1.5 rounded-full bg-white/[0.06]">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(byClass[c].loss / maxClass) * 100}%`, background: CLASS_UI[c] }} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Legend">
        <Ramp label="Flood depth" stops={DEPTH_STOPS.map(([v, c]) => [`${v} m`, c])} />
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          Severity score = depth ÷ {SEVERITY_REF_M} m, capped at 1 (≈ roof level of a single-storey house). Losses use the depth in metres.
        </p>
        {s.colourMode === "damage" ? (
          <Ramp label="Damage ratio" stops={DAMAGE_STOPS.filter(([v]) => v !== 0.001).map(([v, c]) => [v === 0 ? "dry" : `${Math.round(v * 100)}%`, c])} />
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-300">
            {CLASSES.map((c) => (
              <span key={c} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: CLASS_UI[c] }} />
                {CLASS_LABEL[c]}
              </span>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] leading-snug text-slate-500">
          Heights are exaggerated: water columns ×{WATER_EXAGGERATION} of depth; building pillars scale with insured value. Building squares are symbolic, not real footprints.
        </p>
      </Section>

      <button onClick={() => a.openReport("sources")} className="w-full rounded-lg bg-white/[0.05] px-3 py-2 text-left text-[12px] text-slate-300 hover:bg-white/10">
        Data sources, assumptions and the written note →
      </button>
    </div>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{title}</h3>
        {hint && <span className="text-[10px] uppercase tracking-wider text-slate-600">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, tag, highlight, children }: { label: string; tag?: string; highlight?: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 ${highlight ? "bg-amber-300/10 ring-1 ring-amber-300/25" : "bg-white/[0.04]"}`}>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
        {label}
        {tag && <span className={tag === "real" ? "text-emerald-400/80" : "text-violet-300/80"}>{tag}</span>}
      </div>
      <div className={`mt-0.5 font-display text-[16px] font-semibold tabular-nums ${highlight ? "text-amber-200" : "text-slate-50"}`}>{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/[0.04] p-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={v === value}
          className={`rounded-lg px-2 py-1.5 text-[12px] transition ${v === value ? "bg-white/[0.12] text-white" : "text-slate-400 hover:text-slate-200"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function CamButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="rounded-lg bg-white/[0.05] px-2 py-1.5 text-[12px] text-slate-300 hover:bg-white/10 hover:text-white">
      {children}
    </button>
  );
}

function Ramp({ label, stops }: { label: string; stops: [string, string][] }) {
  return (
    <div className="mt-1">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="mt-1 h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${stops.map(([, c]) => c).join(",")})` }} />
      <div className="mt-0.5 flex justify-between text-[10px] text-slate-500">
        {stops.map(([l], i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}

export function Credit({ className = "" }: { className?: string }) {
  return (
    <div className={`text-[11px] text-slate-500 ${className}`}>
      Prototype · synthetic portfolio ·{" "}
      <a href="https://rytrix.co.ke" target="_blank" rel="noopener" className="text-slate-400 hover:text-sky-300">
        Built by Rytrix
      </a>
    </div>
  );
}
