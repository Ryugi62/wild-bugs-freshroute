import { evaluate } from '../domain/simulator.js';
import { plan } from './planner.js';
import { strongestBaseline, baselineSmartDiscount } from './baselines.js';

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** One shared cost model, one row per price-elasticity assumption. The headline is the most conservative uplift over the sweep. */
export function sweepScenario(s, levels = [0.5, 1.0, 1.5]) {
  return levels.map(e => {
    const sc = { ...s, costModel: { ...s.costModel, elasticity: e } };
    const p = plan(sc), pn = plan(sc, { discounts: false });
    return { elasticity: e, plan: evaluate(p, sc), planNoDisc: evaluate(pn, sc), best: strongestBaseline(sc), smartDisc: evaluate(baselineSmartDiscount(sc), sc), discounts: p.discounts.length };
  });
}

export function elasticitySweep(scenarios, levels = [0.5, 1.0, 1.5]) {
  const per = levels.map(() => []);
  for (const sc of scenarios) sweepScenario(sc, levels).forEach((r, i) => per[i].push(r));
  const out = levels.map((e, i) => {
    const R = per[i]; const pn = mean(R.map(r => r.plan.net)), bn = mean(R.map(r => r.best.m.net)), nd = mean(R.map(r => r.planNoDisc.net));
    return {
      elasticity: e, planNet: pn, planNoDiscNet: nd, bestBaseNet: bn, smartDiscNet: mean(R.map(r => r.smartDisc.net)),
      upliftPct: (pn / bn - 1) * 100, upliftNoDiscPct: (nd / bn - 1) * 100,
      winRate: R.filter(r => r.plan.net > r.best.m.net + 1e-6).length / R.length,
      neverLoseRate: R.filter(r => r.plan.net >= r.best.m.net - 1e-6).length / R.length,
      planUnsoldRate: mean(R.map(r => r.plan.unsoldRate)), bestBaseUnsoldRate: mean(R.map(r => r.best.m.unsoldRate)),
      planTrueSpoiledKg: mean(R.map(r => r.plan.trueSpoiledKg)), bestBaseTrueSpoiledKg: mean(R.map(r => r.best.m.trueSpoiledKg)),
      planCarryKg: mean(R.map(r => r.plan.carryKg)), bestBaseCarryKg: mean(R.map(r => r.best.m.carryKg)),
      planViolationSeeds: R.filter(r => r.plan.violations.length > 0).length,
      seedMinUpliftPct: Math.min(...R.map(r => (r.plan.net / r.best.m.net - 1) * 100)), seedMaxUpliftPct: Math.max(...R.map(r => (r.plan.net / r.best.m.net - 1) * 100)),
      discountCellsMean: mean(R.map(r => r.discounts)), n: R.length,
    };
  });
  return { levels: out, conservative: out.reduce((a, b) => (b.upliftPct < a.upliftPct ? b : a)) };
}
