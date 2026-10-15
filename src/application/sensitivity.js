import { evaluate } from '../domain/simulator.js';
import { plan } from './planner.js';
import { strongestBaseline } from './baselines.js';

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
  return { netMean: mean('net'), netP10: nets[Math.floor(nets.length * 0.1)], netP90: nets[Math.min(nets.length - 1, Math.floor(nets.length * 0.9))], spoiledKgMean: mean('trueSpoiledKg'), expiredKgMean: mean('expiredKg'), unsoldMean: mean('unsoldRate'), fulfillmentMean: mean('fulfillment'), n: rows.length };
};
/** Random stress draws. Fair test: the original plan and the strongest baseline are both computed once on the original day and kept fixed on every bad day. The replanned figure re-solves with the disturbed values already known (oracle upper bound). */
export function sensitivity(s, { draws = 30, seed = 1 } = {}) {
  const r = rng(seed); const u = (a, b) => a + (b - a) * r();
  const fixedPlan = plan(s); const strong = strongestBaseline(s); const base = strong.plan;
  const rows = { baseline: [], fixed: [], replanned: [] }; let fixedBeats = 0, replanBeats = 0, wins = 0, ties = 0, losses = 0;
  for (let i = 0; i < draws; i++) {
    const p = perturb(s, { shelfScale: u(0.8, 1), delayDays: u(0, 0.5), demandScale: u(0.75, 1.15), priceScale: u(0.9, 1.1) });
    const mb = evaluate(base, p), mf = evaluate(fixedPlan, p), mr = evaluate(replan(p), p);
    rows.baseline.push(mb); rows.fixed.push(mf); rows.replanned.push(mr);
    if (mf.net >= mb.net) fixedBeats++;
    if (mf.net > mb.net + 1e-6) wins++; else if (mf.net >= mb.net - 1e-6) ties++; else losses++;
    if (mr.net >= mb.net) replanBeats++;
  }
  return { baselineName: strong.name, baseline: summarize(rows.baseline), fixed: summarize(rows.fixed), replannedOracle: summarize(rows.replanned), fixedBeatsBaseline: fixedBeats / draws, fixedWins: wins, fixedTies: ties, fixedLosses: losses, replanBeatsBaseline: replanBeats / draws, draws };
}

/** Trip-delay execution test: the plan is made on the nominal day, then each market's trips run late with probability delayShare by 0.3..1.0 day. Plans stay fixed. */
export function delayDraw(s, seed, { delayShare = 1 / 3, delayRange = [0.3, 1.0] } = {}) {
  const r = rng(seed); const o = clone(s);
  for (const d of o.destinations) if (r() < delayShare) d.travelDays = Math.round((d.travelDays + delayRange[0] + (delayRange[1] - delayRange[0]) * r()) * 1000) / 1000;
  return o;
}
/** Plan that keeps a safety margin: planned with trips bufferDays longer than nominal, so a small delay does not turn a shipment into spoilage. */
export function planBuffered(s, bufferDays = 0.25) { return plan(perturb(s, { delayDays: bufferDays })); }
