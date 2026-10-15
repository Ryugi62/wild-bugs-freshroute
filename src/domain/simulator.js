// Domain: pure functions, no I/O. Units: kg, days, INR.
export const key = (d, c) => `${d}|${c}`;

export function arrivalLife(batch, dest, scenario) {
  return round3(batch.life - dest.travelDays - scenario.costModel.handlingDays);
}
/** Delivery window: the market accepts arrivals only up to deliveryWindowDays after dispatch (travel + handling). No window = always open. */
export function deliveryOk(dest, scenario) {
  if (!(dest.deliveryWindowDays > 0)) return true;
  return round3(dest.travelDays + scenario.costModel.handlingDays) <= dest.deliveryWindowDays;
}
export const shipFeasible = (batch, dest, scenario) => arrivalLife(batch, dest, scenario) >= scenario.costModel.minSaleDays && deliveryOk(dest, scenario);
const round3 = (x) => Math.round(x * 1000) / 1000;

export function discountMap(plan) {
  const m = new Map();
  for (const d of plan.discounts || []) m.set(key(d.destId, d.commodity), d.pct);
  return m;
}
export const effectiveDemand = (base, pct, elasticity) => base * (1 + elasticity * pct);

/** Hard-constraint check: stock, lane capacity, shelf-life window, delivery window. */
export function verify(plan, scenario) {
  const out = [];
  const batches = new Map(scenario.batches.map(b => [b.id, b]));
  const dests = new Map(scenario.destinations.map(d => [d.id, d]));
  const perBatch = new Map(); const perDest = new Map();
  for (const s of plan.shipments) {
    const b = batches.get(s.batchId); const d = dests.get(s.destId);
    if (!b || !d) { out.push({ type: 'unknown_ref', batchId: s.batchId, destId: s.destId }); continue; }
    perBatch.set(b.id, (perBatch.get(b.id) || 0) + s.qty);
    perDest.set(d.id, (perDest.get(d.id) || 0) + s.qty);
    if (arrivalLife(b, d, scenario) < scenario.costModel.minSaleDays) out.push({ type: 'shelf_life', batchId: b.id, destId: d.id });
    if (!deliveryOk(d, scenario)) out.push({ type: 'delivery_window', batchId: b.id, destId: d.id });
  }
  for (const [id, q] of perBatch) if (q > batches.get(id).qty + 1e-9) out.push({ type: 'stock', batchId: id });
  for (const [id, q] of perDest) if (q > dests.get(id).laneCapacity + 1e-9) out.push({ type: 'lane_capacity', destId: id });
  return out;
}

/** Simulate one dispatch round and return the economics. Unsold stock = out-of-window or late shipments + unsold arrivals + undispatched stock (expiring = real spoilage, still fresh = carry-over written off). */
export function evaluate(plan, scenario) {
  const cm = scenario.costModel;
  const batches = new Map(scenario.batches.map(b => [b.id, b]));
  const dests = new Map(scenario.destinations.map(d => [d.id, d]));
  const disc = discountMap(plan);
  const violations = verify(plan, scenario);
  let transport = 0, handling = 0, spoilageCost = 0, spoiledKg = 0, revenue = 0, sold = 0, carryKg = 0, holding = 0;
  const pool = new Map(); // dest|commodity -> sellable kg
  const shippedByBatch = new Map();
  const laneUsed = new Map();
  for (const s of plan.shipments) {
    const b = batches.get(s.batchId); const d = dests.get(s.destId);
    if (!b || !d) continue;
    // stock and lane overflow are rejected at the dock (counts as spoiled in the violation list)
    const stockLeft = b.qty - (shippedByBatch.get(b.id) || 0);
    const laneLeft = d.laneCapacity - (laneUsed.get(d.id) || 0);
    const q = Math.max(0, Math.min(s.qty, stockLeft, laneLeft));
    shippedByBatch.set(b.id, (shippedByBatch.get(b.id) || 0) + q);
    laneUsed.set(d.id, (laneUsed.get(d.id) || 0) + q);
    transport += q * d.costPerKg; handling += q * cm.handlingCostPerKg;
    if (d.closed || !shipFeasible(b, d, scenario)) {
      spoiledKg += q; spoilageCost += q * scenario.commodities[b.commodity].procureCost;
    } else {
      const k = key(d.id, b.commodity); pool.set(k, (pool.get(k) || 0) + q);
    }
  }
  const perCell = [];
  let baseDemandTotal = 0, fulfilledTotal = 0;
  for (const d of scenario.destinations) for (const c of Object.keys(d.demand)) {
    const base = d.demand[c]; baseDemandTotal += base;
    const pct = disc.get(key(d.id, c)) || 0;
    const dem = d.closed ? 0 : effectiveDemand(base, pct, cm.elasticity);
    const avail = pool.get(key(d.id, c)) || 0;
    const q = Math.min(avail, dem);
    sold += q; fulfilledTotal += Math.min(q, base);
    revenue += q * d.price[c] * (1 - pct);
    const unsold = avail - q;
    if (unsold > 0) { spoiledKg += unsold; spoilageCost += unsold * scenario.commodities[c].procureCost; }
    perCell.push({ destId: d.id, commodity: c, demand: base, demandEff: dem, arrived: avail, sold: q, unsold, pct });
  }
  let totalStock = 0;
  for (const b of scenario.batches) {
    totalStock += b.qty;
    const left = b.qty - (shippedByBatch.get(b.id) || 0);
    if (left <= 1e-9) continue;
    if (b.life <= cm.holdDays) { spoiledKg += left; spoilageCost += left * scenario.commodities[b.commodity].procureCost; }
    else { // undispatched but still fresh: counted as unsold at round end and written off at carryWriteOff of procurement value
      carryKg += left; spoiledKg += left;
      holding += left * cm.holdingCostPerKg + left * scenario.commodities[b.commodity].procureCost * (cm.carryWriteOff ?? 0.5);
    }
  }
  const net = revenue - transport - handling - spoilageCost - holding;
  return {
    revenue, transport, handling, spoilageCost, holding, net,
    soldKg: sold, spoiledKg, unsoldKg: spoiledKg, carryKg, trueSpoiledKg: spoiledKg - carryKg, totalStock,
    unsoldRate: totalStock ? spoiledKg / totalStock : 0,
    fulfillment: baseDemandTotal ? fulfilledTotal / baseDemandTotal : 1,
    violations, perCell,
  };
}
