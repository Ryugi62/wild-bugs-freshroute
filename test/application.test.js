import test from 'node:test';
import assert from 'node:assert/strict';
import { generateScenario } from '../src/adapters/generator.js';
import { evaluate, verify } from '../src/domain/simulator.js';
import { plan } from '../src/application/planner.js';
import { baselineFifoNearest, baselinePriceGreedy } from '../src/application/baselines.js';
import { perturb, replan, sensitivity } from '../src/application/sensitivity.js';
import { parseScenario } from '../src/adapters/validate.js';

test('S4 planner output has zero violations on 10 seeds', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const s = generateScenario(seed);
    const p = plan(s);
    assert.deepEqual(verify(p, s), [], `seed ${seed}`);
  }
});

test('S2/S1 planner beats both baselines on net and spoilage (dev seeds)', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const s = generateScenario(seed);
    const m = evaluate(plan(s), s);
    for (const b of [baselineFifoNearest(s), baselinePriceGreedy(s)]) {
      const mb = evaluate(b, s);
      assert.ok(m.net > mb.net, `net seed ${seed}`);
      assert.ok(m.spoilageRate < mb.spoilageRate, `spoil seed ${seed}`);
    }
  }
});

test('AC4 shipments ranked most perishable first', () => {
  const s = generateScenario(3);
  const p = plan(s);
  const lives = p.shipments.map(x => x.lifeAtDeparture);
  assert.deepEqual(lives, [...lives].sort((a, b) => a - b));
  assert.equal(p.shipments[0].rank, 1);
});

test('AC3/AC7 discounts and shipments carry reasons; determinism', () => {
  const s = generateScenario(2);
  const p = plan(s);
  assert.ok(p.shipments.every(x => typeof x.reason === 'string' && x.reason.length > 10));
  assert.ok(p.discounts.every(d => d.pct > 0 && d.gain > 0 && d.reason.length > 10));
  assert.deepEqual(plan(s), p);
});

test('no discount in a market where there is no surplus (gain must be positive)', () => {
  const s = generateScenario(2);
  const p = plan(s, { discounts: false });
  assert.equal(p.discounts.length, 0);
});

test('AC5 replan after market closure is feasible and avoids the closed market', () => {
  const s = generateScenario(4);
  const closed = s.destinations[0].id;
  const s2 = perturb(s, { closedDest: closed });
  const p2 = replan(s2);
  assert.deepEqual(verify(p2, s2), []);
  assert.ok(p2.shipments.every(x => x.destId !== closed));
});

test('S5 sensitivity returns stats for baseline, fixed plan, replanned plan', () => {
  const s = generateScenario(5);
  const r = sensitivity(s, { draws: 12, seed: 1 });
  for (const k of ['baseline', 'fixed', 'replanned']) {
    assert.ok(Number.isFinite(r[k].netMean) && Number.isFinite(r[k].netP10) && Number.isFinite(r[k].spoilageMean));
  }
  assert.ok(r.replanned.netMean >= r.baseline.netMean);
});

test('S6 planning is fast', () => {
  const s = generateScenario(9);
  const t = performance.now();
  plan(s);
  assert.ok(performance.now() - t < 2000);
});

test('AC6 parseScenario rejects bad input with cause + fix', () => {
  const bad = parseScenario('{"batches": 3}');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /batches/);
  assert.equal(parseScenario('not json').ok, false);
  const good = parseScenario(JSON.stringify(generateScenario(1)));
  assert.equal(good.ok, true);
});
