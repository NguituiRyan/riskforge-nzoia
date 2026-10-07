import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { FeatureCollection, Polygon } from "geojson";
import MapScene, { type CameraPreset, type NodeMarkerState } from "./components/MapScene";
import BuildingCard from "./components/BuildingCard";
import LivePanel from "./components/LivePanel";
import Report from "./components/report/Report";
import { Brand, Controls, Credit, Insights, ModeTabs, type Mode, type ReportTab, type ViewActions, type ViewState } from "./components/Panels";
import type { BuildingProps, ColourMode, Place, PortfolioView, RP, Stats } from "./lib/types";
import { RPS } from "./lib/types";
import { buildFloodGrid, runPortfolio, scenario, type FloodGrid } from "./lib/engine";
import { alertFor, rpForStage, type NodeData, type NodeReading, type TriggerTerms } from "./lib/node";
import { squareFeature } from "./lib/report";
import { applyTheme, initialTheme, type Theme } from "./lib/theme";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

type BuildingFC = FeatureCollection<Polygon, BuildingProps>;
interface Loaded {
  stats: Stats;
  fcs: Record<PortfolioView, BuildingFC>;
  places: Place[];
  gazetteer: Place[];
  grid: FloodGrid;
  nd: NodeData;
}

const PORTFOLIO_NAME: Record<PortfolioView, string> = { book: "Risk Forge book", starter: "Starter CSV (hosts)" };

