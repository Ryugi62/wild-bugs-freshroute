import test from 'node:test';
import assert from 'node:assert/strict';
import { generateScenario } from '../src/adapters/generator.js';
import { evaluate, arrivalLife, verify } from '../src/domain/simulator.js';

const tiny = () => ({
  costModel: { minSaleDays: 1, handlingDays: 0.25, handlingCostPerKg: 1, holdDays: 1, holdingCostPerKg: 0.5, elasticity: 1.5 },
  commodities: { tomato: { procureCost: 10, maxLife: 6 } },
  batches: [{ id: 'B1', commodity: 'tomato', qty: 100, life: 3 }, { id: 'B2', commodity: 'tomato', qty: 100, life: 1.2 }],
  destinations: [{ id: 'D1', travelDays: 1, costPerKg: 2, laneCapacity: 150, demand: { tomato: 80 }, price: { tomato: 30 } }],
});

test('AC1 arrival life = life - travel - handling', () => {
  const s = tiny();
  assert.equal(arrivalLife(s.batches[0], s.destinations[0], s), 1.75);
  assert.ok(arrivalLife(s.batches[1], s.destinations[0], s) < s.costModel.minSaleDays);
});

test('evaluate: sold capped by demand, unsold counts as spoiled', () => {
  const s = tiny();
  const m = evaluate({ shipments: [{ batchId: 'B1', destId: 'D1', qty: 100 }], discounts: [] }, s);
  assert.equal(m.soldKg, 80);
  assert.equal(m.spoiledKg >= 20, true);
  assert.equal(m.revenue, 80 * 30);
  assert.equal(m.violations.length, 0);
});

test('AC2 verifier flags lane overflow, stock overflow, shelf-life', () => {
  const s = tiny();
  const v = verify({ shipments: [
    { batchId: 'B1', destId: 'D1', qty: 120 },
    { batchId: 'B2', destId: 'D1', qty: 100 },
  ], discounts: [] }, s).map(x => x.type).sort();
  assert.deepEqual(v, ['lane_capacity', 'shelf_life', 'stock']);
});

test('discount raises demand by elasticity and lowers price', () => {
  const s = tiny();
  const base = evaluate({ shipments: [{ batchId: 'B1', destId: 'D1', qty: 100 }], discounts: [] }, s);
  const disc = evaluate({ shipments: [{ batchId: 'B1', destId: 'D1', qty: 100 }], discounts: [{ destId: 'D1', commodity: 'tomato', pct: 0.2 }] }, s);
  assert.equal(disc.soldKg, 100);
  assert.ok(disc.revenue > base.revenue);
});

test('S7 generator is deterministic and varies by seed', () => {
  assert.deepEqual(generateScenario(7), generateScenario(7));
  assert.notDeepEqual(generateScenario(7).batches, generateScenario(8).batches);
  const g = generateScenario(1);
  assert.ok(g.batches.length >= 20 && g.destinations.length >= 5);
});
