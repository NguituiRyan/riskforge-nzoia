import { useEffect, useRef, useState } from "react";
import AnimatedValue from "./AnimatedValue";
import type { ScenarioResult } from "../lib/engine";
import { alertFor, flowForRp, rpForStage, type LiveSource, type NodeCloudState, type NodeData, type NodeReading, type TriggerTerms } from "../lib/node";
import { kes } from "../lib/format";

// minimal Web Serial typings (Chrome / Edge); not in TypeScript's DOM lib yet
interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
}

const STAGE_MAX = 7.5;
const POLL_MS = 2000; // dashboard checks the Wi-Fi node's state this often
const ONLINE_S = 20; // the node posts every 3 s; silence longer than this means it is off or out of range
const fmtKes = (n: number) => kes(n);
const fmtInt = (n: number) => Math.round(n).toLocaleString("en-KE");

interface Props {
  nd: NodeData;
  reading: NodeReading | null;
  onReading: (r: NodeReading) => void;
  scenario: ScenarioResult | null;
  trigger: TriggerTerms;
  onOpenReport: () => void;
}

export default function LivePanel({ nd, reading, onReading, scenario, trigger, onOpenReport }: Props) {
  const [source, setSource] = useState<LiveSource>("simulate");
  const [simStage, setSimStage] = useState(2.4);
  const [playing, setPlaying] = useState(false);
  const [dayIdx, setDayIdx] = useState(0);
  const [scale, setScale] = useState(0.3); // metres of river stage per cm of water in the demo tank
  const [usb, setUsb] = useState<{ state: "idle" | "connecting" | "connected" | "error"; msg?: string; lines: number }>({ state: "idle", lines: 0 });
  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const emit = useRef(onReading);
  emit.current = onReading;
  const [cloud, setCloud] = useState<NodeCloudState | null>(null);
  const [cloudErr, setCloudErr] = useState<string | null>(null);
  const lastCloudKey = useRef("");

  // simulate: slider drives the stage
  useEffect(() => {
    if (source === "simulate") emit.current({ stage: simStage, at: Date.now(), source });
  }, [simStage, source]);

  // replay: step through the September 2020 hydrograph, one day every 280 ms
  const series = nd.replay.series;
  useEffect(() => {
    if (source !== "replay") return;
    const day = series[dayIdx];
    emit.current({ stage: day.stage, at: Date.now(), source, date: day.date });
  }, [dayIdx, source, series]);
  useEffect(() => {
    if (source !== "replay" || !playing) return;
    const id = window.setInterval(() => {
      setDayIdx((i) => {
        if (i >= series.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 280);
    return () => window.clearInterval(id);
  }, [source, playing, series.length]);

  // Wi-Fi: the node posts signed readings to /api/node; poll the verified state the server keeps
  const nodeId = nd.node.id;
  useEffect(() => {
    if (source !== "wifi") return;
    let stop = false;
    lastCloudKey.current = "";
    const poll = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/node?node=${encodeURIComponent(nodeId)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`server ${res.status}`);
        const j = (await res.json()) as NodeCloudState;
        if (stop) return;
        setCloud(j);
        setCloudErr(null);
        const l = j.latest;
        const key = l ? `${l.ts}:${l.seq}` : "";
        if (l && key !== lastCloudKey.current && (j.age_s ?? Infinity) <= ONLINE_S) {
          lastCloudKey.current = key;
          emit.current({ stage: Math.max(l.level_cm, 0) * scaleRef.current, at: Date.now(), source: "wifi", levelCm: l.level_cm, seq: l.seq, raw: JSON.stringify({ node: j.node, seq: l.seq, ts: l.ts, level_cm: l.level_cm, verified: true }) });
        }
      } catch (e) {
        if (!stop) setCloudErr(e instanceof Error ? e.message : String(e));
      }
    };
    void poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [source, nodeId]);

  async function connectUsb() {
    const serial = (navigator as unknown as { serial?: SerialLike }).serial;
    if (!serial) {
      setUsb({ state: "error", msg: "Web Serial needs Chrome or Edge on a laptop. Use Simulate or Replay here.", lines: 0 });
      return;
    }
    try {
      setUsb({ state: "connecting", lines: 0 });
      const port = await serial.requestPort();
      await port.open({ baudRate: 115200 });
      portRef.current = port;
      setUsb({ state: "connected", lines: 0 });
      const decoder = new TextDecoderStream();
      void port.readable!.pipeTo(decoder.writable as WritableStream<Uint8Array>);
      const reader = decoder.readable.getReader();
      readerRef.current = reader;
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("{")) continue;
          try {
            const j = JSON.parse(line) as { node?: string; seq?: number; level_cm?: number };
            if (typeof j.level_cm !== "number") continue;
            emit.current({ stage: Math.max(j.level_cm, 0) * scaleRef.current, at: Date.now(), source: "usb", levelCm: j.level_cm, seq: j.seq, raw: line });
            setUsb((u) => ({ ...u, lines: u.lines + 1 }));
          } catch {
            /* ignore partial lines */
          }
        }
      }
    } catch (e) {
      setUsb({ state: "error", msg: e instanceof Error ? e.message : String(e), lines: 0 });
    }
  }

  async function disconnectUsb() {
    try {
      await readerRef.current?.cancel();
      await portRef.current?.close();
    } catch {
      /* already closed */
    }
    portRef.current = null;
    readerRef.current = null;
    setUsb({ state: "idle", lines: 0 });
  }
  useEffect(() => () => void disconnectUsb(), []);

  const stage = reading?.stage ?? 0;
  const rp = rpForStage(nd, stage);
  const alert = alertFor(nd, stage);
  const replayDay = source === "replay" ? series[dayIdx] : null;
  const flow = replayDay ? replayDay.q : rp ? flowForRp(nd, rp) : null;
  const triggered = stage >= trigger.triggerStage;
  const toneClass = { ok: "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30", amber: "bg-amber-400/15 text-amber-200 ring-amber-400/40", red: "bg-orange-500/15 text-orange-200 ring-orange-400/40", danger: "bg-rose-500/20 text-rose-200 ring-rose-400/50" }[alert.tone];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">River node · {nd.node.name}</div>
          <div className="text-[11px] text-slate-500">{nd.node.id} · ultrasonic level sensor on ESP32</div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${toneClass}`}>{alert.label}</span>
      </div>

      <div className="grid grid-cols-4 gap-1 rounded-xl bg-white/[0.04] p-1">
        {(["simulate", "replay", "usb", "wifi"] as LiveSource[]).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSource(s);
              setPlaying(false);
            }}
            aria-pressed={source === s}
            className={`rounded-lg px-1 py-1.5 text-[12px] transition ${source === s ? "bg-white/[0.12] text-white" : "text-slate-400 hover:text-slate-200"}`}
          >
            {s === "simulate" ? "Simulate" : s === "replay" ? "Replay" : s === "usb" ? "USB" : "Wi-Fi"}
          </button>
        ))}
      </div>

      {source === "simulate" && (
        <div>
          <input type="range" min={0} max={STAGE_MAX} step={0.05} value={simStage} onChange={(e) => setSimStage(Number(e.target.value))} className="w-full accent-brand" aria-label="Simulated river stage" />
          <div className="mt-1 grid grid-cols-4 gap-1 text-[11px]">
            {[
              ["Normal", 2.0],
              ["Alert", 3.0],
              ["1-in-20", 4.8],
              ["1-in-100", 6.0],
            ].map(([l, v]) => (
              <button key={l} onClick={() => setSimStage(v as number)} className="rounded-md bg-white/[0.05] px-1 py-1 text-slate-300 hover:bg-white/10">
                {l}
              </button>
            ))}
          </div>
        </div>
      )}

      {source === "replay" && (
        <div className="text-[12px] text-slate-300">
          <div className="flex items-center justify-between">
            <span>{nd.replay.title}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => (dayIdx >= series.length - 1 ? (setDayIdx(0), setPlaying(true)) : setPlaying((p) => !p))} className="rounded-md bg-brand px-2.5 py-1 font-medium text-on-brand">
              {playing ? "❚❚ Pause" : "▶ Play"}
            </button>
            <input type="range" min={0} max={series.length - 1} value={dayIdx} onChange={(e) => setDayIdx(Number(e.target.value))} className="flex-1 accent-brand" aria-label="Replay day" />
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {replayDay?.date} · GloFAS {replayDay?.q.toLocaleString("en-KE")} m³/s
          </div>
        </div>
      )}

      {source === "usb" && (
        <div className="space-y-2 text-[12px]">
          {usb.state === "connected" ? (
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-emerald-300">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> Node connected · {usb.lines} readings
              </span>
              <button onClick={disconnectUsb} className="rounded-md bg-white/[0.06] px-2 py-1 text-slate-300 hover:bg-white/10">
                Disconnect
              </button>
            </div>
          ) : (
            <button onClick={connectUsb} disabled={usb.state === "connecting"} className="w-full rounded-lg bg-brand px-3 py-2 font-medium text-on-brand disabled:opacity-60">
              {usb.state === "connecting" ? "Choose the node's port…" : "Connect river node (USB)"}
            </button>
          )}
          {usb.state === "error" && <div className="text-rose-300">{usb.msg}</div>}
          <TankScale scale={scale} setScale={setScale} />
          {reading?.raw && <code className="block truncate rounded bg-black/40 px-2 py-1 text-[10px] text-slate-400">{reading.raw}</code>}
        </div>
      )}

      {source === "wifi" && <WifiStatus cloud={cloud} error={cloudErr} scale={scale} setScale={setScale} />}

      <div className="flex gap-3">
        <Gauge nd={nd} stage={stage} trigger={trigger.triggerStage} />
        <div className="grid flex-1 grid-cols-2 gap-2">
          <Tile label="River stage">{stage.toFixed(2)} m</Tile>
          <Tile label="Return period">{rp ? `1-in-${rp < 10 ? rp.toFixed(1) : Math.round(rp)}` : "in bank"}</Tile>
          <Tile label="Flow" hint={replayDay ? "GloFAS" : "fitted"}>{flow ? `${Math.round(flow).toLocaleString("en-KE")} m³/s` : "—"}</Tile>
          <Tile label="Buildings flooded">
            <AnimatedValue value={scenario?.wet ?? 0} format={fmtInt} duration={0.3} />
          </Tile>
          <div className="col-span-2 rounded-xl bg-amber-300/10 px-3 py-2.5 ring-1 ring-amber-300/25">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Event loss estimate</div>
            <div className="font-display text-[18px] font-semibold tabular-nums text-amber-200">
              <AnimatedValue value={scenario?.loss ?? 0} format={fmtKes} duration={0.3} />
            </div>
            <div className="text-[11px] text-slate-500">
              <AnimatedValue value={scenario?.tivWet ?? 0} format={fmtKes} duration={0.3} /> of insured value in the water
            </div>
          </div>
        </div>
      </div>

      <div className={`rounded-xl px-3 py-2.5 text-[12px] ring-1 ${triggered ? "bg-rose-500/15 text-rose-100 ring-rose-400/40" : "bg-white/[0.04] text-slate-300 ring-white/10"}`}>
        <div className="font-semibold">{triggered ? "Parametric trigger hit" : "Parametric trigger armed"}</div>
        <div className="text-[11px] text-slate-400">
          Pays {kes(trigger.payout)} when Rwambwa reaches {trigger.triggerStage.toFixed(1)} m
          {rpForStage(nd, trigger.triggerStage) ? ` (≈1-in-${Math.round(rpForStage(nd, trigger.triggerStage)!)})` : ""}.{" "}
          <button onClick={onOpenReport} className="text-brand-300 underline-offset-2 hover:underline">
            Price it
          </button>
        </div>
      </div>

      <p className="text-[11px] leading-snug text-slate-500">
        Stage → return period uses an assumed table anchored on the 2.8 m Rwambwa alert level; frequency from GloFAS. Field nodes post HMAC-signed readings to <code>/api/node</code>; forged or replayed readings are rejected.
      </p>
    </div>
  );
}

function Tile({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-3 py-2">
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-slate-500">
        {label}
        {hint && <span className="normal-case tracking-normal text-slate-600">{hint}</span>}
      </div>
      <div className="mt-0.5 font-display text-[15px] font-semibold tabular-nums text-slate-50">{children}</div>
    </div>
  );
}

/** vertical stage gauge with the alert bands and the trigger line */
function Gauge({ nd, stage, trigger }: { nd: NodeData; stage: number; trigger: number }) {
  const H = 168;
  const y = (s: number) => H - (Math.min(Math.max(s, 0), STAGE_MAX) / STAGE_MAX) * H;
  const bands: [number, number, string][] = [
    [0, nd.alerts[1].stage, "rgb(52 211 153 / .18)"],
    [nd.alerts[1].stage, nd.alerts[2].stage, "rgb(251 191 36 / .2)"],
    [nd.alerts[2].stage, nd.alerts[3].stage, "rgb(249 115 22 / .22)"],
    [nd.alerts[3].stage, STAGE_MAX, "rgb(244 63 94 / .25)"],
  ];
  return (
    <svg viewBox={`0 0 46 ${H}`} className="h-[168px] w-[46px] shrink-0" role="img" aria-label={`River stage ${stage.toFixed(2)} metres`}>
      {bands.map(([a, b, c]) => (
        <rect key={a} x={14} y={y(b)} width={18} height={y(a) - y(b)} fill={c} />
      ))}
      <rect x={14} y={y(stage)} width={18} height={H - y(stage)} fill="#38bdf8" opacity={0.85} style={{ transition: "y .4s, height .4s" }} />
      <line x1={10} x2={36} y1={y(trigger)} y2={y(trigger)} stroke="#f43f5e" strokeDasharray="3 2" strokeWidth={1.5} />
      {[0, 2.8, 4.2, 5.5, 7].map((s) => (
        <text key={s} x={0} y={y(s) + 3} className="fill-slate-500 text-[8px]">
          {s}
        </text>
      ))}
      <rect x={14} y={0} width={18} height={H} fill="none" stroke="rgb(148 163 184 / .3)" rx={3} />
    </svg>
  );
}

function TankScale({ scale, setScale }: { scale: number; setScale: (n: number) => void }) {
  return (
    <label className="flex items-center justify-between text-slate-400">
      Tank scale: 1 cm =
      <span>
        <input type="number" step={0.05} min={0.05} value={scale} onChange={(e) => setScale(Number(e.target.value) || 0.3)} className="w-16 rounded bg-white/[0.06] px-1.5 py-0.5 text-right text-slate-100" /> m of river
      </span>
    </label>
  );
}

const ago = (s: number) => (s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);

/** connection state of the Wi-Fi node, its recent trace and any readings the server refused */
function WifiStatus({ cloud, error, scale, setScale }: { cloud: NodeCloudState | null; error: string | null; scale: number; setScale: (n: number) => void }) {
  const l = cloud?.latest ?? null;
  const age = cloud?.age_s ?? null;
  const online = l !== null && age !== null && age <= ONLINE_S;
  return (
    <div className="space-y-2 text-[12px]">
      {error && !cloud ? (
        <div className="text-rose-300">Can't reach the server ({error}).</div>
      ) : online ? (
        <div className="flex items-center gap-2 text-emerald-300">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
          <span>Online over Wi-Fi · reading {ago(age!)} ago · signature verified</span>
        </div>
      ) : l ? (
        <div className="flex items-center gap-2 text-amber-200">
          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" /> Offline · last reading {ago(age ?? 0)} ago
        </div>
      ) : (
        <div className="flex items-start gap-2 text-slate-400">
          <span className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-slate-500" />
          {cloud ? "Waiting for the node. Power it on with Wi-Fi and it appears here within seconds." : "Connecting to the server…"}
        </div>
      )}
      {cloud && cloud.history.length > 1 && <Trace history={cloud.history} />}
      {cloud && cloud.rejected > 0 && (
        <div className="rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200 ring-1 ring-rose-400/25">
          {cloud.rejected} forged or replayed {cloud.rejected === 1 ? "reading" : "readings"} rejected
          {cloud.last_rejected ? ` · last ${ago((cloud.now - cloud.last_rejected.at) / 1000)} ago` : ""}
        </div>
      )}
      <TankScale scale={scale} setScale={setScale} />
      <p className="text-[11px] leading-snug text-slate-500">Same view on any phone: open this page, Live river node, Wi-Fi.</p>
    </div>
  );
}

/** the node's last few minutes of water level, as the server received them */
function Trace({ history }: { history: [number, number][] }) {
  const W = 300;
  const H = 40;
  const t0 = history[0][0];
  const t1 = history[history.length - 1][0];
  const top = Math.max(10, ...history.map(([, v]) => v)) * 1.1;
  const pts = history.map(([t, v]) => `${(((t - t0) / Math.max(t1 - t0, 1)) * W).toFixed(1)},${(H - (v / top) * H).toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-10 w-full" role="img" aria-label="Water level over the last few minutes">
        <polyline points={pts} fill="none" stroke="var(--chart-line)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-slate-500">
        <span>last {ago((t1 - t0) / 1000)} of readings</span>
        <span>latest · {history[history.length - 1][1].toFixed(1)} cm in the tank</span>
      </div>
    </div>
  );
}
