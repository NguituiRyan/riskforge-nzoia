import { useEffect, useMemo, useState } from "react";
import { Badge, Card } from "./ui";
import type { ReportProps } from "./Report";
import FinancialTerms from "./FinancialTerms";
import { RPS, type RP } from "../../lib/types";
import { buildingAt, depthAtRp, KEY_RPS } from "../../lib/engine";
import { readDocument, redactPersonal, type DocText, type Redaction } from "../../lib/docText";
import { offerCsv, runOffer, verifyFacts, type FactCheck, type OfferExtract, type OfferRun } from "../../lib/offer";
import { download } from "../../lib/report";
import { CLASS_LABEL, CLASS_UI, kes } from "../../lib/format";
import { asPlace, growthAt, loadKenyaPlaces, placeCandidates } from "../../lib/kenya";
import type { Place } from "../../lib/types";

interface ExtractResponse {
  offer: OfferExtract;
  model: string;
  usage: { input: number; output: number };
}

const CURVE_RPS = [2, 2.5, 3, 4, 5, 7, 10, 20, 50, 100, 200, 500];
/** what the AI is writing, streamed from /api/offer while it reads */
interface Progress {
  section: string;
  insured?: string | null;
  place?: string | null;
  buildings?: number;
  contents?: number;
  floods?: number;
  terms?: boolean;
  facts?: number;
}
/** fictional sample offers (samples/make_offers.py): one the model approves, one it declines */
const SAMPLES = [
  { file: "approve_mukhobola_dairy.pdf", label: "Dairy on raised floors", tone: "text-emerald-200 ring-emerald-400/30 hover:bg-emerald-400/10" },
  { file: "decline_rugunga_rice_mill.pdf", label: "Rice mill in the flood plain", tone: "text-rose-200 ring-rose-400/30 hover:bg-rose-400/10" },
];

/** the engine stages shown one by one once the AI has answered */
const PIPE = 6;
const VERDICT_TONE: Record<OfferRun["decision"]["verdict"], string> = {
  APPROVE: "bg-emerald-400/15 text-emerald-200 ring-emerald-400/40",
  "APPROVE WITH CONDITIONS": "bg-amber-300/15 text-amber-100 ring-amber-300/40",
  "DECLINE AT OFFERED TERMS": "bg-rose-500/15 text-rose-100 ring-rose-400/40",
  REFER: "bg-white/[0.06] text-slate-200 ring-white/15",
};

/**
 * Upload a broker's offer (PDF / Word) -> Risk Forge AI extracts the risk -> the CAT model runs every stage on it ->
 * a decision the underwriter can approve (the buildings join the map) or decline. Visual first; numbers on hover.
 */
