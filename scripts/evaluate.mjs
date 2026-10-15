// Held-out evaluation (seeds 1000-1029 were never used while developing the planner).
// Two dataset sets side by side, same cost model, same seeds: 'default' and 'shelf-life-binding'. Elasticity sweep 0.5 / 1.0 / 1.5.
// Also writes the number tables of README.md between the EVAL markers, so README numbers cannot drift from eval-results.json.
import { generateScenario } from '../src/adapters/generator.js';
import { evaluate } from '../src/domain/simulator.js';
import { plan } from '../src/application/planner.js';
import { elasticitySweep } from '../src/application/comparison.js';
import { sensitivity, delayDraw, planBuffered } from '../src/application/sensitivity.js';
import { baselineFifoNearest, baselinePriceGreedy, baselineSmartGreedy, baselineSmartDiscount } from '../src/application/baselines.js';
import { writeFileSync, readFileSync } from 'node:fs';
const seeds = [...Array(30).keys()].map(i => 1000 + i);
const SETS = [['default', 'Default set'], ['shelf-life-binding', 'Shelf-life-binding set']];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const gen = (profile, sd, e) => { const s = generateScenario(sd, { profile }); if (e) s.costModel.elasticity = e; return s; };

function runSet(profile) {
  let maxMs = 0;
  for (const sd of seeds) { const s = gen(profile, sd); const t = performance.now(); plan(s); maxMs = Math.max(maxMs, performance.now() - t); }
  const sweep = elasticitySweep(seeds.map(sd => gen(profile, sd)));
  const violations = [0.5, 1.0, 1.5].map(e => seeds.filter(sd => { const s = gen(profile, sd, e); return evaluate(plan(s), s).violations.length > 0; }).length);
  const stress = [0.5, 1.0, 1.5].map(e => {
    const R = seeds.slice(0, 10).map(sd => sensitivity(gen(profile, sd, e), { draws: 30, seed: sd }));
    const m = (f) => mean(R.map(f));
    return { elasticity: e, draws: 300, wins: Math.round(m(r => r.fixedWins / r.draws) * 300), ties: Math.round(m(r => r.fixedTies / r.draws) * 300), losses: Math.round(m(r => r.fixedLosses / r.draws) * 300), winsOrTies: Math.round(m(r => r.fixedBeatsBaseline) * 300), planNet: m(r => r.fixed.netMean), baseNet: m(r => r.baseline.netMean), planP10: m(r => r.fixed.netP10), planP90: m(r => r.fixed.netP90), baseP10: m(r => r.baseline.netP10), baseP90: m(r => r.baseline.netP90), planSpoiledKg: m(r => r.fixed.spoiledKgMean), baseSpoiledKg: m(r => r.baseline.spoiledKgMean), planExpiredKg: m(r => r.fixed.expiredKgMean), baseExpiredKg: m(r => r.baseline.expiredKgMean), nominalPlanNet: m(r => r.fixed.netMean) };
  });
  const delay = [0.5, 1.0, 1.5].map(e => {
    const names = ['FreshRoute plan', 'FreshRoute plan, +0.25 d buffer', 'FIFO to nearest market', 'FIFO to highest price', 'Urgent-first, best-margin dispatcher', 'Dispatcher + flat 30% surplus discount'];
    const acc = names.map(() => ({ net: [], spoiled: [], expired: [], fulfil: [] }));
    for (const sd of seeds) {
      const s = gen(profile, sd, e);
      const plans = [plan(s), planBuffered(s, 0.25), baselineFifoNearest(s), baselinePriceGreedy(s), baselineSmartGreedy(s), baselineSmartDiscount(s)];
      for (let k = 1; k <= 10; k++) { const q = delayDraw(s, sd * 100 + k); plans.forEach((p, i) => { const m = evaluate(p, q); acc[i].net.push(m.net); acc[i].spoiled.push(m.trueSpoiledKg); acc[i].expired.push(m.expiredKg); acc[i].fulfil.push(m.fulfillment); }); }
    }
    return { elasticity: e, runs: seeds.length * 10, rows: names.map((n, i) => ({ name: n, net: mean(acc[i].net), spoiledKg: mean(acc[i].spoiled), expiredKg: mean(acc[i].expired), fulfillment: mean(acc[i].fulfil) })) };
  });
  return { profile, seeds: seeds.length, headline: sweep.conservative, sweep: sweep.levels, violationSeedsByElasticity: violations, stress, delayRuns: delay, maxPlanMs: Math.round(maxMs) };
}
import { perturb } from '../src/application/sensitivity.js';
import { strongestBaseline } from '../src/application/baselines.js';
// Why bad-day nets are far below the normal day: apply each disturbance alone, at its mean size, to the fixed plan (default set, elasticity 1.0, first 10 datasets).
const decomp = (() => {
  const cases = { 'normal day': {}, 'shelf life -10% only': { shelfScale: 0.9 }, 'trips +0.25 d only': { delayDays: 0.25 }, 'demand -5% only': { demandScale: 0.95 }, 'all three': { shelfScale: 0.9, delayDays: 0.25, demandScale: 0.95 } };
  const out = {}; for (const k of Object.keys(cases)) out[k] = { planNet: 0, baseNet: 0, planSpoiledKg: 0 };
  for (const sd of seeds.slice(0, 10)) { const s = gen('default', sd, 1.0); const p = plan(s), b = strongestBaseline(s).plan;
    for (const [k, c] of Object.entries(cases)) { const q = perturb(s, c); const mp = evaluate(p, q), mb = evaluate(b, q); out[k].planNet += mp.net / 10; out[k].baseNet += mb.net / 10; out[k].planSpoiledKg += mp.trueSpoiledKg / 10; } }
  return out; })();
