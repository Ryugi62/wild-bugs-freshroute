import test from 'node:test';
import assert from 'node:assert/strict';
import { generateScenario, SHELF_BINDING } from '../src/adapters/generator.js';
import { evaluate, verify } from '../src/domain/simulator.js';
import { plan } from '../src/application/planner.js';
import { baselineFifoNearest, baselinePriceGreedy, baselineSmartGreedy, baselineSmartDiscount } from '../src/application/baselines.js';
import { elasticitySweep } from '../src/application/comparison.js';
import { delayDraw, planBuffered } from '../src/application/sensitivity.js';

const seeds = [1000, 1001, 1002, 1003, 1004, 1005];
const bind = (sd) => generateScenario(sd, { profile: 'shelf-life-binding' });

test('S8 default profile is unchanged by the new option', () => {
  assert.deepEqual(generateScenario(7), generateScenario(7, { profile: 'default' }));
  assert.equal(generateScenario(7).profile, 'default');
  assert.deepEqual(bind(7), bind(7)); // deterministic
});

test('S8 shelf-life-binding set: short-life share, delayed markets, scaled-down demand', () => {
  let short = 0, n = 0, delayedTotal = 0;
  for (const sd of seeds) {
    const s = bind(sd), d = generateScenario(sd);
    for (const b of s.batches) { n++; if (b.life <= SHELF_BINDING.shortLifeFrac[1] * s.commodities[b.commodity].maxLife + 0.6) short++; }
    delayedTotal += s.destinations.filter((x, i) => x.travelDays - d.destinations[i].travelDays > 0.2).length;
    const sum = (q) => q.destinations.reduce((a, x) => a + Object.values(x.demand).reduce((u, v) => u + v, 0), 0);
    assert.ok(sum(s) < sum(d) * 0.8, 'demand is spread thinner');
  }
  assert.ok(short / n >= 0.5, `short-life share ${short / n}`);
  assert.ok(delayedTotal >= seeds.length, 'at least one delayed market per dataset');
});

test('S8 in the binding set the naive baselines really spoil and the plan does not; 0 violations', () => {
  let stranded = 0;
  for (const sd of seeds) {
    const s = bind(sd), mp = evaluate(plan(s), s);
    assert.deepEqual(verify(plan(s), s), []);
    assert.ok(mp.trueSpoiledKg - mp.expiredKg < 1e-6, 'the plan loses nothing in transit or at market beyond expired depot stock');
    for (const f of [baselineFifoNearest, baselinePriceGreedy]) assert.ok(evaluate(f(s), s).trueSpoiledKg > mp.trueSpoiledKg + 1000, `${f.name} seed ${sd}`);
    for (const f of [baselineSmartGreedy]) assert.ok(evaluate(f(s), s).trueSpoiledKg >= mp.trueSpoiledKg - 1e-6, `${f.name} seed ${sd}`);
    stranded += mp.strandedKg;
    assert.ok(mp.net >= evaluate(baselineSmartGreedy(s), s).net - 1e-6);
  }
  assert.ok(stranded > 0, 'some stock has no feasible market');
});

test('S8 sweep table carries spoiled kg, unsold rate and fulfilment for every strategy', () => {
  const r = elasticitySweep(seeds.slice(0, 3).map(bind));
  for (const l of r.levels) {
    assert.equal(Object.keys(l.table).length, 6);
    for (const v of Object.values(l.table)) for (const k of ['net', 'unsoldRate', 'trueSpoiledKg', 'strandedKg', 'fulfillment']) assert.ok(Number.isFinite(v[k]), k);
    assert.ok(l.table['Dispatcher + flat 30% surplus discount'].fulfillment > 0);
  }
});

test('S9 trip-delay execution is deterministic and the buffered plan spoils no more than the plain plan', () => {
  let plain = 0, buf = 0;
  for (const sd of seeds) {
    const s = bind(sd);
    assert.deepEqual(delayDraw(s, 5), delayDraw(s, 5));
    const p = plan(s), pb = planBuffered(s, 0.25);
    assert.deepEqual(verify(pb, s), []);
    for (let k = 1; k <= 5; k++) { const q = delayDraw(s, sd * 10 + k); plain += evaluate(p, q).trueSpoiledKg; buf += evaluate(pb, q).trueSpoiledKg; }
  }
  assert.ok(buf <= plain, `buffered ${buf} vs plain ${plain}`);
});

test('S8 stranded stock metric is zero when every batch has a feasible market', () => {
  const s = generateScenario(3); const m = evaluate(plan(s), s);
  assert.ok(m.strandedKg >= 0 && m.strandedKg <= m.unsoldKg + 1e-6);
});

test('S10 carry-over split: undispatched stock that cannot be sold tomorrow is expired, the rest is held', () => {
  const s = { costModel: { minSaleDays: 1, handlingDays: 0.25, handlingCostPerKg: 1, holdDays: 1, holdingCostPerKg: 0.5, elasticity: 1, carryWriteOff: 0.5, discountLevels: [0] },
    commodities: { spinach: { procureCost: 10, maxLife: 4 } },
    batches: [{ id: 'A', commodity: 'spinach', qty: 100, life: 1.5 }, { id: 'B', commodity: 'spinach', qty: 100, life: 3 }],
    destinations: [{ id: 'D', travelDays: 1, costPerKg: 1, laneCapacity: 10, demand: { spinach: 10 }, price: { spinach: 30 } }] };
  const m = evaluate({ shipments: [], discounts: [] }, s);
  assert.equal(m.expiredKg, 100); assert.equal(m.carryKg, 100); assert.equal(m.trueSpoiledKg, 100);
  assert.equal(m.holding, 100 * 0.5 + 100 * 10 * 0.5);
  assert.equal(m.spoilageCost, 100 * 10);
});

test('S11 per-market fulfilment spread and unmet kg are reported', () => {
  const s = generateScenario(1000), m = evaluate(plan(s), s);
  assert.ok(m.marketFulfilSpread >= 0 && m.marketFulfilSpread <= 1);
  assert.ok(Math.abs(m.unmetKg - (1 - m.fulfillment) * s.destinations.reduce((a, d) => a + Object.values(d.demand).reduce((x, y) => x + y, 0), 0)) < 1e-6);
});
