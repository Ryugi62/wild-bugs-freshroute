import test from 'node:test';
import assert from 'node:assert/strict';
import { generateScenario } from '../src/adapters/generator.js';
import { evaluate, verify, deliveryOk } from '../src/domain/simulator.js';
import { plan } from '../src/application/planner.js';
import { baselineSmartGreedy, baselineSmartDiscount, strongestBaseline } from '../src/application/baselines.js';
import { elasticitySweep } from '../src/application/comparison.js';
import { sensitivity } from '../src/application/sensitivity.js';

const tiny = (windowDays) => ({
  costModel: { minSaleDays: 1, handlingDays: 0.25, handlingCostPerKg: 1, holdDays: 1, holdingCostPerKg: 0.5, elasticity: 1.0, carryWriteOff: 0.5, discountLevels: [0, 0.3] },
  commodities: { tomato: { procureCost: 10, maxLife: 6 } },
  batches: [{ id: 'B1', commodity: 'tomato', qty: 100, life: 6 }],
  destinations: [
    { id: 'D1', travelDays: 1, costPerKg: 2, laneCapacity: 500, demand: { tomato: 80 }, price: { tomato: 40 }, deliveryWindowDays: windowDays },
    { id: 'D2', travelDays: 2, costPerKg: 2, laneCapacity: 500, demand: { tomato: 80 }, price: { tomato: 35 } },
  ],
});

test('AC8 delivery window: late arrival is a violation and the planner avoids that market', () => {
  const s = tiny(1.0); // D1 needs travel 1 + handling 0.25 <= 1.0 -> infeasible
  assert.equal(deliveryOk(s.destinations[0], s), false);
  assert.equal(deliveryOk(s.destinations[1], s), true);
  const v = verify({ shipments: [{ batchId: 'B1', destId: 'D1', qty: 50 }], discounts: [] }, s).map(x => x.type);
  assert.deepEqual(v, ['delivery_window']);
  const p = plan(s);
  assert.ok(p.shipments.every(x => x.destId !== 'D1'));
  assert.deepEqual(verify(p, s), []);
  assert.ok(plan(tiny(2.0)).shipments.some(x => x.destId === 'D1'));
});

test('AC8 generator markets carry windows and plans stay violation-free on 10 seeds', () => {
  const g = generateScenario(1);
  assert.ok(g.destinations.every(d => d.deliveryWindowDays > 0));
  for (let seed = 1; seed <= 10; seed++) {
    const s = generateScenario(seed);
    assert.deepEqual(verify(plan(s), s), [], `seed ${seed}`);
    assert.deepEqual(verify(baselineSmartGreedy(s), s), [], `baseline seed ${seed}`);
  }
});

test('S1 honest metric: unsold stock splits into carry-over and real spoilage', () => {
  const s = generateScenario(3);
  const m = evaluate(plan(s), s);
  assert.ok(m.trueSpoiledKg >= 0 && m.carryKg >= 0);
  assert.ok(Math.abs(m.trueSpoiledKg + m.carryKg - m.unsoldKg) < 1e-6);
  assert.ok(Math.abs(m.unsoldRate - m.unsoldKg / m.totalStock) < 1e-9);
});

test('baseline + simple discount: 30% only on cells that receive surplus, feasible, deterministic', () => {
  const s = generateScenario(2); s.costModel.elasticity = 1.5;
  const b = baselineSmartDiscount(s);
  assert.deepEqual(verify(b, s), []);
  assert.ok(b.discounts.length > 0 && b.discounts.every(d => d.pct === 0.3));
  assert.deepEqual(baselineSmartDiscount(s), b);
  assert.ok(b.name.toLowerCase().includes('discount'));
});

test('strongest baseline is the best net among four', () => {
  const s = generateScenario(4);
  const best = strongestBaseline(s);
  assert.equal(best.all.length, 4);
  assert.ok(best.all.every(x => best.m.net >= x.m.net - 1e-9));
});

test('AC9 elasticity sweep: one row per level with plan, no-discount plan, strongest baseline', () => {
  const r = elasticitySweep([1000, 1001, 1002].map(generateScenario), [0.5, 1.0, 1.5]);
  assert.deepEqual(r.levels.map(x => x.elasticity), [0.5, 1.0, 1.5]);
  for (const l of r.levels) {
    for (const k of ['planNet', 'planNoDiscNet', 'bestBaseNet', 'smartDiscNet', 'upliftPct', 'upliftNoDiscPct', 'winRate', 'neverLoseRate', 'planUnsoldRate', 'bestBaseUnsoldRate', 'planTrueSpoiledKg']) assert.ok(Number.isFinite(l[k]), k);
    assert.ok(l.planNet >= l.planNoDiscNet - 1e-6);
  }
  assert.equal(r.conservative.upliftPct, Math.min(...r.levels.map(x => x.upliftPct)));
});

test('discount reasons name the batches feeding the cell', () => {
  const s = generateScenario(2); s.costModel.elasticity = 1.5;
  const p = plan(s);
  assert.ok(p.discounts.length > 0);
  assert.ok(p.discounts.every(d => /\bB\d\d\b/.test(d.reason) && Array.isArray(d.batchIds) && d.batchIds.length > 0));
});

test('S5 stress: plan kept fixed vs strongest baseline kept fixed is reported', () => {
  const s = generateScenario(5);
  const r = sensitivity(s, { draws: 10, seed: 1 });
  assert.ok(r.fixedBeatsBaseline >= 0 && r.fixedBeatsBaseline <= 1);
  assert.ok(r.baselineName.length > 3);
  assert.ok(Number.isFinite(r.replannedOracle.netMean));
});