const t0 = performance.now();
const sets = Object.fromEntries(SETS.map(([p]) => [p, runSet(p)]));
const allUplifts = SETS.flatMap(([p]) => sets[p].sweep.map(l => l.upliftPct));
const summary = { seeds: 30, headline: { rule: 'most conservative uplift over both sets and elasticity 0.5 / 1.0 / 1.5, vs the strongest of four baselines', upliftPct: Math.min(...allUplifts) }, sets, badDayDecomposition: decomp, S6_maxPlanMs: Math.max(...SETS.map(([p]) => sets[p].maxPlanMs)), totalMs: Math.round(performance.now() - t0) };
writeFileSync(new URL('../eval-results.json', import.meta.url), JSON.stringify({ summary }, null, 1));

// ---- README tables
const R0 = (x) => Math.round(x).toLocaleString('en-US'), P1 = (x) => (x * 100).toFixed(1) + '%', U1 = (x) => x === null ? 'n/a' : (x >= 0 ? '+' : '') + x.toFixed(1) + '%';
let md = '';
for (const [p, label] of SETS) {
  const S = sets[p];
  md += `\n### ${label}\n\nNet revenue vs the strongest of four baselines (INR, mean over 30 held-out datasets). *Strongest baseline* = on every dataset, the best of the four baselines on that dataset, then averaged; so it can sit above every single baseline's own mean (it does at elasticity 1.5, see the last row of that table). *Plan vs strongest* is a percentage of that mean, shown only while the baseline net is above 0 (otherwise only the INR difference is defined); the per-dataset column is always an INR difference, so "never worse" and a negative minimum cannot both appear:\n\n| Elasticity | Plan net | Plan, no discounts | Strongest baseline | Plan vs strongest | Plan minus strongest, per dataset: min to max (INR) | Never worse / strictly better | Violations (datasets) |\n|---|---|---|---|---|---|---|---|\n`;
  S.sweep.forEach((l, i) => { md += `| ${l.elasticity} | ${R0(l.planNet)} | ${R0(l.planNoDiscNet)} | ${R0(l.bestBaseNet)} | ${l.upliftPct === null ? 'n/a (baseline net <= 0)' : U1(l.upliftPct)} | ${R0(l.seedMinDiffInr)} to ${R0(l.seedMaxDiffInr)} | ${Math.round(l.neverLoseRate * 30)}/30 · ${Math.round(l.winRate * 30)}/30 | ${S.violationSeedsByElasticity[i]} |\n`; });
  for (const l of S.sweep) {
    md += `\nElasticity ${l.elasticity}, every strategy on the same datasets:\n\n| Strategy | Net (INR) | Really spoiled kg (incl. expired at depot) | of which expired at depot kg | Stock unsold | Demand fulfilled | Unmet demand kg | Market fulfilment spread (max-min) |\n|---|---|---|---|---|---|---|---|\n`;
    for (const [n, v] of Object.entries(l.table)) md += `| ${n} | ${R0(v.net)} | ${R0(v.trueSpoiledKg)} | ${R0(v.expiredKg)} | ${P1(v.unsoldRate)} | ${P1(v.fulfillment)} | ${R0(v.unmetKg)} | ${P1(v.marketSpread)} |\n`;
  }
  md += `\nStress test, 10 datasets x 30 bad days (shelf life up to -20%, trips up to +0.5 d, demand -25..+15%, prices +-10%); plan and strongest baseline computed once and kept fixed; a tie means a net difference under 0.000001 INR:\n\n| Elasticity | Plan wins / ties / losses (of 300 bad days) | Mean net plan vs baseline | P10-P90 net, plan | P10-P90 net, baseline | Really spoiled kg per bad day, plan vs baseline |\n|---|---|---|---|---|---|\n`;
  for (const x of S.stress) md += `| ${x.elasticity} | ${x.wins} / ${x.ties} / ${x.losses} | ${R0(x.planNet)} vs ${R0(x.baseNet)} | ${R0(x.planP10)} to ${R0(x.planP90)} | ${R0(x.baseP10)} to ${R0(x.baseP90)} | ${R0(x.planSpoiledKg)} vs ${R0(x.baseSpoiledKg)} |\n`;
  md += `\nTrip-delay run (plans made on the nominal day, then each market's trips run 0.3-1.0 d late with probability 1/3; 300 runs per row, plans fixed):\n\n| Elasticity | Strategy | Mean net (INR) | Really spoiled kg | of which expired at depot | Demand fulfilled |\n|---|---|---|---|---|---|\n`;
  for (const d of S.delayRuns) for (const r of d.rows) md += `| ${d.elasticity} | ${r.name} | ${R0(r.net)} | ${R0(r.spoiledKg)} | ${R0(r.expiredKg)} | ${P1(r.fulfillment)} |\n`;
}
md += `\nWhy bad-day nets are far below a normal day (each disturbance alone, at its mean size, on the fixed plan; default set, elasticity 1.0, 10 datasets):\n\n| Disturbance | Plan net | Strongest baseline net | Plan really spoiled kg |\n|---|---|---|---|\n`;
for (const [k, v] of Object.entries(decomp)) md += `| ${k} | ${R0(v.planNet)} | ${R0(v.baseNet)} | ${R0(v.planSpoiledKg)} |\n`;
md += `\nPlanning time: max ${summary.S6_maxPlanMs} ms over 60 datasets (30 per set). Headline value (lowest uplift over both sets and all three elasticities): **${U1(summary.headline.upliftPct)}**.\n`;
let readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
readme = readme.replace(/<!-- EVAL:START -->[\s\S]*<!-- EVAL:END -->/, `<!-- EVAL:START -->${md}<!-- EVAL:END -->`);
writeFileSync(new URL('../README.md', import.meta.url), readme);
console.log(JSON.stringify({ headline: summary.headline, maxMs: summary.S6_maxPlanMs, totalMs: summary.totalMs }));
