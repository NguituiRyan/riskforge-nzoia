/** River node (hardware) maths: sensor level -> stage -> return period -> flow; alerts; parametric trigger pricing. */
import type { PortfolioResult } from "./engine";

export interface NodeData {
  node: { id: string; name: string; lat: number; lon: number };
  gumbel: { mu: number; beta: number; years: number; source: string };
  q2: number;
  stageTable: { stage: number; rp: number; q: number }[];
  alerts: { stage: number; label: string }[];
  replay: { title: string; peakDate: string; series: { date: string; q: number; rp: number; stage: number }[] };
}

export type LiveSource = "simulate" | "replay" | "usb";

export interface NodeReading {
  stage: number; // m at Rwambwa
  at: number; // ms timestamp
  source: LiveSource;
  levelCm?: number;
  seq?: number;
  raw?: string;
  date?: string; // replay day
}

/** return period for a river stage (log-linear between table points); null below the onset (no flooding) */
export function rpForStage(nd: NodeData, stage: number): number | null {
  const t = nd.stageTable;
  if (stage < t[0].stage) return null;
  for (let i = 1; i < t.length; i++) {
    if (stage <= t[i].stage) {
      const f = (stage - t[i - 1].stage) / (t[i].stage - t[i - 1].stage);
      return Math.exp(Math.log(t[i - 1].rp) + f * (Math.log(t[i].rp) - Math.log(t[i - 1].rp)));
    }
  }
  return t[t.length - 1].rp;
}

export function stageForRp(nd: NodeData, rp: number): number {
  const t = nd.stageTable;
  if (rp <= t[0].rp) return t[0].stage;
  for (let i = 1; i < t.length; i++) {
    if (rp <= t[i].rp) {
      const f = (Math.log(rp) - Math.log(t[i - 1].rp)) / (Math.log(t[i].rp) - Math.log(t[i - 1].rp));
      return t[i - 1].stage + f * (t[i].stage - t[i - 1].stage);
    }
  }
  return t[t.length - 1].stage;
}

/** discharge with this return period from the Gumbel fit (m3/s) */
export const flowForRp = (nd: NodeData, rp: number) => nd.gumbel.mu - nd.gumbel.beta * Math.log(-Math.log(1 - 1 / rp));

export function alertFor(nd: NodeData, stage: number): { label: string; tone: "ok" | "amber" | "red" | "danger" } {
  const a = [...nd.alerts].reverse().find((x) => stage >= x.stage) ?? nd.alerts[0];
  const tone = a.label === "Normal" ? "ok" : a.label === "Alert" ? "amber" : a.label === "Warning" ? "red" : "danger";
  return { label: a.label, tone };
}

export interface TriggerTerms {
  triggerStage: number; // m
  payout: number; // KES per event
  load: number; // premium loading over expected payout
}

/** parametric cover on the node's stage: pays `payout` in any year the stage reaches the trigger */
export function priceTrigger(nd: NodeData, terms: TriggerTerms, portfolio: PortfolioResult) {
  const triggerRp = rpForStage(nd, terms.triggerStage) ?? 2;
  const annualProb = 1 / triggerRp;
  const expectedPayout = terms.payout * annualProb;
  const premium = expectedPayout * (1 + terms.load);
  // basis risk: compare the fixed payout with the modelled loss of the book at each return period
  const basis = [10, 20, 50, 100, 200, 500].map((rp) => {
    const loss = portfolio.scenarios[rp].loss;
    const pays = rp >= triggerRp ? terms.payout : 0;
    return { rp, loss, pays, cover: loss > 0 ? pays / loss : null };
  });
  return { triggerRp, annualProb, expectedPayout, premium, basis };
}
