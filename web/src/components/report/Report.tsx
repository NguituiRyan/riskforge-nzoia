import { useEffect } from "react";
import BrandMark from "../BrandMark";
import ThemeToggle from "../ThemeToggle";
import type { Theme } from "../../lib/theme";
import type { BuildingProps, Place, PortfolioView, Stats } from "../../lib/types";
import type { FloodGrid, PortfolioResult, ScenarioResult } from "../../lib/engine";
import type { NodeData, TriggerTerms } from "../../lib/node";
import type { ReportTab } from "../Panels";
import SummaryTab from "./SummaryTab";
import BuildingsTab from "./BuildingsTab";
import VulnerabilityTab from "./VulnerabilityTab";
import AiTab from "./AiTab";
import NodeTab from "./NodeTab";
import SourcesTab from "./SourcesTab";
import BenchmarkTab from "./BenchmarkTab";

export interface ReportProps {
  stats: Stats;
  nd: NodeData;
  gazetteer: Place[];
  grid: FloodGrid;
  portfolio: PortfolioView;
  portfolioName: string;
  baseBuildings: Record<PortfolioView, BuildingProps[]>;
  buildings: BuildingProps[];
  res: PortfolioResult;
  baseRes: PortfolioResult;
  aiRows: BuildingProps[];
  addAiRows: (rows: BuildingProps[]) => void;
  removeAiRow: (id: string) => void;
  trigger: TriggerTerms;
  setTrigger: (t: TriggerTerms) => void;
  live: { stage: number; rp: number | null; scenario: ScenarioResult | null } | null;
  onPickBuilding: (b: BuildingProps) => void;
}

const TABS: [ReportTab, string][] = [
  ["summary", "Summary"],
  ["benchmark", "vs global models"],
  ["buildings", "Buildings"],
  ["vulnerability", "Vulnerability"],
  ["ai", "AI analyst"],
  ["node", "River node"],
  ["sources", "Sources & assumptions"],
];

export default function Report({ tab, setTab, onClose, theme, onToggleTheme, ...p }: ReportProps & { tab: ReportTab; setTab: (t: ReportTab) => void; onClose: () => void; theme: Theme; onToggleTheme: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-center bg-black/55 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-label="Underwriter report">
      <div className="glass rise-in flex w-full max-w-[1240px] flex-col overflow-hidden sm:rounded-3xl">
        <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <BrandMark tone={theme === "light" ? "gradient" : "white"} className="h-8 w-8 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-display text-[18px] leading-tight">
              <span className="wordmark">Risk Forge</span> <span className="text-slate-400">· Underwriter report</span>
            </div>
            <div className="truncate text-[12px] text-slate-400">
              {p.portfolioName} · {p.res.count.toLocaleString("en-KE")} buildings{p.aiRows.length ? ` (${p.aiRows.length} AI-added)` : ""} · synthetic portfolio, real JRC flood hazard
            </div>
          </div>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-[13px] text-slate-300 hover:bg-white/10" aria-label="Close report">
            ✕ Close
          </button>
        </header>
        <nav className="scroll-thin flex gap-1 overflow-x-auto border-b border-white/10 px-3 py-2 sm:px-4">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] transition ${tab === id ? "bg-white/[0.12] text-white" : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {tab === "summary" && <SummaryTab {...p} />}
          {tab === "benchmark" && <BenchmarkTab {...p} />}
          {tab === "buildings" && <BuildingsTab {...p} />}
          {tab === "vulnerability" && <VulnerabilityTab />}
          {tab === "ai" && <AiTab {...p} />}
          {tab === "node" && <NodeTab {...p} />}
          {tab === "sources" && <SourcesTab {...p} />}
        </div>
      </div>
    </div>
  );
}
