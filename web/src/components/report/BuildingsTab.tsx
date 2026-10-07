import { useMemo, useState } from "react";
import { Card, td, th, tr } from "./ui";
import type { ReportProps } from "./Report";
import type { HousingClass, RP } from "../../lib/types";
import { CLASSES, RPS } from "../../lib/types";
import { buildingAt, severity } from "../../lib/engine";
import { download, toCsv } from "../../lib/report";
import { CLASS_COLOUR, CLASS_LABEL, WHERE_LABEL, kes } from "../../lib/format";

type SortKey = "aal" | "loss" | "tiv" | "depth";
const PAGE = 50;

export default function BuildingsTab({ buildings, res, portfolio, onPickBuilding }: ReportProps) {
  const [rp, setRp] = useState<RP>(100);
  const [q, setQ] = useState("");
  const [cls, setCls] = useState<HousingClass | "all">("all");
  const [floodedOnly, setFloodedOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("aal");
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return buildings
      .map((b) => ({ b, at: buildingAt(b, rp), aal: res.perBuildingAal.get(b.id) ?? 0 }))
      .filter(({ b, at }) => (cls === "all" || b.cls === cls) && (!floodedOnly || at.depth > 0) && (!needle || b.id.toLowerCase().includes(needle) || (b.settlement ?? "").toLowerCase().includes(needle)))
      .sort((x, y) => (sort === "aal" ? y.aal - x.aal : sort === "loss" ? y.at.loss - x.at.loss : sort === "tiv" ? y.b.tiv - x.b.tiv : y.at.depth - x.at.depth));
  }, [buildings, res, rp, q, cls, floodedOnly, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice(page * PAGE, page * PAGE + PAGE);
  const totals = rows.reduce((s, r) => ({ tiv: s.tiv + r.b.tiv, loss: s.loss + r.at.loss, aal: s.aal + r.aal }), { tiv: 0, loss: 0, aal: 0 });

  return (
    <Card
      title="All buildings"
      hint={
        <button onClick={() => download(`riskforge_${portfolio}_buildings.csv`, toCsv(buildings, res))} className="rounded-lg bg-sky-400 px-3 py-1.5 text-[12px] font-semibold text-slate-950">
          Download CSV (all {buildings.length.toLocaleString("en-KE")} rows, every return period)
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          placeholder="Search ID or settlement"
          className="w-44 rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-slate-100 placeholder:text-slate-500"
        />
        <select value={cls} onChange={(e) => (setCls(e.target.value as HousingClass | "all"), setPage(0))} className="rounded-lg bg-white/[0.06] px-2 py-1.5 text-slate-100">
          <option value="all">All classes</option>
          {CLASSES.map((c) => (
            <option key={c} value={c}>
              {CLASS_LABEL[c]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-slate-300">
          <input type="checkbox" checked={floodedOnly} onChange={(e) => (setFloodedOnly(e.target.checked), setPage(0))} className="accent-sky-400" />
          Flooded at 1-in-{rp}
        </label>
        <span className="text-slate-500">Return period:</span>
        {RPS.map((r) => (
          <button key={r} onClick={() => setRp(r)} className={`rounded-md px-2 py-1 ${r === rp ? "bg-sky-400 text-slate-950" : "bg-white/[0.05] text-slate-300"}`}>
            {r}
          </button>
        ))}
        <span className="ml-auto text-slate-500">Sort:</span>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-lg bg-white/[0.06] px-2 py-1.5 text-slate-100">
          <option value="aal">Average annual loss</option>
          <option value="loss">Loss at 1-in-{rp}</option>
          <option value="tiv">Insured value</option>
          <option value="depth">Depth at 1-in-{rp}</option>
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-[12px]">
          <thead>
            <tr>
              <th className={th}>Building</th>
              <th className={th}>Class</th>
              <th className={th}>Near</th>
              <th className={`${th} text-right`}>Value</th>
              <th className={`${th} text-right`}>Depth</th>
              <th className={`${th} text-right`}>Severity</th>
              <th className={`${th} text-right`}>Damage</th>
              <th className={`${th} text-right`}>Loss 1-in-{rp}</th>
              <th className={`${th} text-right`}>AAL</th>
              <th className={th}>Data</th>
            </tr>
          </thead>
          <tbody>
            {view.map(({ b, at, aal }) => (
              <tr key={b.id} onClick={() => onPickBuilding(b)} className={`${tr} cursor-pointer text-slate-200 hover:bg-white/[0.04]`}>
                <td className={td}>{b.id}</td>
                <td className={td}>
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ background: CLASS_COLOUR[b.cls] }} />
                  {CLASS_LABEL[b.cls]}
                </td>
                <td className={td}>{b.settlement && b.settlement !== "other" ? b.settlement : "—"}</td>
                <td className={`${td} text-right`}>{kes(b.tiv)}</td>
                <td className={`${td} text-right`}>{at.depth > 0 ? `${at.depth.toFixed(2)} m` : "dry"}</td>
                <td className={`${td} text-right`}>{severity(at.depth).toFixed(2)}</td>
                <td className={`${td} text-right`}>{(at.dr * 100).toFixed(0)}%</td>
                <td className={`${td} text-right`}>{kes(at.loss)}</td>
                <td className={`${td} text-right text-amber-200`}>{kes(aal)}</td>
                <td className={td}>
                  {b.src === "ai" ? <span className="chip chip-ai">AI · {Math.round((b.confidence ?? 0) * 100)}%</span> : <span className="chip chip-synthetic">synthetic</span>}
                  {b.where !== "KE" && <span className="ml-1 text-rose-300" title={WHERE_LABEL[b.where]}>⚠ {b.where === "UG" ? "Uganda" : "lake"}</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/15 text-slate-300">
              <td className={td} colSpan={3}>
                {rows.length.toLocaleString("en-KE")} buildings shown
              </td>
              <td className={`${td} text-right`}>{kes(totals.tiv)}</td>
              <td colSpan={3} />
              <td className={`${td} text-right`}>{kes(totals.loss)}</td>
              <td className={`${td} text-right`}>{kes(totals.aal)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-[12px] text-slate-400">
        <span>
          Page {page + 1} of {pages}
        </span>
        <div className="flex gap-1">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded-md bg-white/[0.06] px-2.5 py-1 disabled:opacity-40">
            ‹ Prev
          </button>
          <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="rounded-md bg-white/[0.06] px-2.5 py-1 disabled:opacity-40">
            Next ›
          </button>
        </div>
      </div>
    </Card>
  );
}
