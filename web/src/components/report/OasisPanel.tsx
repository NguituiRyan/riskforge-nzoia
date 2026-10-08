import { useEffect, useRef, useState } from "react";
import type { BuildingProps } from "../../lib/types";
import type { Programme, ProgrammeResult } from "../../lib/terms";
import { gap, OASIS_URL, runOasis, sameProgramme, type OasisResult } from "../../lib/oasis";
import { kes } from "../../lib/format";

const ROWS = [10, 20, 50, 100, 200, 250, 500];
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

/**
 * The loss calculation as Oasis LMF returns it: ground-up -> owner -> gross -> reinsurer -> net, per flood and on
 * average, beside the instant in-browser preview it reconciles to. A precomputed run is shown while its terms match;
 * "Run on Oasis LMF" sends the portfolio to the Oasis worker.
 */
export default function OasisPanel({
  name,
  buildings,
  programme,
  preview,
  precomputed,
  reinsurerName = "Reinsurer",
}: {
  name: string;
  buildings: BuildingProps[];
  programme: Programme;
  /** the in-browser engine's figures for the same portfolio and terms */
  preview: ProgrammeResult;
  precomputed?: OasisResult | null;
  reinsurerName?: string;
}) {
  const [live, setLive] = useState<OasisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [t0, setT0] = useState(0);
  const [tick, setTick] = useState(0);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setTick(Date.now()), 500);
    return () => clearInterval(id);
  }, [busy]);

  // a result stands only for the terms and portfolio it was run with
  const candidates = [live, precomputed].filter((r): r is OasisResult => !!r);
  const result = candidates.find((r) => sameProgramme(r.programme, programme) && r.run.locations === buildings.filter((b) => (typeof b.w === "number" ? b.w : 1) > 0).length) ?? null;
  const stale = !result && candidates.length > 0;

  async function go() {
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy(true);
    setErr(null);
    const now = Date.now();
    setT0(now);
    setTick(now);
    try {
      setLive(await runOasis(name, buildings, programme, abort.current.signal));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-violet-300/25 bg-violet-300/[0.04] p-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-[15px] text-slate-50">Loss calculation · Oasis LMF</span>
          <span className="rounded-full bg-violet-300/15 px-2 py-0.5 text-[11px] text-violet-100 ring-1 ring-violet-300/30">{result ? result.engine : "open-source industry framework"}</span>
        </div>
        <button onClick={go} disabled={busy} className="rounded-lg bg-violet-400/20 px-3 py-1.5 text-[12px] font-medium text-violet-50 ring-1 ring-violet-300/40 hover:bg-violet-400/30 disabled:opacity-60">
          {busy ? `Oasis is running… ${Math.max(0, Math.round((tick - t0) / 1000))} s` : result ? "Run again on Oasis LMF" : stale ? "Re-run on Oasis LMF for these terms" : "Run on Oasis LMF"}
        </button>
      </div>

      {err && (
        <div className="mt-2 rounded-lg bg-rose-500/15 px-3 py-2 text-[12px] text-rose-100">
          {err}
          <div className="mt-1 text-rose-200/80">
            The runner is <code>oasis/server.py</code> on a Linux machine with oasislmf (WSL on this laptop). The page looks for it at <code>{OASIS_URL}</code>.
          </div>
        </div>
      )}

      {result ? (
        <>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-[12px]">
              <thead className="text-slate-400">
                <tr>
                  <th className="py-1 text-left font-medium">Flood</th>
                  <th className="text-right font-medium">Ground-up</th>
                  <th className="text-right font-medium">Owner</th>
                  <th className="text-right font-medium">Gross</th>
                  <th className="text-right font-medium">{reinsurerName}</th>
                  <th className="text-right font-medium">Net</th>
                  <th className="text-right font-medium" title="instant in-browser preview vs Oasis, on the gross loss">Preview Δ</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {ROWS.map((r) => {
                  const o = result.byRp[String(r)];
                  const e = preview.byRp[r];
                  if (!o) return null;
                  return (
                    <tr key={r} className="border-t border-white/5 text-slate-200">
                      <td className="py-1">1-in-{r}</td>
                      <td className="text-right">{kes(o.gu)}</td>
                      <td className="text-right text-rose-200/90">{kes(o.owner)}</td>
                      <td className="text-right">{kes(o.gross)}</td>
                      <td className="text-right text-amber-200">{kes(o.reinsurer)}</td>
                      <td className="text-right">{kes(o.net)}</td>
                      <td className="text-right text-slate-400">{e ? pct(gap(o.gross, e.gross)) : "—"}</td>
                    </tr>
                  );
                })}
                <tr className="border-t border-white/15 font-medium text-slate-50">
                  <td className="py-1">Average a year</td>
                  <td className="text-right">{kes(result.aal.gu)}</td>
                  <td className="text-right text-rose-200/90">{kes(result.aal.gu - result.aal.gross)}</td>
                  <td className="text-right">{kes(result.aal.gross)}</td>
                  <td className="text-right text-amber-200">{kes(result.aal.reinsurer)}</td>
                  <td className="text-right">{kes(result.aal.net)}</td>
                  <td className="text-right text-slate-400">{pct(gap(result.aal.gross, preview.aal.gross))}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-2 space-y-0.5 text-[12px] text-slate-400">
            <div>
              Oasis ran {result.run.locations.toLocaleString("en-KE")} OED locations, {result.run.accounts.toLocaleString("en-KE")} policies{result.run.reinsurance.length ? ` and ${result.run.reinsurance.join(" + ")} reinsurance` : ""} over {result.run.events.toLocaleString("en-KE")} flood events ({result.run.periods.toLocaleString("en-KE")}-year stratified event set) on {result.run.areaPerils.toLocaleString("en-KE")} area perils with {result.run.vulnerabilities} vulnerability functions, in {result.seconds} s.
            </div>
            <div>"Preview Δ" is the instant in-browser engine against Oasis. Both use the same hazard, curves and terms; the small differences come from Oasis's 1 cm depth and 0.1% damage bins.</div>
          </div>
        </>
      ) : (
        <div className="mt-2 text-[12px] text-slate-400">
          {stale
            ? "The Oasis run shown before was for different terms or buildings. The figures above are the instant in-browser preview; run Oasis for these terms."
            : "The figures above are the instant in-browser preview. Oasis LMF computes the authoritative ground-up, insured and reinsured losses from OED exposure, an Oasis model built from the JRC flood maps, and the treaty as OED reinsurance."}
        </div>
      )}
    </div>
  );
}
