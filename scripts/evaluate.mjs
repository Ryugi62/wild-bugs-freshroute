// Hidden-seed evaluation (seeds 1000-1029 were never used while developing the planner).
// One shared cost model; elasticity sweep 0.5 / 1.0 / 1.5; headline = most conservative level.
import { generateScenario } from '../src/adapters/generator.js';
import { evaluate } from '../src/domain/simulator.js';
import { plan } from '../src/application/planner.js';
import { elasticitySweep } from '../src/application/comparison.js';
import { sensitivity } from '../src/application/sensitivity.js';
import { writeFileSync } from 'node:fs';
const seeds = [...Array(30).keys()].map(i => 1000 + i);
const t0 = performance.now(); let maxMs = 0;
for (const sd of seeds) { const s = generateScenario(sd); const t = performance.now(); plan(s); maxMs = Math.max(maxMs, performance.now() - t); }
const sweep = elasticitySweep(seeds.map(sd => generateScenario(sd)));
const base = seeds.map(sd => { const s = generateScenario(sd); const m = evaluate(plan(s), s); return { seed: sd, net: m.net, unsoldRate: m.unsoldRate, fulfil: m.fulfillment, violations: m.violations.length }; });
const stressAt = (e) => {
  const st = { fixedBeats: 0, replanOracleBeats: 0, draws: 0, fixedNet: 0, baselineNet: 0 };
  for (const sd of seeds.slice(0, 10)) {
    const sc = generateScenario(sd); sc.costModel.elasticity = e;
    const r = sensitivity(sc, { draws: 30, seed: sd });
    st.fixedBeats += r.fixedBeatsBaseline * 30; st.replanOracleBeats += r.replanBeatsBaseline * 30; st.draws += 30; st.fixedNet += r.fixed.netMean / 10; st.baselineNet += r.baseline.netMean / 10;
  }
  return { elasticity: e, planFixedBeatsStrongestBaselineFixed: st.fixedBeats / st.draws, wins: st.fixedBeats, draws: st.draws, replannedWithKnownValuesOracle: st.replanOracleBeats / st.draws, meanNetFixedPlan: st.fixedNet, meanNetFixedBaseline: st.baselineNet };
};
const stress = [0.5, 1.0, 1.5].map(stressAt);
const out = {
  seeds: seeds.length,
  headline: { rule: 'most conservative uplift over elasticity 0.5 / 1.0 / 1.5, vs the strongest of four baselines', ...sweep.conservative },
  sweep: sweep.levels,
  S1_unsold: { metric: 'share of stock kg not sold this round (undispatched carry-over written off + unsold at market + real spoilage)', plan: sweep.levels.map(l => l.planUnsoldRate), bestBaseline: sweep.levels.map(l => l.bestBaseUnsoldRate), planRealSpoiledKg: sweep.levels.map(l => l.planTrueSpoiledKg), bestBaselineRealSpoiledKg: sweep.levels.map(l => l.bestBaseTrueSpoiledKg) },
  S4_violations: { planSeedsWithViolations: base.filter(r => r.violations > 0).length, atAllElasticities: sweep.levels.map(l => l.planViolationSeeds) },
  S5_stress: stress,
  S3_fulfilment: { plan: base.reduce((a, r) => a + r.fulfil, 0) / base.length },
  S6_maxPlanMs: Math.round(maxMs), totalMs: Math.round(performance.now() - t0),
};
writeFileSync(new URL('../eval-results.json', import.meta.url), JSON.stringify({ summary: out, rows: base }, null, 1));
console.log(JSON.stringify(out, null, 1));
