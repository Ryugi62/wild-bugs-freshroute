import { evaluate } from '../domain/simulator.js';
import { plan } from './planner.js';
import { strongestBaseline, baselineSmartDiscount } from './baselines.js';

const minNonNull = (xs) => { const v = xs.filter(x => x !== null); return v.length ? Math.min(...v) : null; };
const maxNonNull = (xs) => { const v = xs.filter(x => x !== null); return v.length ? Math.max(...v) : null; };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Uplift definition (SPEC S2): percent only when the baseline net is > 0, otherwise null; the absolute INR difference is always defined. */
export const upliftPctOrNull = (planNet, baseNet) => (baseNet > 0 ? (planNet / baseNet - 1) * 100 : null);
export const upliftAbs = (planNet, baseNet) => planNet - baseNet;

/** One shared cost model, one row per price-elasticity assumption. The headline is the most conservative uplift over the sweep. */
export function sweepScenario(s, levels = [0.5, 1.0, 1.5]) {
  return levels.map(e => {
    const sc = { ...s, costModel: { ...s.costModel, elasticity: e } };
    const p = plan(sc), pn = plan(sc, { discounts: false });
    const best = strongestBaseline(sc);
    return { elasticity: e, plan: evaluate(p, sc), planNoDisc: evaluate(pn, sc), best, smartDisc: evaluate(baselineSmartDiscount(sc), sc), discounts: p.discounts.length, all: best.all };
  });
}

export function elasticitySweep(scenarios, levels = [0.5, 1.0, 1.5]) {
  const per = levels.map(() => []);
  for (const sc of scenarios) sweepScenario(sc, levels).forEach((r, i) => per[i].push(r));
  const out = levels.map((e, i) => {
    const R = per[i]; const pn = mean(R.map(r => r.plan.net)), bn = mean(R.map(r => r.best.m.net)), nd = mean(R.map(r => r.planNoDisc.net));
    const strat = (get) => ({ net: mean(R.map(r => get(r).net)), unsoldRate: mean(R.map(r => get(r).unsoldRate)), trueSpoiledKg: mean(R.map(r => get(r).trueSpoiledKg)), strandedKg: mean(R.map(r => get(r).strandedKg)), expiredKg: mean(R.map(r => get(r).expiredKg)), unmetKg: mean(R.map(r => get(r).unmetKg)), marketSpread: mean(R.map(r => get(r).marketFulfilSpread)), fulfillment: mean(R.map(r => get(r).fulfillment)) });
    const table = { 'FreshRoute plan': strat(r => r.plan), 'FreshRoute, no discounts': strat(r => r.planNoDisc) };
    R[0].all.forEach((a, k) => { table[a.name] = strat(r => r.all[k].m); });
    table['Strongest baseline, chosen per dataset'] = strat(r => r.best.m);
    return {
      table, elasticity: e, planNet: pn, planNoDiscNet: nd, bestBaseNet: bn, smartDiscNet: mean(R.map(r => r.smartDisc.net)),
      upliftPct: upliftPctOrNull(pn, bn), upliftNoDiscPct: upliftPctOrNull(nd, bn), upliftAbsInr: pn - bn,
      winRate: R.filter(r => r.plan.net > r.best.m.net + 1e-6).length / R.length,
      neverLoseRate: R.filter(r => r.plan.net >= r.best.m.net - 1e-6).length / R.length,
      planUnsoldRate: mean(R.map(r => r.plan.unsoldRate)), bestBaseUnsoldRate: mean(R.map(r => r.best.m.unsoldRate)),
      planTrueSpoiledKg: mean(R.map(r => r.plan.trueSpoiledKg)), bestBaseTrueSpoiledKg: mean(R.map(r => r.best.m.trueSpoiledKg)),
      planCarryKg: mean(R.map(r => r.plan.carryKg)), bestBaseCarryKg: mean(R.map(r => r.best.m.carryKg)),
      planViolationSeeds: R.filter(r => r.plan.violations.length > 0).length,
      seedMinUpliftPct: minNonNull(R.map(r => upliftPctOrNull(r.plan.net, r.best.m.net))), seedMaxUpliftPct: maxNonNull(R.map(r => upliftPctOrNull(r.plan.net, r.best.m.net))),
      seedMinDiffInr: Math.min(...R.map(r => upliftAbs(r.plan.net, r.best.m.net))), seedMaxDiffInr: Math.max(...R.map(r => upliftAbs(r.plan.net, r.best.m.net))),
      seedsWithNonPositiveBaseline: R.filter(r => !(r.best.m.net > 0)).length,
      meanPerSeedBestNet: bn,
      discountCellsMean: mean(R.map(r => r.discounts)), n: R.length,
    };
  });
  return { levels: out, conservative: out.reduce((a, b) => ((b.upliftPct ?? -Infinity) < (a.upliftPct ?? -Infinity) ? b : a)) };
}
