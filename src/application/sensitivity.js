import { evaluate } from '../domain/simulator.js';
import { plan } from './planner.js';
import { baselineFifoNearest, baselinePriceGreedy } from './baselines.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
export function perturb(s, p = {}) {
  const o = clone(s);
  for (const b of o.batches) b.life = Math.round(b.life * (p.shelfScale ?? 1) * 1000) / 1000;
  for (const d of o.destinations) {
    d.travelDays += p.delayDays || 0;
    for (const c of Object.keys(d.demand)) { d.demand[c] = Math.round(d.demand[c] * (p.demandScale ?? 1)); d.price[c] = Math.round(d.price[c] * (p.priceScale ?? 1) * 10) / 10; }
    if (p.closedDest === d.id) d.closed = true;
  }
  return o;
}
export const replan = (s) => plan(s);

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const summarize = (rows) => {
  const nets = rows.map(r => r.net).sort((a, b) => a - b);
  const mean = (k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
  return { netMean: mean('net'), netP10: nets[Math.floor(nets.length * 0.1)], spoilageMean: mean('spoilageRate'), fulfillmentMean: mean('fulfillment'), n: rows.length };
};
/** Random stress draws: fixed baseline, the original plan left unchanged, and a replanned plan. */
export function sensitivity(s, { draws = 30, seed = 1 } = {}) {
  const r = rng(seed); const u = (a, b) => a + (b - a) * r();
  const fixedPlan = plan(s); const base = baselineFifoNearest(s);
  const rows = { baseline: [], fixed: [], replanned: [] }; let replanBeats = 0;
  for (let i = 0; i < draws; i++) {
    const p = perturb(s, { shelfScale: u(0.8, 1), delayDays: u(0, 0.5), demandScale: u(0.75, 1.15), priceScale: u(0.9, 1.1) });
    const mb = evaluate(base, p), mf = evaluate(fixedPlan, p), mr = evaluate(replan(p), p);
    rows.baseline.push(mb); rows.fixed.push(mf); rows.replanned.push(mr);
    if (mr.net >= mb.net) replanBeats++;
  }
  return { baseline: summarize(rows.baseline), fixed: summarize(rows.fixed), replanned: summarize(rows.replanned), replanBeatsBaseline: replanBeats / draws, draws };
}
