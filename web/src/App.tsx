import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { FeatureCollection, Polygon } from "geojson";
import MapScene, { type CameraPreset } from "./components/MapScene";
import BuildingCard from "./components/BuildingCard";
import { Brand, Controls, Credit, Insights, type ViewActions, type ViewState } from "./components/Panels";
import type { BuildingProps, ColourMode, Place, PortfolioView, RP, Stats } from "./lib/types";
import { RPS } from "./lib/types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

export default function App() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [books, setBooks] = useState<Record<PortfolioView, FeatureCollection<Polygon, BuildingProps>> | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [rp, setRp] = useState<RP>(100);
  const [colourMode, setColourMode] = useState<ColourMode>("class");
  const [showIssues, setShowIssues] = useState(true);
  const [portfolio, setPortfolio] = useState<PortfolioView>("book");
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<BuildingProps | null>(null);
  const [camera, setCamera] = useState<{ preset: CameraPreset; nonce: number } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const rpRef = useRef(rp);
  rpRef.current = rp;

  useEffect(() => {
    Promise.all([
      getJson<Stats>("/data/stats.json"),
      getJson<FeatureCollection<Polygon, BuildingProps>>("/data/buildings_book.geojson"),
      getJson<FeatureCollection<Polygon, BuildingProps>>("/data/buildings_starter.geojson"),
      getJson<Place[]>("/data/places.json"),
    ])
      .then(([s, book, starter, p]) => {
        setStats(s);
        setBooks({ book, starter });
        setPlaces(p);
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  // "Raise the river": step through the return periods
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const i = RPS.indexOf(rpRef.current);
      if (i >= RPS.length - 1) setPlaying(false);
      else setRp(RPS[i + 1]);
    }, 1700);
    return () => window.clearInterval(id);
  }, [playing]);

  // panels slide in once the data is ready
  useLayoutEffect(() => {
    if (!stats || !root.current) return;
    const ctx = gsap.context(() => {
      gsap.from(".panel", { opacity: 0, y: 18, duration: 0.8, ease: "power3.out", stagger: 0.08, delay: 0.4 });
    }, root);
    return () => ctx.revert();
  }, [stats]);

  const s: ViewState = { rp, colourMode, showIssues, portfolio, playing };
  const a: ViewActions = useMemo(
    () => ({
      setRp: (r: RP) => {
        setPlaying(false);
        setRp(r);
      },
      setColourMode,
      setShowIssues,
      setPortfolio: (p: PortfolioView) => {
        setSelected(null);
        setPortfolio(p);
      },
      togglePlay: () =>
        setPlaying((p) => {
          if (!p && rpRef.current === RPS[RPS.length - 1]) setRp(RPS[0]);
          return !p;
        }),
      fly: (preset: CameraPreset) => setCamera({ preset, nonce: Date.now() }),
    }),
    [],
  );

  return (
    <div ref={root} className="relative h-dvh w-full overflow-hidden bg-[#050b14] text-slate-100">
      {books && places && (
        <MapScene
          buildings={books[portfolio]}
          places={places}
          rp={rp}
          colourMode={colourMode}
          showIssues={showIssues}
          portfolio={portfolio}
          selectedId={selected?.id ?? null}
          camera={camera}
          onSelect={setSelected}
          onIntroDone={() => undefined}
        />
      )}

      {!stats && (
        <div className="absolute inset-0 grid place-items-center text-sm text-slate-400">
          {error ? `Could not load data: ${error}` : <span className="animate-pulse">Loading the Nzoia basin…</span>}
        </div>
      )}

      {stats && (
        <>
          {/* left column: brand + controls (controls desktop only) */}
          <div className="pointer-events-none absolute left-0 top-0 flex max-h-full w-full flex-col gap-3 p-3 sm:w-[360px] sm:p-4">
            <div className="pointer-events-auto pr-12 sm:pr-0">
              <Brand stats={stats} portfolio={portfolio} />
            </div>
            <div className="glass panel scroll-thin pointer-events-auto hidden min-h-0 overflow-y-auto rounded-2xl p-4 lg:block">
              <Controls stats={stats} s={s} a={a} />
            </div>
          </div>

          {/* right column: insights (desktop) */}
          <div className="pointer-events-none absolute right-0 top-0 hidden max-h-[calc(100%-120px)] w-[340px] p-4 lg:flex">
            <div className="glass panel scroll-thin pointer-events-auto min-h-0 overflow-y-auto rounded-2xl p-4">
              <Insights stats={stats} s={s} a={a} />
            </div>
          </div>

          {/* building details */}
          {selected && (
            <div className="rise-in absolute inset-x-3 bottom-[226px] z-10 max-h-[46dvh] overflow-y-auto sm:left-auto sm:right-3 sm:w-[380px] lg:inset-x-auto lg:bottom-4 lg:left-[376px] lg:right-auto lg:max-h-[60dvh]">
              <BuildingCard b={selected} rp={rp} severityRefM={stats.severityRefM} onClose={() => setSelected(null)} />
            </div>
          )}

          {/* mobile bottom sheet */}
          <div className="glass panel absolute inset-x-0 bottom-0 z-20 rounded-t-3xl lg:hidden">
            <button
              onClick={() => setSheetOpen((o) => !o)}
              className="flex w-full flex-col items-center pt-2 pb-1"
              aria-label={sheetOpen ? "Collapse panel" : "Expand panel"}
              aria-expanded={sheetOpen}
            >
              <span className="h-1.5 w-10 rounded-full bg-white/25" />
              <span className="mt-1 text-[10px] uppercase tracking-widest text-slate-500">{sheetOpen ? "less" : "more"}</span>
            </button>
            <div className="scroll-thin overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+14px)]" style={{ maxHeight: sheetOpen ? "68dvh" : "180px" }}>
              <Controls stats={stats} s={s} a={a} compact />
              <div className="mt-4 border-t border-white/10 pt-4">
                <Insights stats={stats} s={s} a={a} />
              </div>
              <Credit className="mt-4 text-center" />
            </div>
          </div>

          <Credit className="pointer-events-auto absolute bottom-2 left-1/2 hidden -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 backdrop-blur lg:block" />
        </>
      )}
    </div>
  );
}
