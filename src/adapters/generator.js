// Seeded synthetic dataset (adapter). Mirrors the PS03 dataset shape: batches, shelf life, demand, prices, travel, cost, capacity.
function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const COMMODITIES = {
  spinach: { procureCost: 18, maxLife: 4, basePrice: 42 },
  tomato:  { procureCost: 14, maxLife: 7, basePrice: 30 },
  banana:  { procureCost: 22, maxLife: 6, basePrice: 40 },
  mango:   { procureCost: 45, maxLife: 8, basePrice: 95 },
  onion:   { procureCost: 12, maxLife: 25, basePrice: 28 },
};
const MARKETS = [
  ['M1', 'Nashik Mandi', 0.3, 2, 1800, 1.0], ['M2', 'Pune APMC', 0.8, 3.5, 3000, 1.5], ['M3', 'Mumbai Vashi', 1.2, 5, 4200, 1.9],
  ['M4', 'Surat Market', 1.8, 6.5, 3000, 2.2], ['M5', 'Ahmedabad Jamalpur', 2.6, 8.5, 2600, 3.0], ['M6', 'Indore Choithram', 2.2, 7.5, 2200, 2.5],
];
/** Profiles. 'default' is the original generator (unchanged, same seeds give the same data). 'shelf-life-binding' is the stress set where shelf life is the real constraint. Parameters are published in README. */
export const SHELF_BINDING = { shortShare: 0.6, shortLifeFrac: [0.2, 0.45], longLifeFrac: [0.5, 1], delayedMarkets: 2, knownDelayDays: [0.4, 0.9], demandScale: 0.6, demandRange: [60, 520] };
export function generateScenario(seed, opts = {}) {
  const P = opts.profile === 'shelf-life-binding' ? SHELF_BINDING : null;
  const r = rng(seed); const rf = (a, b) => a + (b - a) * r(); const pick = (a) => a[Math.floor(r() * a.length)];
  const names = Object.keys(COMMODITIES);
  const nBatches = opts.batches || 26;
  const batches = [];
  for (let i = 1; i <= nBatches; i++) {
    const c = pick(names); const m = COMMODITIES[c];
    const frac = P ? (r() < P.shortShare ? rf(...P.shortLifeFrac) : rf(...P.longLifeFrac)) : rf(0.35, 1);
    batches.push({ id: `B${String(i).padStart(2, '0')}`, commodity: c, qty: Math.round(rf(200, 1100) / 10) * 10, life: Math.round(frac * m.maxLife * 10) / 10 + 0.5 });
  }
  const delayed = new Set(); if (P) { const ids = MARKETS.map(m => m[0]); while (delayed.size < P.delayedMarkets) delayed.add(pick(ids)); }
  const destinations = MARKETS.map(([id, name, travelDays, costPerKg, cap, deliveryWindowDays]) => {
    const demand = {}, price = {};
    for (const c of names) {
      demand[c] = P ? Math.round(rf(...P.demandRange) * (cap / 3000) / 10) * 10 : Math.round(rf(150, 900) * (cap / 3000) / 10) * 10;
      price[c] = Math.round(COMMODITIES[c].basePrice * rf(0.8, 1.3) * 10) / 10;
    }
    const lag = P && delayed.has(id) ? rf(...P.knownDelayDays) : 0; // known transport delay on some lanes, already in travelDays
    return { id, name, travelDays: Math.round((travelDays * rf(0.9, 1.15) + lag) * 100) / 100, costPerKg: Math.round(costPerKg * rf(0.9, 1.15) * 10) / 10, laneCapacity: Math.round(cap * rf(0.8, 1.1) / 10) * 10, deliveryWindowDays, demand, price };
  });
  return {
    seed, profile: P ? 'shelf-life-binding' : 'default', name: `${P ? 'Shelf-life ' : ''}Seed ${seed}`, depot: 'Nashik hub',
    costModel: { minSaleDays: 1, handlingDays: 0.25, handlingCostPerKg: 1.2, holdDays: 1, holdingCostPerKg: 0.6, carryWriteOff: 0.5, elasticity: 0.5, discountLevels: [0, 0.1, 0.2, 0.3] },
    commodities: Object.fromEntries(names.map(c => [c, { procureCost: COMMODITIES[c].procureCost, maxLife: COMMODITIES[c].maxLife }])),
    batches, destinations,
  };
}
