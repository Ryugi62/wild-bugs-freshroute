import { Flow } from './mincostflow.js';
import { arrivalLife, evaluate, key, effectiveDemand, shipFeasible, deliveryOk } from '../domain/simulator.js';

const f1 = (x) => (Math.round(x * 10) / 10).toString();

/** Max-profit transportation plan for fixed discounts: batch -> (market, commodity) -> market lane. */
function solve(scenario, disc) {
  const cm = scenario.costModel;
  const B = scenario.batches, D = scenario.destinations.filter(d => !d.closed);
  const cells = [];
  for (const d of D) for (const c of Object.keys(d.demand)) cells.push({ d, c });
  const S = 0, T = 1, bNode = (i) => 2 + i, cNode = (j) => 2 + B.length + j, dNode = (k) => 2 + B.length + cells.length + k;
  const flow = new Flow(2 + B.length + cells.length + D.length);
  B.forEach((b, i) => flow.add(S, bNode(i), b.qty, 0));
  const shipEdges = [];
  B.forEach((b, i) => cells.forEach((cell, j) => {
    if (cell.c !== b.commodity) return;
    const life = arrivalLife(b, cell.d, scenario);
    if (!shipFeasible(b, cell.d, scenario) || cell.d.demand[cell.c] <= 0) return; // AC1: infeasible edges never exist
    // tiny tie-break: the more perishable batch is cheaper, so it wins contested capacity
    const cost = cell.d.costPerKg + cm.handlingCostPerKg + 1e-4 * b.life;
    shipEdges.push({ id: flow.add(bNode(i), cNode(j), b.qty, cost), b, cell, life });
  }));
  cells.forEach((cell, j) => {
    const pct = disc.get(key(cell.d.id, cell.c)) || 0;
    flow.add(cNode(j), dNode(D.indexOf(cell.d)), effectiveDemand(cell.d.demand[cell.c], pct, cm.elasticity), -cell.d.price[cell.c] * (1 - pct));
  });
  D.forEach((d, k) => flow.add(dNode(k), T, d.laneCapacity, 0));
  flow.run(S, T);
  const ships = [];
  for (const se of shipEdges) {
    const q = Math.floor(flow.e[se.id].flow + 1e-6);
    if (q > 0) ships.push({ batchId: se.b.id, destId: se.cell.d.id, qty: q, commodity: se.b.commodity, lifeAtDeparture: se.b.life, lifeAtArrival: se.life });
  }
  return ships;
}

function reasonFor(s, scenario, rankPool) {
  const d = scenario.destinations.find(x => x.id === s.destId);
  const alts = scenario.destinations.filter(x => !x.closed && x.id !== d.id && s.lifeAtDeparture - x.travelDays - scenario.costModel.handlingDays >= scenario.costModel.minSaleDays && deliveryOk(x, scenario)).length;
  const unit = d.price[s.commodity] - d.costPerKg - scenario.costModel.handlingCostPerKg;
  return `${s.commodity} ${s.batchId} has ${f1(s.lifeAtDeparture)}d left, ships ${s.qty} kg to ${d.name || d.id} and arrives with ${f1(s.lifeAtArrival)}d to sell; ~Rs ${f1(unit)}/kg margin before discount, best of ${alts + 1} feasible markets given lane and demand limits.`;
}

export function plan(scenario, opts = {}) {
  const useDisc = opts.discounts !== false;
  const levels = scenario.costModel.discountLevels || [0, 0.1, 0.2, 0.3];
  const disc = new Map();
  const asPlan = (ships) => ({ shipments: ships, discounts: [...disc].map(([k, pct]) => { const [destId, commodity] = k.split('|'); return { destId, commodity, pct }; }).filter(x => x.pct > 0) });
  let ships = solve(scenario, disc);
  let best = evaluate(asPlan(ships), scenario).net;
  if (useDisc) {
    const cells = [];
    for (const d of scenario.destinations) if (!d.closed) for (const c of Object.keys(d.demand)) cells.push(key(d.id, c));
    for (let pass = 0; pass < 2; pass++) for (const k of cells) {
      const cur = disc.get(k) || 0; let bestLevel = cur;
      for (const lv of levels) {
        if (lv === cur) continue;
        disc.set(k, lv);
        const sh = solve(scenario, disc); const n = evaluate(asPlan(sh), scenario).net;
        if (n > best + 1e-6) { best = n; bestLevel = lv; }
      }
      disc.set(k, bestLevel);
    }
    ships = solve(scenario, disc);
  }
  ships.sort((a, b) => a.lifeAtDeparture - b.lifeAtDeparture || a.batchId.localeCompare(b.batchId) || a.destId.localeCompare(b.destId));
  const shipments = ships.map((s, i) => ({ ...s, rank: i + 1, reason: reasonFor(s, scenario) }));
  const base = { shipments, discounts: [] };
  const discounts = [];
  for (const [k, pct] of disc) {
    if (pct <= 0) continue;
    const [destId, commodity] = k.split('|');
    const withD = asPlan(ships); const without = { ...withD, discounts: withD.discounts.filter(x => !(x.destId === destId && x.commodity === commodity)) };
    const gain = evaluate(withD, scenario).net - evaluate(without, scenario).net;
    if (gain <= 1e-6) continue;
    const d = scenario.destinations.find(x => x.id === destId);
    const cell = evaluate(withD, scenario).perCell.find(x => x.destId === destId && x.commodity === commodity);
    const batchIds = [...new Set(ships.filter(x => x.destId === destId && x.commodity === commodity).map(x => x.batchId))].sort();
    discounts.push({ destId, commodity, pct, gain: Math.round(gain), batchIds,
      reason: `${commodity} at ${d.name || d.id}, applies to batches ${batchIds.join(', ')}: supply of ${Math.round(cell.arrived)} kg exceeds base demand ${cell.demand} kg; a ${Math.round(pct * 100)}% discount lifts demand to ${Math.round(cell.demandEff)} kg (assumed elasticity ${scenario.costModel.elasticity}) and adds about Rs ${Math.round(gain)} net.` });
  }
  return { ...base, discounts };
}