export default function OfferPanel(p: ReportProps) {
  const { gazetteer, grid, stats, baseBuildings, portfolio, aiRows, addAiRows, kenya } = p;
  // places offered to the AI for this document: the Nzoia gazetteer plus Kenyan places named in it
  const [lookup, setLookup] = useState<Place[]>(gazetteer);
  const [doc, setDoc] = useState<{ file: DocText; red: Redaction } | null>(null);
  const [busy, setBusy] = useState<"read" | "ai" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [extract, setExtract] = useState<ExtractResponse | null>(null);
  const [hazardSource, setHazardSource] = useState<"auto" | "jrc" | "site">("auto");
  const [calibrate, setCalibrate] = useState(true);
  const [decided, setDecided] = useState<"approved" | "declined" | null>(null);
  const [showText, setShowText] = useState(false);
  const [pages, setPages] = useState<{ done: number; total: number } | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [tick, setTick] = useState(0);
  const [aiSeconds, setAiSeconds] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(PIPE);
  const batch = 1 + Math.max(0, ...aiRows.map((b) => Number(b.batch) || 0));

  const run = useMemo(() => {
    if (!extract) return null;
    try {
      return runOffer(extract.offer, { gazetteer: lookup, grid, growth: (lon, lat) => growthAt(kenya, stats.depthGrowth, lon, lat), hazardSource, calibrate, batch, book: baseBuildings[portfolio] });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [extract, lookup, grid, kenya, stats.depthGrowth, hazardSource, calibrate, batch, baseBuildings, portfolio]);
  const checks = useMemo(() => (extract && doc ? verifyFacts(extract.offer, doc.red.text) : []), [extract, doc]);

  // a clock for the AI step, and the engine stages revealed one at a time after it answers
  useEffect(() => {
    if (busy !== "ai") return;
    const id = setInterval(() => setTick(Date.now()), 500);
    return () => clearInterval(id);
  }, [busy]);
  useEffect(() => {
    if (revealed >= PIPE) return;
    const id = setTimeout(() => setRevealed((r) => r + 1), 320);
    return () => clearTimeout(id);
  }, [revealed]);

  async function onFile(f: File) {
    setErr(null);
    setExtract(null);
    setDecided(null);
    setBusy("read");
    setProgress(null);
    setAiSeconds(null);
    setPages(null);
    try {
      const file = await readDocument(f, (done, total) => setPages({ done, total }));
      setDoc({ file, red: redactPersonal(file.text) });
    } catch (e) {
      setDoc(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function trySample(name: string) {
    try {
      const res = await fetch(`/samples/${name}`);
      if (!res.ok) throw new Error(`Could not load the sample (HTTP ${res.status})`);
      await onFile(new File([await res.blob()], name, { type: "application/pdf" }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function analyse() {
    if (!doc) return;
    setBusy("ai");
    setErr(null);
    setDecided(null);
    setExtract(null);
    setAiSeconds(null);
    setProgress({ section: "sending" });
    const t0 = Date.now();
    setStartedAt(t0);
    setTick(t0);
    try {
      const kp = await loadKenyaPlaces().catch(() => []);
      const places = [...gazetteer, ...placeCandidates(doc.red.text, kp, 120).map(asPlace)];
      setLookup(places);
      const res = await fetch("/api/offer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: doc.red.text, gazetteer: places.map((g) => g.name) }) });
      if (!res.ok || !res.body || !res.headers.get("content-type")?.includes("ndjson")) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const result = await readStream(res, setProgress);
      setAiSeconds((Date.now() - t0) / 1000);
      setRevealed(0);
      setExtract(result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card title="Offer document → CAT model" hint={<span>PDF or Word · the file stays on this device · <Badge kind="ai" /></span>}>
        <div className="grid gap-3 lg:grid-cols-5">
          <label
            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/20 bg-white/[0.02] px-4 py-5 text-center hover:border-brand-300/60 lg:col-span-2"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void onFile(f);
            }}
          >
            <span className="text-2xl" aria-hidden>
              📄
            </span>
            <span className="text-[13px] text-slate-200">{busy === "read" ? "Reading…" : "Drop a broker offer, or choose a file"}</span>
            <span className="text-[11px] text-slate-500">.pdf · .docx · .doc · .txt</span>
            <span className="mt-2 flex flex-wrap justify-center gap-1.5 text-[11px]" onClick={(e) => e.preventDefault()}>
              <span className="text-slate-500">or try a sample:</span>
              {SAMPLES.map((x) => (
                <button key={x.file} type="button" disabled={busy !== null} onClick={() => void trySample(x.file)} className={`rounded-full px-2 py-0.5 ring-1 ${x.tone} disabled:opacity-50`}>
                  {x.label}
                </button>
              ))}
            </span>
            <input
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void onFile(f);
              }}
            />
          </label>
          <div className="space-y-2 lg:col-span-3">
            {doc ? (
              <>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className="chip chip-real">
                    {doc.file.name} · {doc.file.pages ? `${doc.file.pages} pages · ` : ""}
                    {doc.file.text.length.toLocaleString("en-KE")} characters
                  </span>
                  <span className="chip chip-ai" title="Removed in your browser before anything is sent to the AI">
                    🔒 redacted: {doc.red.counts.names} names · {doc.red.counts.phones} phones · {doc.red.counts.emails} emails
                  </span>
                  <button onClick={() => setShowText((v) => !v)} className="text-slate-400 underline-offset-2 hover:underline">
                    {showText ? "hide" : "view"} what the AI sees
                  </button>
                </div>
                {showText && <pre className="scroll-thin max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 text-[11px] text-slate-400">{doc.red.text}</pre>}
                <button onClick={analyse} disabled={busy !== null} className="w-full rounded-lg bg-brand px-3 py-2 text-[13px] font-semibold text-on-brand disabled:opacity-60">
                  {busy === "ai" ? "Risk Forge AI is reading the document…" : extract ? "Read it again" : "Run the CAT model on this offer"}
                </button>
              </>
            ) : (
              <div className="text-[12px] text-slate-500">Personal names, phone numbers and emails are removed in your browser before the AI sees the text. Nothing is stored.</div>
            )}
            <Activity
              doc={doc}
              reading={busy === "read" ? pages ?? { done: 0, total: 0 } : null}
              ai={busy === "ai" ? { progress, seconds: Math.max(0, Math.round((tick - startedAt) / 1000)) } : null}
              aiSeconds={aiSeconds}
              extract={extract}
              run={run}
              checks={checks}
              revealed={revealed}
            />
          </div>
        </div>
        {err && <div className="mt-2 rounded-lg bg-rose-500/15 px-3 py-2 text-[13px] text-rose-200">{err}</div>}
        {typeof run === "string" && <div className="mt-2 rounded-lg bg-rose-500/15 px-3 py-2 text-[13px] text-rose-200">{run}</div>}
      </Card>

      {run && typeof run !== "string" && extract && revealed >= PIPE && (
        <>
          <DecisionBanner
            run={run}
            checks={checks}
            decided={decided}
            onApprove={() => {
              setDecided("approved");
              addAiRows(run.buildings);
            }}
            onDecline={() => setDecided("declined")}
            onReport={() => download(`riskforge_${run.id}_decision.md`, offerReport(run, checks, extract), "text/markdown")}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="1 · Extraction" hint={`${checks.filter((c) => c.found && c.matches).length} of ${checks.length} figures quoted from the document`}>
              <Extraction run={run} checks={checks} offer={extract.offer} tokens={extract.usage.input + extract.usage.output} />
            </Card>
            <Card title="2 · Hazard" hint="flood depth at the site, by rarity">
              <HazardChart run={run} />
              <Toggle
                value={hazardSource}
                options={[
                  ["auto", "Auto"],
                  ["jrc", "JRC map"],
                  ["site", "Site history"],
                ]}
                onChange={(v) => setHazardSource(v as typeof hazardSource)}
                disabled={!run.hazard.site}
              />
            </Card>
            <Card title="3 · Vulnerability" hint="damage curves, checked against the site's claims">
              <Vulnerability run={run} />
              <label className="mt-2 flex items-center gap-2 text-[12px] text-slate-300">
                <input type="checkbox" checked={calibrate} onChange={(e) => setCalibrate(e.target.checked)} className="accent-brand" disabled={run.vuln.events.length < 2} />
                Calibrate to the site's claims
              </label>
            </Card>
            <Card title="4 · Exposure" hint="what is insured where">
              <Exposure run={run} offer={extract.offer} />
            </Card>
            <Card title="5 · Financial engine" hint={`ground-up → ${kes(run.programme.deductible)} deductible → ${run.programme.limit ? kes(run.programme.limit) : "no"} limit → Kenya Re ${Math.round(run.programme.qs * 100)}%`} className="lg:col-span-2">
              <FinancialTerms programme={run.programme} result={run.financial} reinsurerName={`Kenya Re ${Math.round(run.programme.qs * 100)}%`} />
              {run.experience.aal !== null && (
                <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
                  <Mini label="Model AAL, ground-up" value={kes(run.financial.aal.gu)} />
                  <Mini label="Claims history AAL" value={kes(run.experience.aal)} />
                  <Mini label="Model AAL, Kenya Re" value={kes(run.financial.aal.reinsurer)} />
                  <Mini label="History, Kenya Re's share" value={run.experience.toReinsurer !== null ? kes(run.experience.toReinsurer) : "—"} />
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/** read the NDJSON stream from /api/offer: progress lines while the model writes, then the result */
async function readStream(res: Response, onProgress: (p: Progress) => void): Promise<ExtractResponse> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += value;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as { type: string; error?: string } & Progress & ExtractResponse;
      if (msg.type === "progress") onProgress(msg);
      else if (msg.type === "result") return msg;
      else if (msg.type === "error") throw new Error(msg.error ?? "The AI request failed");
    }
    if (done) break;
  }
  throw new Error("The connection closed before the AI finished; try again.");
}

const SECTION_LABEL: Record<string, string> = {
  sending: "sending the redacted text",
  start: "starting to read",
  thinking: "thinking about the document",
  insured: "finding the insured",
  site: "locating the site",
  sum_insured_kes: "reading the sum insured",
  buildings: "listing the buildings",
  contents: "listing stock and machinery",
  flood_history: "reading the flood history",
  terms: "reading the policy terms",
  conditions: "reading the conditions",
  facts: "quoting the source of every figure",
  data_gaps: "noting what the document leaves out",
  warnings: "noting anything odd",
};

type RowState = "done" | "active" | "todo" | "error";
interface Row {
  label: string;
  detail?: React.ReactNode;
  state: RowState;
}

/** a running log of what the model is doing: reading, redacting, the AI's extraction live, then each engine stage */
function Activity({
  doc,
  reading,
  ai,
  aiSeconds,
  extract,
  run,
  checks,
  revealed,
}: {
  doc: { file: DocText; red: Redaction } | null;
  reading: { done: number; total: number } | null;
  ai: { progress: Progress | null; seconds: number } | null;
  aiSeconds: number | null;
  extract: ExtractResponse | null;
  run: OfferRun | string | null;
  checks: FactCheck[];
  revealed: number;
}) {
  const rows: Row[] = [];
  // 1-2 · the document, on this device
  if (reading) rows.push({ label: "Reading the document", detail: reading.total ? `page ${reading.done} of ${reading.total}` : "opening…", state: "active" });
  else if (doc)
    rows.push({ label: `Read ${doc.file.pages ? `${doc.file.pages} pages` : doc.file.kind.toUpperCase()}`, detail: `${doc.file.text.length.toLocaleString("en-KE")} characters, on this device`, state: "done" });
  else rows.push({ label: "Read the document", state: "todo" });
  rows.push(
    doc
      ? { label: "Removed personal details", detail: `${doc.red.counts.names} names · ${doc.red.counts.phones} phones · ${doc.red.counts.emails} emails`, state: "done" }
      : { label: "Remove personal details", state: "todo" },
  );

  // 3 · the AI, live
  if (ai) {
    const p = ai.progress;
    rows.push({
      label: `Risk Forge AI is ${SECTION_LABEL[p?.section ?? "sending"] ?? "reading"} · ${ai.seconds} s`,
      detail: p && (
        <span className="flex flex-wrap gap-1">
          {p.insured && <Tag>insured ✓</Tag>}
          {p.place && <Tag>site: {p.place}</Tag>}
          {!!p.buildings && <Tag>{p.buildings} buildings</Tag>}
          {!!p.contents && <Tag>{p.contents} contents</Tag>}
          {!!p.floods && <Tag>{p.floods} past floods</Tag>}
          {p.terms && <Tag>terms ✓</Tag>}
          {!!p.facts && <Tag>{p.facts} figures quoted</Tag>}
        </span>
      ),
      state: "active",
    });
  } else if (extract) {
    const x = extract.offer;
    rows.push({
      label: `Risk Forge AI extracted the risk${aiSeconds ? ` · ${Math.round(aiSeconds)} s` : ""}`,
      detail: `${x.buildings.length} buildings · ${x.contents.length} contents · ${x.flood_history.length} past floods · ${x.facts.length} figures quoted`,
      state: "done",
    });
  } else rows.push({ label: "Risk Forge AI extracts the risk", state: "todo" });

  // 4-9 · the engine, one stage at a time
  const r = typeof run === "object" ? run : null;
  const verified = checks.filter((c) => c.found && c.matches).length;
  const stages: [string, React.ReactNode][] = r
    ? [
        ["Checked every figure against the document", `${verified} of ${checks.length} found word for word`],
        [
          "Hazard",
          r.hazard.source === "site"
            ? `JRC map is dry here, so depths come from the site's ${r.hazard.events.length} reported floods · ${r.hazard.site?.[100]?.toFixed(2) ?? "–"} m at 1-in-100`
            : `JRC map · ${r.hazard.jrc[100].toFixed(2)} m of water at 1-in-100`,
        ],
        ["Vulnerability", r.vuln.applied ? `damage curves scaled ×${r.vuln.factor.toFixed(2)} to ${r.vuln.events.length} claims${r.vuln.r2 !== null ? ` (fit R² ${r.vuln.r2.toFixed(2)})` : ""}` : "standard damage curves for each building class"],
        ["Exposure", `${r.buildings.length} buildings · ${kes(r.financial.value)} insured`],
        ["Financial engine", `average loss ${kes(r.financial.aal.gu)} a year · Kenya Re's technical premium ${kes(r.decision.technical)}`],
        ["Decision", r.decision.verdict],
      ]
    : [];
  const names = ["Check every figure", "Hazard", "Vulnerability", "Exposure", "Financial engine", "Decision"];
  names.forEach((n, i) => {
    if (typeof run === "string" && i === 1) rows.push({ label: n, detail: run, state: "error" });
    else if (r && i < revealed) rows.push({ label: stages[i][0], detail: stages[i][1], state: "done" });
    else if (r && i === revealed) rows.push({ label: `${n}…`, state: "active" });
    else rows.push({ label: n, state: "todo" });
  });

  return (
    <ol className="space-y-1 rounded-xl bg-white/[0.03] p-2.5 text-[12px]" aria-live="polite">
      {rows.map((row, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-[1px] w-4 shrink-0 text-center">
            {row.state === "done" ? (
              <span className="text-emerald-300">✓</span>
            ) : row.state === "active" ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand-300 border-t-transparent align-[-2px]" />
            ) : row.state === "error" ? (
              <span className="text-rose-300">✗</span>
            ) : (
              <span className="text-slate-600">·</span>
            )}
          </span>
          <span className="min-w-0">
            <span className={row.state === "todo" ? "text-slate-500" : row.state === "active" ? "text-slate-50" : "text-slate-200"}>{row.label}</span>
            {row.detail && <span className="block text-[11px] text-slate-400">{row.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-brand-400/15 px-2 py-[1px] text-[11px] text-brand-100">{children}</span>;
}

function DecisionBanner({ run, checks, decided, onApprove, onDecline, onReport }: { run: OfferRun; checks: FactCheck[]; decided: "approved" | "declined" | null; onApprove: () => void; onDecline: () => void; onReport: () => void }) {
  const d = run.decision;
  const verified = checks.filter((c) => c.found && c.matches).length;
  const icon = { good: "✓", bad: "✗", warn: "!" } as const;
  const tone = { good: "text-emerald-300", bad: "text-rose-300", warn: "text-amber-300" } as const;
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-3 py-1 font-display text-[15px] ring-1 ${VERDICT_TONE[d.verdict]}`}>{d.verdict}</span>
        <span className="font-display text-[17px] text-slate-50">{run.insured}</span>
        <span className="text-[12px] text-slate-400">
          {d.offered !== null ? `offered ${kes(d.offered)} · technical ${kes(d.technical)}` : `technical ${kes(d.technical)}`} · {verified}/{checks.length} figures verified
        </span>
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <ul className="space-y-1 text-[13px] text-slate-200">
          {d.reasons.map((r, i) => (
            <li key={i} className="flex gap-2">
              <span className={`w-3 shrink-0 font-bold ${tone[r.tone]}`}>{icon[r.tone]}</span>
              <span>{r.text}</span>
            </li>
          ))}
        </ul>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Conditions</div>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[12px] text-slate-300">
            {d.conditions.slice(0, 7).map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {decided ? (
          <span className={`rounded-lg px-3 py-1.5 text-[13px] ${decided === "approved" ? "bg-emerald-400/15 text-emerald-200" : "bg-rose-500/15 text-rose-200"}`}>
            {decided === "approved" ? `Approved · ${run.buildings.length} buildings added to the map` : "Declined · nothing added"}
          </span>
        ) : (
          <>
            <button onClick={onApprove} className="rounded-lg bg-brand px-4 py-2 text-[13px] font-semibold text-on-brand">
              {d.verdict === "APPROVE" ? "Approve" : "Approve with conditions"} · add to the map
            </button>
            <button onClick={onDecline} className="rounded-lg bg-white/[0.06] px-4 py-2 text-[13px] text-slate-200 hover:bg-white/10">
              Decline
            </button>
          </>
        )}
        <button onClick={onReport} className="ml-auto rounded-lg bg-white/[0.06] px-3 py-2 text-[12px] text-slate-300 hover:bg-white/10">
          Download decision report
        </button>
      </div>
    </section>
  );
}

const FIELD_LABEL: Record<string, string> = {
  sum_insured_kes: "Sum insured",
  "site.lat": "Latitude",
  "site.lon": "Longitude",
  "terms.flood_deductible_kes": "Flood deductible",
  "terms.flood_limit_kes": "Flood limit",
  "terms.reinsurer_share_pct": "Kenya Re share %",
  "terms.flood_premium_kes": "Flood premium",
  "terms.retention_max_kes": "Max retention",
  record_years: "Years of history",
};
const PART: Record<string, string> = { floor_area_m2: "area m²", floor_height_m: "floor raised m", value_kes: "value", loss_kes: "loss", depth_m: "depth m" };
/** "buildings[4].floor_height_m" -> "Office building · floor raised m" */
function fieldLabel(f: string, x: OfferExtract): string {
  if (FIELD_LABEL[f]) return FIELD_LABEL[f];
  const m = f.match(/^(buildings|contents|flood_history)[.[](\d+)\]?\.?(\w+)$/);
  if (m) {
    const i = Number(m[2]);
    const who = m[1] === "buildings" ? x.buildings[i]?.name : m[1] === "contents" ? x.contents[i]?.name : `${x.flood_history[i]?.year ?? ""} flood`;
    return `${who ?? m[1]} · ${PART[m[3]] ?? m[3].replace(/_/g, " ")}`;
  }
  return f.replace(/_kes|_m2|_m\b|_pct/g, "").replace(/[._[\]]+/g, " ").trim();
}
const fmtVal = (f: string, v: number) => (/kes|premium|limit|deductible|value|loss|sum/i.test(f) && v >= 1000 ? kes(v) : v.toLocaleString("en-KE", { maximumFractionDigits: 4 }));

function Extraction({ run, checks, offer, tokens }: { run: OfferRun; checks: FactCheck[]; offer: OfferExtract; tokens: number }) {
  return (
    <div className="space-y-2">
      <div className="scroll-thin max-h-48 overflow-y-auto">
        <table className="w-full text-[12px]">
          <tbody>
            {checks.map((c, i) => (
              <tr key={i} className="border-t border-white/[0.05]" title={`"${c.quote}"`}>
                <td className={`w-5 py-0.5 ${c.found && c.matches ? "text-emerald-300" : "text-amber-300"}`}>{c.found && c.matches ? "✓" : "⚠"}</td>
                <td className="py-0.5 text-slate-400">{fieldLabel(c.field, offer)}</td>
                <td className="py-0.5 text-right tabular-nums text-slate-100">{fmtVal(c.field, c.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(offer.warnings.length > 0 || offer.data_gaps.length > 0) && (
        <details className="group text-[11px]">
          <summary className="cursor-pointer list-none text-amber-200/90 hover:text-amber-100">
            <span className="inline-block transition group-open:rotate-90">›</span> {offer.warnings.length} issues in the document · {offer.data_gaps.length} data gaps
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-400">
            {offer.warnings.map((w, i) => (
              <li key={`w${i}`}>{w}</li>
            ))}
            {offer.data_gaps.map((g, i) => (
              <li key={`g${i}`} className="text-violet-300/80">
                gap: {g}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>
          Risk Forge AI · {tokens.toLocaleString("en-KE")} tokens · hover a row for its quote
        </span>
        <button onClick={() => download(`riskforge_${run.id}_exposure.csv`, offerCsv(run))} className="rounded-md bg-white/[0.06] px-2 py-1 text-slate-300 hover:bg-white/10">
          CSV ({run.rows.length} rows)
        </button>
      </div>
    </div>
  );
}

/** depth vs return period at the site: the JRC map, the site's own reported floods, and the curve the model uses */
function HazardChart({ run }: { run: OfferRun }) {
  const h = run.hazard;
  const W = 300;
  const H = 150;
  const pad = { l: 30, r: 8, t: 10, b: 22 };
  const lo = Math.log10(2);
  const hi = Math.log10(500);
  const x = (r: number) => pad.l + ((Math.log10(Math.min(Math.max(r, 2), 500)) - lo) / (hi - lo)) * (W - pad.l - pad.r);
  const maxD = Math.max(1, ...RPS.map((r) => Math.max(h.jrc[r], h.site?.[r] ?? 0)), ...h.events.map((e) => e.depth)) * 1.15;
  const y = (d: number) => H - pad.b - (d / maxD) * (H - pad.t - pad.b);
  // the curve as the engine uses it: zero at the onset, log-linear up to 1-in-10, then the six maps
  const path = (c: Record<RP, number>) => CURVE_RPS.map((r, i) => `${i ? "L" : "M"}${x(r).toFixed(1)},${y(depthAtRp(c, r)).toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Flood depth at the site by return period">
        {[0, maxD / 2, maxD / 1.15].map((d) => (
          <g key={d}>
            <line x1={pad.l} x2={W - pad.r} y1={y(d)} y2={y(d)} stroke="var(--chart-grid)" />
            <text x={pad.l - 4} y={y(d) + 3} textAnchor="end" className="fill-slate-500 text-[9px]">
              {d.toFixed(1)}m
            </text>
          </g>
        ))}
        {[2, 10, 50, 100, 500].map((r) => (
          <text key={r} x={x(r)} y={H - 6} textAnchor="middle" className="fill-slate-500 text-[9px]">
            {r}
          </text>
        ))}
        <path d={path(h.jrc)} fill="none" stroke="var(--chart-ref)" strokeWidth={h.source === "jrc" ? 2.5 : 1.5} strokeDasharray={h.source === "jrc" ? undefined : "4 3"} />
        {h.site && <path d={path(h.site)} fill="none" stroke="#f59e0b" strokeWidth={h.source === "site" ? 2.5 : 1.5} strokeDasharray={h.source === "site" ? undefined : "4 3"} />}
        {h.events.map((e) => (
          <g key={e.year}>
            <circle cx={x(e.rp)} cy={y(e.depth)} r={3.5} fill="#f43f5e" />
            <text x={x(e.rp) + 5} y={y(e.depth) - 4} className="fill-rose-200 text-[8px]">
              {e.year}
            </text>
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
        <span>
          <span className="mr-1 inline-block h-0.5 w-3 bg-slate-400 align-middle" />
          JRC map{h.jrcDry ? " (dry)" : ""}
        </span>
        {h.site && (
          <span>
            <span className="mr-1 inline-block h-0.5 w-3 bg-amber-500 align-middle" />
            site history
          </span>
        )}
        {h.events.length > 0 && (
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-rose-500 align-middle" />
            reported floods
          </span>
        )}
        <span className="ml-auto text-slate-300">uses: {h.source === "site" ? "site history" : "JRC map"}</span>
      </div>
    </div>
  );
}

function Vulnerability({ run }: { run: OfferRun }) {
  const v = run.vuln;
  const max = Math.max(1, ...v.events.map((e) => Math.max(e.claim, e.calibrated)));
  const at100 = run.buildings.map((b) => ({ b, r: buildingAt(b, 100) }));
  return (
    <div className="space-y-3">
      {v.events.length > 0 && (
        <div>
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>Past claims vs model at the same depth</span>
            <span>
              generic curves ×{v.factor.toFixed(2)}
              {v.r2 !== null ? ` · R² ${v.r2.toFixed(2)}` : ""}
            </span>
          </div>
          <div className="mt-1 space-y-1">
            {v.events.map((e) => (
              <div key={e.year} className="grid grid-cols-[52px_1fr] items-center gap-2 text-[11px]">
                <span className="text-slate-400">
                  {e.year} · {e.depth}m
                </span>
                <div className="space-y-0.5">
                  <div className="h-2 rounded-r bg-rose-400/80" style={{ width: `${(e.claim / max) * 100}%` }} title={`claim ${kes(e.claim)}`} />
                  <div className="h-2 rounded-r" style={{ width: `${(e.calibrated / max) * 100}%`, background: "var(--chart-fill)" }} title={`model ${kes(e.calibrated)}`} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-3 text-[10px] text-slate-500">
            <span>
              <span className="mr-1 inline-block h-2 w-2 bg-rose-400/80" />
              claim
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-2" style={{ background: "var(--chart-fill)" }} />
              model (calibrated)
            </span>
          </div>
        </div>
      )}
      <div>
        <div className="text-[11px] text-slate-400">Damage at 1-in-100, by building</div>
        <div className="mt-1 space-y-1">
          {at100.map(({ b, r }) => (
            <div key={b.id} className="grid grid-cols-[110px_1fr_34px] items-center gap-2 text-[11px]">
              <span className="truncate text-slate-300">{String(b.name)}</span>
              <div className="h-2 rounded-r bg-white/[0.06]">
                <div className="h-2 rounded-r" style={{ width: `${r.dr * 100}%`, background: CLASS_UI[b.cls] }} />
              </div>
              <span className="text-right tabular-nums text-slate-400">{(r.dr * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Exposure({ run, offer }: { run: OfferRun; offer: OfferExtract }) {
  const total = run.rows.reduce((s, r) => s + r.structure + r.stock + r.machinery + r.other, 0);
  const max = Math.max(...run.rows.map((r) => r.structure + r.stock + r.machinery + r.other), 1);
  return (
    <div className="space-y-1.5">
      {run.rows.map((r) => (
        <div key={r.id} className="grid grid-cols-[110px_1fr_64px] items-center gap-2 text-[11px]">
          <span className="truncate text-slate-300" title={`${CLASS_LABEL[r.cls]} · ${Math.round(r.area)} m² · value ${r.valueBasis}${r.floor ? ` · floor raised ${r.floor} m` : ""}`}>
            <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: CLASS_UI[r.cls] }} />
            {r.name}
          </span>
          <div className="flex h-2.5 overflow-hidden rounded-r">
            <div style={{ width: `${(r.structure / max) * 100}%`, background: CLASS_UI[r.cls] }} />
            <div style={{ width: `${(r.stock / max) * 100}%`, background: "#f59e0b" }} />
            <div style={{ width: `${(r.machinery / max) * 100}%`, background: "#a78bfa" }} />
          </div>
          <span className="text-right tabular-nums text-slate-400">{kes(r.structure + r.stock + r.machinery + r.other)}</span>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3 pt-1 text-[10px] text-slate-500">
        <span>
          <span className="mr-1 inline-block h-2 w-2 bg-slate-400" />
          structure (class colour)
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 bg-amber-500" />
          stock
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 bg-violet-400" />
          machinery
        </span>
        <span className="ml-auto text-slate-300">
          total {kes(total)}
          {offer.sum_insured_kes ? (Math.abs(total - offer.sum_insured_kes) < 1e6 ? " = sum insured ✓" : ` vs ${kes(offer.sum_insured_kes)} insured`) : ""}
        </span>
      </div>
    </div>
  );
}

function Toggle({ value, options, onChange, disabled }: { value: string; options: [string, string][]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="mt-2 inline-flex gap-1 rounded-lg bg-white/[0.04] p-1 text-[11px]">
      {options.map(([v, l]) => (
        <button key={v} disabled={disabled} onClick={() => onChange(v)} className={`rounded-md px-2 py-0.5 ${value === v ? "bg-white/[0.12] text-white" : "text-slate-400"} disabled:opacity-50`}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="font-display text-[14px] text-slate-100">{value}</div>
    </div>
  );
}

/** the decision as a short Markdown report an underwriter can file */
function offerReport(run: OfferRun, checks: FactCheck[], x: ExtractResponse): string {
  const d = run.decision;
  const f = run.financial;
  const row = (r: number) => `| 1-in-${r} | ${Number(run.buildings[0]?.[`d${r}`] ?? 0).toFixed(2)} m | ${kes(f.byRp[r].gu)} | ${kes(f.byRp[r].gross)} | ${kes(f.byRp[r].reinsurer)} |`;
  return `# ${d.verdict}: ${run.insured}

Risk Forge CAT model run on the broker's offer (${x.offer.reference ?? "no reference"}). Synthetic hackathon test document; figures extracted by Risk Forge AI and checked against the text (${checks.filter((c) => c.found && c.matches).length} of ${checks.length} verified).

## Why
${d.reasons.map((r) => `- ${r.text}`).join("\n")}

## Conditions
${d.conditions.map((c, i) => `${i + 1}. ${c}`).join("\n")}

## Losses (Kenya Re ${Math.round(run.programme.qs * 100)}% after a ${kes(run.programme.deductible)} deductible${run.programme.limit ? ` and ${kes(run.programme.limit)} limit` : ""})
| Flood | Depth at site | Ground-up | Gross | Kenya Re |
|---|---|---|---|---|
${KEY_RPS.filter((r) => r !== 250).map(row).join("\n")}

Average annual loss: ground-up ${kes(f.aal.gu)}, Kenya Re ${kes(f.aal.reinsurer)}. Technical premium for Kenya Re's share: ${kes(d.technical)}${d.offered !== null ? `; offered ${kes(d.offered)}` : ""}.

## How the model got there
- Hazard: ${run.hazard.source === "site" ? `the JRC map is dry at the site, so flood depths come from the document's reported floods (${run.hazard.events.map((e) => `${e.year}: ${e.depth} m`).join(", ")}), shaped by the basin's JRC depth-growth curve` : "JRC flood maps at the site"}.
- Vulnerability: class damage curves with raised floors and contents curves${run.vuln.applied ? `, calibrated ×${run.vuln.factor.toFixed(2)} to the site's ${run.vuln.events.length} past claims` : ""}.
- Exposure: ${run.rows.length} buildings, ${kes(run.rows.reduce((s, r) => s + r.structure + r.stock + r.machinery + r.other, 0))} including contents.
- Personal details were removed before the AI read the document.
`;
}
