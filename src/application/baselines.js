import { arrivalLife } from '../domain/simulator.js';

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
export function baselineSmartGreedy(s) {
  const cm = s.costModel; const lane = new Map(s.destinations.map(d => [d.id, d.laneCapacity]));
  const dem = new Map(); for (const d of s.destinations) for (const c of Object.keys(d.demand)) dem.set(d.id + '|' + c, d.demand[c]);
  const shipments = [];
  for (const b of [...s.batches].sort((x, y) => x.life - y.life)) {
    let rest = b.qty;
    const opts = s.destinations.filter(d => !d.closed && arrivalLife(b, d, s) >= cm.minSaleDays)
      .sort((x, y) => (y.price[b.commodity] - y.costPerKg) - (x.price[b.commodity] - x.costPerKg));
    for (const d of opts) {
      const q = Math.min(rest, lane.get(d.id), dem.get(d.id + '|' + b.commodity));
      if (q <= 0) continue;
      shipments.push({ batchId: b.id, destId: d.id, qty: q, commodity: b.commodity, lifeAtDeparture: b.life, lifeAtArrival: arrivalLife(b, d, s) });
      lane.set(d.id, lane.get(d.id) - q); dem.set(d.id + '|' + b.commodity, dem.get(d.id + '|' + b.commodity) - q); rest -= q; if (rest <= 0) break;
    }
  }
  return { name: 'Urgent-first, best-margin dispatcher', shipments, discounts: [] };
}
