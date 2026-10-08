import { useEffect, useMemo, useState } from "react";
import type { BuildingProps, RP } from "../lib/types";
import { RPS } from "../lib/types";
import { aal, buildingAt, contentsOf, KEY_RPS, ONSET_RP, severity, valueOf, weightOf } from "../lib/engine";
import EpChart from "./EpChart";
import { CLASS_UI, CLASS_LABEL, ISSUE_COLOUR, WHERE_LABEL, kes } from "../lib/format";
import { useWidth } from "../lib/useWidth";

/** One building, tapped on the map: hazard -> vulnerability -> exposure -> financial, its loss at every return
 *  period and its own EP curve. The full numbers fold away under "Numbers". */
export default function BuildingCard({
  b,
  rp,
  liveRp,
  onClose,
  all,
  onSelect,
  onNeighbours,
}: {
  b: BuildingProps;
  rp: RP;
  liveRp: number | null;
  onClose: () => void;
  /** every building on the map, to find this one's neighbours */
  all: BuildingProps[];
  onSelect: (b: BuildingProps) => void;
  /** the neighbours listed, so the map can outline them */
  onNeighbours: (ids: string[]) => void;
}) {
  const showRp = liveRp ?? rp;
  const now = buildingAt(b, showRp);
  const w = weightOf(b);
  const c = contentsOf(b);
  const contents = c.stock + c.machinery + c.other;
  const value = valueOf(b);
  const losses = Object.fromEntries(KEY_RPS.map((r) => [r, buildingAt(b, r).loss])) as Record<number, number>;
  const ownAal = aal(Object.fromEntries(RPS.map((r) => [r, losses[r]])) as Record<RP, number>);
  const rpLabel = liveRp ? (liveRp > 2 ? `Live ≈1-in-${Math.round(liveRp)}` : "Live, in bank") : `1-in-${rp}`;
  const hazardSource = b.hz === "site" ? "site flood history" : "JRC flood map";
  const floor = Number(b.floor) || 0;
  const damage = value > 0 ? now.loss / value : 0;

  return (
    <div className="glass panel @container rounded-2xl p-4 text-[14px] leading-snug sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: CLASS_UI[b.cls] }} />
            <span className="font-display text-lg tracking-tight sm:text-xl">{typeof b.name === "string" ? b.name : b.id}</span>
            {b.gen ? <span className="chip chip-ai">AI sample · fictional</span> : b.src === "ai" ? <span className="chip chip-ai">AI · {Math.round((b.confidence ?? 0) * 100)}%</span> : <span className="chip chip-synthetic">synthetic</span>}
          </div>
          <div className="mt-0.5 text-[13px] text-slate-300">
            {CLASS_LABEL[b.cls]} · {b.area.toLocaleString("en-KE")} m²{b.settlement && b.settlement !== "other" ? ` · ${b.settlement}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden rounded-full bg-amber-300/15 px-3 py-1 text-[13px] font-medium text-amber-200 ring-1 ring-amber-300/30 @md:inline">{rpLabel} flood</span>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg text-lg text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Close building details">
            ✕
          </button>
        </div>
      </div>

      {b.where !== "KE" && (
        <div className="mt-3 rounded-lg border px-3 py-2 text-[13px] text-rose-200" style={{ borderColor: `${ISSUE_COLOUR}66`, background: `${ISSUE_COLOUR}14` }}>
          ⚠ {WHERE_LABEL[b.where]}
          {b.w === 0 ? " · not in portfolio results" : ""}
        </div>
      )}

      {/* the pipeline for this building at the chosen flood, left to right */}
      <div className="mt-4 grid grid-cols-2 gap-2 @2xl:grid-cols-4">
        <Stage n="1" label="Hazard" q="How deep is the water?" value={now.depth > 0 ? `${now.depth.toFixed(2)} m` : "Dry"} sub={`${rpLabel} · ${hazardSource}`} kind={b.hz === "site" ? "ai" : "real"} />
        <Stage n="2" label="Vulnerability" q="How much is damaged?" value={`${(damage * 100).toFixed(0)}%`} sub={floor > 0 ? `floor raised ${floor} m` : "of the value at risk"} kind="assumption" />
        <Stage n="3" label="Exposure" q="What is at risk?" value={kes(value)} sub={contents > 0 ? `building + ${kes(contents)} contents` : `KES ${b.cost.toLocaleString("en-KE")} per m²`} kind={b.src === "ai" ? "ai" : "synthetic"} />
        <Stage n="4" label="Financial" q="What is the loss?" value={kes(now.loss)} sub={w !== 1 ? `${kes(now.loss * w)} in the book (×${w.toFixed(2)})` : `${kes(ownAal)} a year on average`} strong />
      </div>
      <SourceKey />

      <div className="mt-4 grid gap-3 @lg:grid-cols-2">
        <div className="rounded-xl bg-white/[0.03] p-3">
          <div className="text-[13px] font-medium text-slate-200">Loss at each flood size</div>
          <div className="text-[12px] text-slate-400">bar = loss · blue = water depth here</div>
          <LossBars b={b} losses={losses} rp={liveRp ? null : rp} />
        </div>
        <div className="rounded-xl bg-white/[0.03] p-3">
          <div className="text-[13px] font-medium text-slate-200">EP curve</div>
          <div className="text-[12px] text-slate-400">rarer floods to the right · average {kes(ownAal)} a year</div>
          <SizedEp losses={losses} rp={liveRp ? null : rp} liveRp={liveRp} />
        </div>
      </div>

      <Neighbours key={b.id} b={b} all={all} rp={showRp} rpLabel={rpLabel} onSelect={onSelect} onNeighbours={onNeighbours} />

      <details className="group mt-3 text-[13px]">
        <summary className="cursor-pointer list-none py-1 text-slate-300 hover:text-white">
          <span className="inline-block transition group-open:rotate-90">›</span> All numbers
        </summary>
        <div className="overflow-x-auto">
          <table className="mt-1 w-full min-w-[320px]">
            <thead className="text-slate-400">
              <tr>
                <th className="py-1.5 text-left font-medium">Flood</th>
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
                  <tr key={r} className={`border-t border-white/5 ${!liveRp && r === rp ? "text-amber-200" : "text-slate-200"}`}>
                    <td className="py-1">1-in-{r}</td>
                    <td className="text-right tabular-nums">{x.depth.toFixed(2)} m</td>
                    <td className="text-right tabular-nums">{severity(x.depth).toFixed(2)}</td>
                    <td className="text-right tabular-nums">{value > 0 ? ((x.loss / value) * 100).toFixed(0) : 0}%</td>
                    <td className="text-right tabular-nums">{kes(x.loss)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-1.5 text-slate-400">
          Structure {kes(b.tiv)}
          {contents > 0 ? ` · stock ${kes(c.stock)} · machinery ${kes(c.machinery)}` : ""}
          {typeof b.cal === "number" && b.cal !== 1 ? ` · calibrated ×${b.cal.toFixed(2)} to site claims` : ""}
          {b.tivCsv / b.tiv > 5 ? ` · CSV value ${kes(b.tivCsv)} (×${(b.tivCsv / b.tiv).toFixed(0)})` : ""}
        </div>
      </details>
    </div>
  );
}

const RADII = [1, 5, 10];
const kmTo = (a: BuildingProps, b: BuildingProps) => Math.hypot((a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180), a.lat - b.lat) * 111.32;

/**
 * The buildings around this one: what floods with it in the same event (accumulation). Counts and sums are as they
 * stand in the book (sample weights); the list shows the nearest few, tap one to open it.
 */
function Neighbours({ b, all, rp, rpLabel, onSelect, onNeighbours }: { b: BuildingProps; all: BuildingProps[]; rp: number; rpLabel: string; onSelect: (b: BuildingProps) => void; onNeighbours: (ids: string[]) => void }) {
  const near = useMemo(
    () =>
      all
        .filter((o) => o.id !== b.id && Math.abs(o.lat - b.lat) < 0.1 && Math.abs(o.lon - b.lon) < 0.1)
        .map((o) => ({ o, km: kmTo(b, o) }))
        .filter((x) => x.km <= RADII[RADII.length - 1])
        .sort((x, y) => x.km - y.km),
    [all, b],
  );
  // start at the smallest radius that has a few neighbours
  const [radius, setRadius] = useState(() => RADII.find((r) => near.filter((x) => x.km <= r).length >= 3) ?? RADII[RADII.length - 1]);
  const inR = useMemo(() => near.filter((x) => x.km <= radius).map((x) => ({ ...x, at: buildingAt(x.o, rp), w: weightOf(x.o) })), [near, radius, rp]);
  const ids = inR.map((x) => x.o.id).join(",");
  useEffect(() => {
    onNeighbours(ids ? ids.split(",") : []);
  }, [ids, onNeighbours]);
  useEffect(() => () => onNeighbours([]), [onNeighbours]);

  const own = buildingAt(b, rp).loss * weightOf(b);
  const count = inR.reduce((s, x) => s + x.w, 0);
  const value = inR.reduce((s, x) => s + valueOf(x.o) * x.w, 0);
  const loss = inR.reduce((s, x) => s + x.at.loss * x.w, 0);
  const wet = inR.filter((x) => x.at.depth > 0).length;
  const total = own + loss;
  const weighted = inR.some((x) => x.w !== 1);
  const list = inR.slice(0, 6);
  const maxLoss = Math.max(...list.map((x) => x.at.loss), 1);

  return (
    <div className="mt-4 rounded-xl bg-white/[0.03] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-medium text-slate-200">Neighbours · what floods with it</div>
          <div className="text-[12px] text-slate-400">buildings within {radius} km, outlined in amber on the map</div>
        </div>
        <div className="flex gap-1" role="group" aria-label="Neighbour radius">
          {RADII.map((r) => (
            <button key={r} onClick={() => setRadius(r)} className={`rounded-full px-2.5 py-1 text-[12px] ${r === radius ? "bg-amber-300/20 text-amber-100 ring-1 ring-amber-300/40" : "bg-white/[0.05] text-slate-300 hover:bg-white/10"}`}>
              {r} km
            </button>
          ))}
        </div>
      </div>

      {inR.length === 0 ? (
        <div className="mt-2 text-[13px] text-slate-400">No other insured building within {radius} km: this risk does not accumulate with the book here.</div>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2 @xl:grid-cols-4">
            <Mini label="Neighbours" value={weighted ? `≈${count.toFixed(1)}` : String(inR.length)} sub={weighted ? `${inR.length} sampled, book-weighted` : `${wet} flooded at ${rpLabel}`} />
            <Mini label="Their value" value={kes(value)} sub="insured, in the book" />
            <Mini label={`Their loss, ${rpLabel}`} value={kes(loss)} sub={`${wet} of ${inR.length} under water`} />
            <Mini label="One event, together" value={kes(total)} sub={total > 0 ? `this building ${Math.round((own / total) * 100)}% of it` : "no loss at this flood"} strong />
          </div>
          {/* this building vs. its neighbours in the same flood */}
          {total > 0 && (
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
              <div className="bg-amber-300" style={{ width: `${(own / total) * 100}%` }} />
              <div className="bg-[var(--chart-fill)]" style={{ width: `${(loss / total) * 100}%` }} />
            </div>
          )}
          <ul className="mt-2 divide-y divide-white/5 text-[13px]">
            {list.map(({ o, km, at }) => (
              <li key={o.id}>
                <button onClick={() => onSelect(o)} className="flex w-full items-center gap-2 py-1.5 text-left hover:bg-white/[0.04]">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: CLASS_UI[o.cls] }} />
                  <span className="min-w-0 flex-1 truncate text-slate-200">
                    {typeof o.name === "string" ? o.name : o.id}
                    <span className="text-slate-500"> · {CLASS_LABEL[o.cls]}</span>
                  </span>
                  <span className="w-14 shrink-0 text-right tabular-nums text-slate-400">{km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`}</span>
                  <span className={`w-14 shrink-0 text-right tabular-nums ${at.depth > 0 ? "text-sky-300" : "text-slate-500"}`}>{at.depth > 0 ? `${at.depth.toFixed(1)} m` : "dry"}</span>
                  <span className="hidden w-24 shrink-0 @md:block">
                    <span className="block h-1.5 rounded-full bg-[var(--chart-fill)]" style={{ width: `${Math.max((at.loss / maxLoss) * 100, at.loss > 0 ? 4 : 0)}%` }} />
                  </span>
                  <span className="w-20 shrink-0 text-right tabular-nums text-slate-100">{kes(at.loss)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 text-[12px] text-slate-500">
            {inR.length > list.length ? `+ ${inR.length - list.length} more within ${radius} km. ` : ""}
            {weighted ? "Each row is one sampled building's own loss; the totals above count each at its weight in the book." : ""}
          </div>
        </>
      )}
    </div>
  );
}