export default function App() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [rp, setRp] = useState<RP>(100);
  const [colourMode, setColourMode] = useState<ColourMode>("class");
  const [showIssues, setShowIssues] = useState(true);
  const [portfolio, setPortfolio] = useState<PortfolioView>("book");
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<BuildingProps | null>(null);
  const [camera, setCamera] = useState<{ preset: CameraPreset; nonce: number } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("scenario");
  const [reading, setReading] = useState<NodeReading | null>(null);
  const [aiRows, setAiRows] = useState<BuildingProps[]>([]);
  const [trigger, setTrigger] = useState<TriggerTerms>({ triggerStage: 4.8, payout: 50_000_000, load: 0.4 });
  const [report, setReport] = useState<{ open: boolean; tab: ReportTab }>({ open: false, tab: "summary" });
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const toggleTheme = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  useEffect(() => applyTheme(theme), [theme]);
  const root = useRef<HTMLDivElement>(null);
  const rpRef = useRef(rp);
  rpRef.current = rp;

  useEffect(() => {
    Promise.all([
      getJson<Stats>("/data/stats.json"),
      getJson<BuildingFC>("/data/buildings_book.geojson"),
      getJson<BuildingFC>("/data/buildings_starter.geojson"),
      getJson<Place[]>("/data/places.json"),
      getJson<Place[]>("/data/gazetteer.json"),
      getJson<Parameters<typeof buildFloodGrid>[0]>("/data/flood_cells.geojson"),
      getJson<NodeData>("/data/river_node.json"),
    ])
      .then(([stats, book, starter, places, gazetteer, flood, nd]) => setData({ stats, fcs: { book, starter }, places, gazetteer, grid: buildFloodGrid(flood), nd }))
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
    if (!data || !root.current) return;
    const ctx = gsap.context(() => {
      gsap.from(".panel", { opacity: 0, y: 18, duration: 0.8, ease: "power3.out", stagger: 0.08, delay: 0.4 });
    }, root);
    return () => ctx.revert();
  }, [data]);

  // ---------- the model ----------
  const baseBuildings = useMemo(
    () => (data ? { book: data.fcs.book.features.map((f) => f.properties), starter: data.fcs.starter.features.map((f) => f.properties) } : { book: [], starter: [] }),
    [data],
  ) as Record<PortfolioView, BuildingProps[]>;
  const buildings = useMemo(() => [...baseBuildings[portfolio], ...aiRows], [baseBuildings, portfolio, aiRows]);
  const res = useMemo(() => runPortfolio(buildings), [buildings]);
  const baseRes = useMemo(() => runPortfolio(baseBuildings[portfolio]), [baseBuildings, portfolio]);
  const mapFc = useMemo<BuildingFC | null>(() => (data ? { type: "FeatureCollection", features: [...data.fcs[portfolio].features, ...aiRows.map(squareFeature)] } : null), [data, portfolio, aiRows]);

  // ---------- live river node ----------
  const liveRp = mode === "live" && data && reading ? rpForStage(data.nd, reading.stage) : null;
  const liveScenario = useMemo(() => (mode === "live" && reading ? scenario(buildings, liveRp ?? 1) : null), [mode, reading, buildings, liveRp]);
  const live = mode === "live" && reading ? { stage: reading.stage, rp: liveRp, scenario: liveScenario } : null;
  const nodeState: NodeMarkerState = useMemo(() => {
    if (!data || !live) return { live: false, label: "", tone: "ok" };
    const a = alertFor(data.nd, live.stage);
    return { live: true, label: `${live.stage.toFixed(2)} m · ${a.label}`, tone: a.tone };
  }, [data, live?.stage]); // eslint-disable-line react-hooks/exhaustive-deps
  const waterRp = mode === "live" ? (liveRp ?? 1.5) : rp;

  const openReport = useCallback((tab: ReportTab = "summary") => setReport({ open: true, tab }), []);
  const s: ViewState = { rp, colourMode, showIssues, portfolio, playing, mode, liveRp };
  const a: ViewActions = useMemo(
    () => ({
      setRp: (r: RP) => {
        setPlaying(false);
        setMode("scenario");
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
      setMode: (m: Mode) => {
        setMode(m);
        setPlaying(false);
        if (m === "live") {
          setColourMode("damage");
          setCamera({ preset: "node", nonce: Date.now() });
        }
      },
      openReport,
    }),
    [openReport],
  );

  const panelBody = (compact: boolean) =>
    data && (
      <>
        <ModeTabs mode={mode} setMode={a.setMode} />
        <div className="mt-4">
          {mode === "scenario" ? (
            <Controls stats={data.stats} res={res} s={s} a={a} compact={compact} />
          ) : (
            <LivePanel nd={data.nd} reading={reading} onReading={setReading} scenario={liveScenario} trigger={trigger} onOpenReport={() => openReport("node")} />
          )}
        </div>
      </>
    );

  return (
    <div ref={root} className="relative h-dvh w-full overflow-hidden bg-[var(--ink)] text-slate-100">
      {data && mapFc && (
        <MapScene
          buildings={mapFc}
          places={data.places}
          waterRp={waterRp}
          live={mode === "live"}
          colourMode={colourMode}
          showIssues={showIssues}
          portfolio={portfolio}
          selectedId={selected?.id ?? null}
          camera={camera}
          nodeState={nodeState}
          theme={theme}
          onSelect={setSelected}
        />
      )}

      {!data && (
        <div className="absolute inset-0 grid place-items-center text-sm text-slate-400">
          {error ? `Could not load data: ${error}` : <span className="animate-pulse">Loading the Nzoia basin…</span>}
        </div>
      )}

      {data && (
        <>
          {/* left column: brand + mode + controls / live node (desktop) */}
          <div className="pointer-events-none absolute left-0 top-0 flex max-h-full w-full flex-col gap-3 p-3 sm:w-[372px] sm:p-4">
            <div className="pointer-events-auto pr-12 sm:pr-0">
              <Brand stats={data.stats} portfolio={portfolio} res={res} aiCount={aiRows.length} onReport={() => openReport("summary")} theme={theme} onToggleTheme={toggleTheme} />
            </div>
            <div className="glass panel scroll-thin pointer-events-auto hidden min-h-0 overflow-y-auto rounded-2xl p-4 lg:block">{panelBody(false)}</div>
          </div>

          {/* right column: insights (desktop) */}
          <div className="pointer-events-none absolute right-0 top-0 hidden max-h-[calc(100%-120px)] w-[340px] p-4 lg:flex">
            <div className="glass panel scroll-thin pointer-events-auto min-h-0 overflow-y-auto rounded-2xl p-4">
              <Insights res={res} s={s} a={a} />
            </div>
          </div>

          {/* building details */}
          {selected && (
            <div className="rise-in absolute inset-x-3 bottom-[226px] z-10 max-h-[46dvh] overflow-y-auto sm:left-auto sm:right-3 sm:w-[400px] lg:inset-x-auto lg:bottom-4 lg:left-[388px] lg:right-auto lg:max-h-[60dvh]">
              <BuildingCard b={selected} rp={rp} liveRp={live ? live.rp ?? 1 : null} onClose={() => setSelected(null)} />
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
              {panelBody(true)}
              <div className="mt-4 border-t border-white/10 pt-4">
                <Insights res={res} s={s} a={a} />
              </div>
              <Credit className="mt-4 text-center" />
            </div>
          </div>

          <Credit className="pointer-events-auto absolute bottom-2 left-1/2 hidden -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 backdrop-blur lg:block" />

          {report.open && (
            <Report
              tab={report.tab}
              theme={theme}
              onToggleTheme={toggleTheme}
              setTab={(tab) => setReport({ open: true, tab })}
              onClose={() => setReport((r) => ({ ...r, open: false }))}
              stats={data.stats}
              nd={data.nd}
              gazetteer={data.gazetteer}
              grid={data.grid}
              portfolio={portfolio}
              portfolioName={PORTFOLIO_NAME[portfolio]}
              baseBuildings={baseBuildings}
              buildings={buildings}
              res={res}
              baseRes={baseRes}
              aiRows={aiRows}
              addAiRows={(rows) => setAiRows((cur) => [...cur, ...rows])}
              removeAiRow={(id) => setAiRows((cur) => cur.filter((b) => b.id !== id))}
              trigger={trigger}
              setTrigger={setTrigger}
              live={live}
              onPickBuilding={(b) => {
                setReport((r) => ({ ...r, open: false }));
                setSelected(b);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
