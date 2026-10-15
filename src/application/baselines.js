import { arrivalLife, shipFeasible, evaluate, effectiveDemand } from '../domain/simulator.js';

function dispatch(scenario, orderDests, name) {
  const left = new Map(scenario.destinations.map(d => [d.id, d.laneCapacity]));
  const shipments = [];
  for (const b of scenario.batches) { // FIFO by batch id, shelf life and demand are NOT consulted
    let rest = b.qty;
    for (const d of orderDests(b)) {
      const q = Math.min(rest, left.get(d.id)); if (q <= 0) continue;
      shipments.push({ batchId: b.id, destId: d.id, qty: q, commodity: b.commodity, lifeAtDeparture: b.life, lifeAtArrival: arrivalLife(b, d, scenario) });
      left.set(d.id, left.get(d.id) - q); rest -= q; if (rest <= 0) break;
    }
  }
  return { name, shipments, discounts: [] };
}
export const baselineFifoNearest = (s) => { const ds = [...s.destinations].filter(d => !d.closed).sort((a, b) => a.travelDays - b.travelDays); return dispatch(s, () => ds, 'FIFO to nearest market'); };
export const baselinePriceGreedy = (s) => dispatch(s, (b) => [...s.destinations].filter(d => !d.closed).sort((a, c) => c.price[b.commodity] - a.price[b.commodity]), 'FIFO to highest price');

/** Strong baseline: what a careful dispatcher does by hand. Urgent batch first, best unit margin among feasible markets that still have demand and lane room. No global optimisation, no discounts. */
function smartCore(s) {
  const lane = new Map(s.destinations.map(d => [d.id, d.laneCapacity]));
  const dem = new Map(); for (const d of s.destinations) for (const c of Object.keys(d.demand)) dem.set(d.id + '|' + c, d.demand[c]);
  const shipments = []; const restByBatch = new Map(); const order = [...s.batches].sort((x, y) => x.life - y.life);
  const feasibleMarkets = (b) => s.destinations.filter(d => !d.closed && shipFeasible(b, d, s))
    .sort((x, y) => (y.price[b.commodity] - y.costPerKg) - (x.price[b.commodity] - x.costPerKg));
  for (const b of order) {
    let rest = b.qty;
    for (const d of feasibleMarkets(b)) {
      const q = Math.min(rest, lane.get(d.id), dem.get(d.id + '|' + b.commodity));
      if (q <= 0) continue;
      shipments.push({ batchId: b.id, destId: d.id, qty: q, commodity: b.commodity, lifeAtDeparture: b.life, lifeAtArrival: arrivalLife(b, d, s) });
      lane.set(d.id, lane.get(d.id) - q); dem.set(d.id + '|' + b.commodity, dem.get(d.id + '|' + b.commodity) - q); rest -= q; if (rest <= 0) break;
    }
    restByBatch.set(b.id, rest);
  }
  return { shipments, lane, dem, restByBatch, order, feasibleMarkets };
}
export function baselineSmartGreedy(s) {
  return { name: 'Urgent-first, best-margin dispatcher', shipments: smartCore(s).shipments, discounts: [] };
}

export const SIMPLE_DISCOUNT = 0.3;
/** Same dispatcher plus the one rule a manager would add: stock left after demand is filled goes out at a flat 30% off to the best-margin feasible market that still has lane room, up to the demand the assumed elasticity creates. */
export function baselineSmartDiscount(s) {
  const { shipments, lane, restByBatch, order, feasibleMarkets } = smartCore(s);
  const e = s.costModel.elasticity; const cellRoom = new Map(); const discounted = new Set();
  const shipped = new Map(); for (const x of shipments) shipped.set(x.destId + '|' + x.commodity, (shipped.get(x.destId + '|' + x.commodity) || 0) + x.qty);
  for (const b of order) {
    let rest = restByBatch.get(b.id);
    for (const d of feasibleMarkets(b)) {
      if (rest <= 0) break;
      const k = d.id + '|' + b.commodity;
      if (!cellRoom.has(k)) cellRoom.set(k, effectiveDemand(d.demand[b.commodity], SIMPLE_DISCOUNT, e) - (shipped.get(k) || 0));
      const q = Math.floor(Math.min(rest, lane.get(d.id), cellRoom.get(k)));
      if (q <= 0) continue;
      shipments.push({ batchId: b.id, destId: d.id, qty: q, commodity: b.commodity, lifeAtDeparture: b.life, lifeAtArrival: arrivalLife(b, d, s) });
      lane.set(d.id, lane.get(d.id) - q); cellRoom.set(k, cellRoom.get(k) - q); rest -= q; discounted.add(k);
    }
  }
  const discounts = [...discounted].sort().map(k => { const [destId, commodity] = k.split('|'); return { destId, commodity, pct: SIMPLE_DISCOUNT }; });
  return { name: 'Dispatcher + flat 30% surplus discount', shipments, discounts };
}

/** Strongest baseline on this scenario = best net among all four. */
export function strongestBaseline(s) {
  const all = [baselineFifoNearest, baselinePriceGreedy, baselineSmartGreedy, baselineSmartDiscount].map(f => { const b = f(s); return { name: b.name, plan: b, m: evaluate(b, s) }; });
  const best = all.slice().sort((a, b) => b.m.net - a.m.net)[0];
  return { ...best, all };
}
