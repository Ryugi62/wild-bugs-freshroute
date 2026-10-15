export function parseScenario(text) {
  let s;
  try { s = JSON.parse(text); } catch { return { ok: false, error: 'The file is not valid JSON. Export it from a spreadsheet as JSON or start from the sample.' }; }
  if (!Array.isArray(s.batches) || !s.batches.length) return { ok: false, error: '"batches" must be a non-empty list of {id, commodity, qty, life}.' };
  const need = ['batches', 'destinations', 'commodities', 'costModel'];
  for (const k of need) if (s[k] === undefined || s[k] === null) return { ok: false, error: `The dataset has no "${k}". Add it, or load the sample dataset to see the format.` };
  if (!Array.isArray(s.batches) || !s.batches.length) return { ok: false, error: '"batches" must be a non-empty list of {id, commodity, qty, life}.' };
  if (!Array.isArray(s.destinations) || !s.destinations.length) return { ok: false, error: '"destinations" must be a non-empty list of markets.' };
  for (const b of s.batches) {
    if (!(b.qty > 0) || !(b.life > 0) || !s.commodities[b.commodity]) return { ok: false, error: `Batch ${b.id ?? '?'} needs qty > 0, life > 0 and a commodity listed in "commodities".` };
  }
  for (const d of s.destinations) {
    if (!d.demand || !d.price || !(d.laneCapacity >= 0) || !(d.travelDays >= 0) || !(d.costPerKg >= 0)) return { ok: false, error: `Market ${d.id ?? '?'} needs demand, price, laneCapacity, travelDays and costPerKg.` };
  }
  s.costModel = { discountLevels: [0, 0.1, 0.2, 0.3], ...s.costModel };
  return { ok: true, scenario: s };
}
