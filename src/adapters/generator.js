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
  ['M1', 'Nashik Mandi', 0.3, 2, 1800], ['M2', 'Pune APMC', 0.8, 3.5, 3000], ['M3', 'Mumbai Vashi', 1.2, 5, 4200],
  ['M4', 'Surat Market', 1.8, 6.5, 3000], ['M5', 'Ahmedabad Jamalpur', 2.6, 8.5, 2600], ['M6', 'Indore Choithram', 2.2, 7.5, 2200],
];
export function generateScenario(seed, opts = {}) {
  const r = rng(seed); const rf = (a, b) => a + (b - a) * r(); const pick = (a) => a[Math.floor(r() * a.length)];
  const names = Object.keys(COMMODITIES);
  const nBatches = opts.batches || 26;
  const batches = [];
  for (let i = 1; i <= nBatches; i++) {
    const c = pick(names); const m = COMMODITIES[c];
    batches.push({ id: `B${String(i).padStart(2, '0')}`, commodity: c, qty: Math.round(rf(200, 1100) / 10) * 10, life: Math.round(rf(0.35, 1) * m.maxLife * 10) / 10 + 0.5 });
  }
  const destinations = MARKETS.map(([id, name, travelDays, costPerKg, cap]) => {
    const demand = {}, price = {};
    for (const c of names) {
      demand[c] = Math.round(rf(150, 900) * (cap / 3000) / 10) * 10;
      price[c] = Math.round(COMMODITIES[c].basePrice * rf(0.8, 1.3) * 10) / 10;
    }
    return { id, name, travelDays: Math.round(travelDays * rf(0.9, 1.15) * 100) / 100, costPerKg: Math.round(costPerKg * rf(0.9, 1.15) * 10) / 10, laneCapacity: Math.round(cap * rf(0.8, 1.1) / 10) * 10, demand, price };
  });
  return {
    seed, name: `Seed ${seed}`, depot: 'Nashik hub',
    costModel: { minSaleDays: 1, handlingDays: 0.25, handlingCostPerKg: 1.2, holdDays: 1, holdingCostPerKg: 0.6, carryWriteOff: 0.5, elasticity: 1.5, discountLevels: [0, 0.1, 0.2, 0.3] },
    commodities: Object.fromEntries(names.map(c => [c, { procureCost: COMMODITIES[c].procureCost, maxLife: COMMODITIES[c].maxLife }])),
    batches, destinations,
  };
}
