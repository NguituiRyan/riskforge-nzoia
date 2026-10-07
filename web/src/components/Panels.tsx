import type { ReactNode } from "react";
import AnimatedValue from "./AnimatedValue";
import EpChart from "./EpChart";
import { WATER_EXAGGERATION, type CameraPreset } from "./MapScene";
import type { ColourMode, PortfolioView, RP, Stats } from "../lib/types";
import { CLASSES, RPS } from "../lib/types";
import { CLASS_COLOUR, CLASS_LABEL, DAMAGE_STOPS, DEPTH_STOPS, ISSUE_COLOUR, kes } from "../lib/format";

export interface ViewState {
  rp: RP;
  colourMode: ColourMode;
  showIssues: boolean;
  portfolio: PortfolioView;
  playing: boolean;
}

export interface ViewActions {
  setRp: (r: RP) => void;
  setColourMode: (m: ColourMode) => void;
  setShowIssues: (v: boolean) => void;
  setPortfolio: (p: PortfolioView) => void;
  togglePlay: () => void;
  fly: (p: CameraPreset) => void;
}

const fmtKes = (n: number) => kes(n);
const fmtInt = (n: number) => Math.round(n).toLocaleString("en-KE");
const fmtKm2 = (n: number) => `${Math.round(n).toLocaleString("en-KE")} km²`;

export function Brand({ stats, portfolio }: { stats: Stats; portfolio: PortfolioView }) {
  const flagged = stats.starterFlags.UG + stats.starterFlags.LAKE;
  const book = stats.portfolios.book;
  return (
    <div className="glass panel rounded-2xl px-4 py-3">
      <div className="flex items-center gap-3">
        <Logo />
        <div className="min-w-0">
          <div className="font-display text-lg font-bold leading-none tracking-tight">
            Risk <span className="text-sky-300">Forge</span>
          </div>
          <div className="mt-1 truncate text-xs text-slate-400">Nzoia Basin · river flood exposure in 3D</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="chip chip-real">JRC hazard · real</span>
        <span className="chip chip-synthetic">Portfolio · synthetic</span>
        <span className="chip chip-assume">Damage curves · assumption</span>
      </div>
      {portfolio === "book" ? (
        <div className="mt-2 hidden text-[11px] leading-snug text-slate-400 sm:block">
          {book.count.toLocaleString("en-KE")} synthetic buildings placed on real population (WorldPop 2020), Kenyan land only
        </div>
      ) : (
        <div className="mt-2 hidden text-[11px] leading-snug text-rose-200/80 sm:block">
          {flagged} of {stats.portfolios.starter.count} starter locations under review with the hosts
        </div>
      )}
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

export function Controls({ stats, s, a, compact }: { stats: Stats; s: ViewState; a: ViewActions; compact?: boolean }) {
  const p = stats.portfolios[s.portfolio];
  const at = p.perRp[s.rp];
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
        <Stat label="Flooded land" tag="real">
          <AnimatedValue value={stats.floodLandKm2[s.rp]} format={fmtKm2} />
        </Stat>
        <Stat label="Buildings in flood">
          <AnimatedValue value={at.buildingsWet} format={fmtInt} />
          <span className="text-slate-500"> / {p.count}</span>
        </Stat>
        <Stat label={`Loss · 1-in-${s.rp}`} highlight>
          <AnimatedValue value={at.loss} format={fmtKes} />
        </Stat>
        <Stat label="Average annual loss">
          <AnimatedValue value={p.aal} format={fmtKes} />
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
            Placed by population with a town uplift for insurance take-up. {stats.bookStrata.floodplain} of the buildings are drawn from the floodplain zone so flood risk can be analysed; each row carries a sample weight.
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

export function Insights({ stats, s, a }: { stats: Stats; s: ViewState; a: ViewActions }) {
  const p = stats.portfolios[s.portfolio];
  const byClass = p.perRp[s.rp].lossByClass;
  const maxClass = Math.max(...CLASSES.map((c) => byClass[c]), 1);
  return (
    <div className="space-y-4">
      <Section title="Loss by return period" hint="EP curve">
        <EpChart stats={p} rp={s.rp} onsetRp={stats.onsetRp} onPick={a.setRp} />
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          Losses assumed to start at the 1-in-{stats.onsetRp} flood. JRC maps ignore the Budalangi dykes, so this onset is our biggest uncertainty.
        </p>
      </Section>

      <Section title={`Loss by construction · 1-in-${s.rp}`}>
        <div className="space-y-1.5">
          {CLASSES.map((c) => (
            <div key={c} className="text-[12px]">
              <div className="flex justify-between text-slate-300">
                <span>{CLASS_LABEL[c]}</span>
                <span className="tabular-nums text-slate-400">{kes(byClass[c])}</span>
              </div>
              <div className="mt-0.5 h-1.5 rounded-full bg-white/[0.06]">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(byClass[c] / maxClass) * 100}%`, background: CLASS_COLOUR[c] }} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Legend">
        <Ramp label="Flood depth" stops={DEPTH_STOPS.map(([v, c]) => [`${v} m`, c])} />
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          Severity score = depth ÷ {stats.severityRefM} m, capped at 1 (1 ≈ roof level of a single-storey house). Losses use the depth in metres.
        </p>
        {s.colourMode === "damage" ? (
          <Ramp label="Damage ratio" stops={DAMAGE_STOPS.filter(([v]) => v !== 0.001).map(([v, c]) => [v === 0 ? "dry" : `${Math.round(v * 100)}%`, c])} />
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-300">
            {CLASSES.map((c) => (
              <span key={c} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: CLASS_COLOUR[c] }} />
                {CLASS_LABEL[c]}
              </span>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] leading-snug text-slate-500">
          Heights are exaggerated: water columns ×{WATER_EXAGGERATION} of depth; building pillars scale with insured value. Building squares are symbolic, not real footprints.
        </p>
      </Section>

      <Section title="Data notes">
        <ul className="list-disc space-y-1 pl-4 text-[11px] leading-snug text-slate-400">
          <li>Hazard: JRC global river flood maps, ~925 m cells, undefended (no dykes). Lake Victoria cells masked: {Math.round(stats.lakeWetShare * 100)}% of the raw &quot;flooded&quot; cells were lake water.</li>
          {s.portfolio === "book" ? (
            <li>Risk Forge book: synthetic buildings on WorldPop 2020 population, Kenyan land only, lake excluded. Class mix, floor area and cost/m² follow the dataset metadata ranges; not a real portfolio.</li>
          ) : (
            <li>Starter CSV from the hosts: {stats.starterFlags.UG} rows fall in Uganda and {stats.starterFlags.LAKE} in Lake Victoria (under review). Its value column is 10× floor area × cost (total {kes(stats.starterTivCsvTotal)}); we use area × cost, per the metadata.</li>
          )}
          <li>Damage: Huizinga et al. (2017) JRC Africa curve, adapted per class after Englhardt et al. (2019).</li>
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
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
        {tag && <span className="text-emerald-400/80">{tag}</span>}
      </div>
      <div className={`mt-0.5 font-display text-[17px] font-semibold tabular-nums ${highlight ? "text-amber-200" : "text-slate-50"}`}>{children}</div>
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
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