function Mini({ label, value, sub, strong }: { label: string; value: string; sub: string; strong?: boolean }) {
  return (
    <div className={`min-w-0 rounded-lg px-2.5 py-2 ${strong ? "bg-amber-300/10 ring-1 ring-amber-300/25" : "bg-white/[0.04]"}`}>
      <div className="truncate text-[12px] text-slate-400">{label}</div>
      <div className={`truncate font-display text-[17px] ${strong ? "text-amber-200" : "text-slate-50"}`}>{value}</div>
      <div className="truncate text-[11px] text-slate-400">{sub}</div>
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

function Stage({ n, label, q, value, sub, kind, strong }: { n: string; label: string; q: string; value: string; sub: string; kind?: keyof typeof SOURCE; strong?: boolean }) {
  return (
    <div className={`min-w-0 rounded-xl px-3 py-2.5 ${strong ? "bg-amber-300/10 ring-1 ring-amber-300/30" : "bg-white/[0.05]"}`}>
      <div className="flex items-center gap-2">
        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${strong ? "bg-amber-300/25 text-amber-100" : "bg-white/10 text-slate-200"}`}>{n}</span>
        <span className="truncate text-[13px] font-semibold text-slate-200">{label}</span>
        {kind && <span className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SOURCE[kind].colour }} title={SOURCE[kind].label} aria-label={SOURCE[kind].label} />}
      </div>
      <div className="mt-0.5 truncate text-[12px] text-slate-400">{q}</div>
      <div className={`mt-1 truncate font-display text-[22px] leading-tight ${strong ? "text-amber-200" : "text-slate-50"}`}>{value}</div>
      <div className="truncate text-[12px] text-slate-300" title={sub}>{sub}</div>
    </div>
  );
}

/** what the coloured dots on the tiles mean */
function SourceKey() {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-400">
      {Object.values(SOURCE).map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: s.colour }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

const short = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}bn` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : n > 0 ? `${Math.round(n)}` : "0");

const FONT = 12;

/** the EP chart drawn at its real width so its labels stay 12 px */
function SizedEp({ losses, rp, liveRp }: { losses: Record<number, number>; rp: number | null; liveRp: number | null }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  return (
    <div ref={ref} className="mt-2">
      <EpChart losses={losses} onsetRp={ONSET_RP} rp={rp} liveRp={liveRp} height={190} width={width} fontSize={FONT} />
    </div>
  );
}

/** this building's loss at each JRC return period, with the flood depth under each bar */
function LossBars({ b, losses, rp }: { b: BuildingProps; losses: Record<number, number>; rp: number | null }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const H = 190;
  const pad = { t: FONT + 8, b: FONT * 3 + 8 };
  const max = Math.max(...RPS.map((r) => losses[r]), 1);
  const bw = W / RPS.length;
  return (
    <div ref={ref} className="mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Loss by return period for this building">
        {RPS.map((r, i) => {
          const h = (losses[r] / max) * (H - pad.t - pad.b);
          const on = r === rp;
          const depth = Number(b[`d${r}`]) || 0;
          const cx = i * bw + bw / 2;
          return (
            <g key={r}>
              <title>{`1-in-${r} flood: ${depth > 0 ? `${depth.toFixed(2)} m of water` : "dry"}, loss ${kes(losses[r])}`}</title>
              <rect x={i * bw} y={0} width={bw} height={H} fill="transparent" />
              <rect x={i * bw + bw * 0.18} y={H - pad.b - h} width={bw * 0.64} height={Math.max(h, losses[r] > 0 ? 2 : 0)} rx={3} fill={on ? "#fbbf24" : "var(--chart-fill)"} opacity={on ? 1 : 0.85} />
              <text x={cx} y={H - pad.b - h - 5} textAnchor="middle" fontSize={FONT} className={on ? "fill-amber-200" : "fill-slate-200"}>
                {short(losses[r])}
              </text>
              <text x={cx} y={H - pad.b + FONT + 4} textAnchor="middle" fontSize={FONT} fontWeight={on ? 600 : 400} className={on ? "fill-amber-200" : "fill-slate-300"}>
                {bw > 48 ? `1-in-${r}` : r}
              </text>
              <text x={cx} y={H - pad.b + FONT * 2 + 8} textAnchor="middle" fontSize={FONT - 1} className={depth > 0 ? "fill-sky-300" : "fill-slate-500"}>
                {depth > 0 ? `${depth.toFixed(1)} m` : "dry"}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
