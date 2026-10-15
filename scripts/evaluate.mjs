// Hidden-seed evaluation (seeds 1000-1029 were never used while developing the planner).
import { generateScenario } from '../src/adapters/generator.js';
import { evaluate } from '../src/domain/simulator.js';
import { plan } from '../src/application/planner.js';
import { baselineFifoNearest, baselinePriceGreedy, baselineSmartGreedy } from '../src/application/baselines.js';
import { sensitivity } from '../src/application/sensitivity.js';
import { writeFileSync } from 'node:fs';
const rows = []; let t0 = performance.now(), maxMs = 0;
for (let seed = 1000; seed < 1030; seed++) {
  const s = generateScenario(seed);
  const t = performance.now(); const p = plan(s); maxMs = Math.max(maxMs, performance.now() - t);
  const m = evaluate(p, s), a = evaluate(baselineFifoNearest(s), s), b = evaluate(baselinePriceGreedy(s), s), c = evaluate(baselineSmartGreedy(s), s);
  const best = [a, b, c].sort((x, y) => y.net - x.net)[0];
  rows.push({ seed, net: m.net, bestBaseNet: best.net, spoil: m.spoilageRate, bestBaseSpoil: Math.min(a.spoilageRate, b.spoilageRate, c.spoilageRate), fulfil: m.fulfillment, baseFulfil: Math.max(a.fulfillment, b.fulfillment, c.fulfillment), violations: m.violations.length, baseViolations: Math.min(a.violations.length, b.violations.length, c.violations.length), fifoNet: a.net, smartNet: c.net, smartSpoil: c.spoilageRate, smartFulfil: c.fulfillment, priceNet: b.net, fifoSpoil: a.spoilageRate, priceSpoil: b.spoilageRate });
}
const mean = (k) => rows.reduce((x, r) => x + r[k], 0) / rows.length;
const wins = (f) => rows.filter(f).length / rows.length;
const sens = { beats: 0, draws: 0 };
for (let seed = 1000; seed < 1010; seed++) { const r = sensitivity(generateScenario(seed), { draws: 30, seed }); sens.beats += r.replanBeatsBaseline * 30; sens.draws += 30; }
const out = {
  seeds: rows.length,
  S1_spoilage: { plan: mean('spoil'), bestBaseline: mean('bestBaseSpoil'), ratio: mean('spoil') / mean('bestBaseSpoil'), fifo: mean('fifoSpoil'), smart: mean('smartSpoil'), price: mean('priceSpoil') },
  S2_net: { planMean: mean('net'), bestBaselineMean: mean('bestBaseNet'), upliftPct: (mean('net') / mean('bestBaseNet') - 1) * 100, winRate: wins(r => r.net > r.fifoNet && r.net > r.priceNet && r.net > r.smartNet), fifo: mean('fifoNet'), smart: mean('smartNet'), upliftVsSmartPct: (mean('net') / mean('smartNet') - 1) * 100, price: mean('priceNet') },
  S3_fulfilment: { plan: mean('fulfil'), baseline: mean('baseFulfil'), winRate: wins(r => r.fulfil >= r.baseFulfil) },
  S4_violations: { planSeedsWithViolations: rows.filter(r => r.violations > 0).length, baselineSeedsWithViolations: rows.filter(r => r.baseViolations > 0).length },
  S5_robust: { replanBeatsBaselineDraws: sens.beats / sens.draws, draws: sens.draws },
  S6_maxPlanMs: Math.round(maxMs), totalMs: Math.round(performance.now() - t0),
};
writeFileSync(new URL('../eval-results.json', import.meta.url), JSON.stringify({ summary: out, rows }, null, 1));
console.log(JSON.stringify(out, null, 1));
