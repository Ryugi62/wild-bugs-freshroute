import { generateScenario } from '../adapters/generator.js';
import { parseScenario } from '../adapters/validate.js';
import { evaluate } from '../domain/simulator.js';
import { plan } from '../application/planner.js';
import { baselineFifoNearest, baselinePriceGreedy, baselineSmartGreedy } from '../application/baselines.js';
import { perturb, sensitivity } from '../application/sensitivity.js';

const $ = (id) => document.getElementById(id);
const inr = (x) => (x < 0 ? '-' : '') + '₹' + Math.abs(Math.round(x)).toLocaleString('en-IN');
const pct = (x) => (x * 100).toFixed(1) + '%';
let custom = null;

for (const s of [1, 2, 3, 4, 5]) $('seed').add(new Option(`Dataset ${s} (26 batches, 6 markets)`, String(s)));
$('seed').value = '1';

function applyPreset(s, preset) {
  if (preset === 'heat') return perturb(s, { shelfScale: 0.75 });
  if (preset === 'delay') return perturb(s, { delayDays: 1 });
  if (preset === 'demand') return perturb(s, { demandScale: 0.7 });
  if (preset === 'closed') { const big = [...s.destinations].sort((a, b) => b.laneCapacity - a.laneCapacity)[0]; return perturb(s, { closedDest: big.id }); }
  return s;
}
const name = (s, id) => (s.destinations.find(d => d.id === id) || {}).name || id;

function kpi(big, label, verdict, cls) {
  return `<div class="kpi"><div class="big">${big}</div><div class="name">${label}</div><span class="verdict ${cls}">${verdict}</span></div>`;
}
function render(s, p, mp, bases) {
  const best = bases.slice().sort((a, b) => b.m.net - a.m.net)[0];
  const dNet = mp.net - best.m.net;
  $('kpis').innerHTML =
    kpi(inr(mp.net), 'Net revenue after all costs', `${dNet >= 0 ? '+' : ''}${inr(dNet)} vs ${best.name.toLowerCase()}`, dNet >= 0 ? 'v-ok' : 'v-no') +
    kpi(pct(mp.spoilageRate), 'Spoiled or left unsold', `${pct(best.m.spoilageRate)} with ${best.name.toLowerCase()}`, mp.spoilageRate <= best.m.spoilageRate ? 'v-ok' : 'v-warn') +
    kpi(pct(mp.fulfillment), 'Demand fulfilled', `${pct(best.m.fulfillment)} with ${best.name.toLowerCase()}`, mp.fulfillment >= best.m.fulfillment ? 'v-ok' : 'v-warn');
  const li = (x) => `<li><span class="rank">${x.rank}</span><b>${x.qty} kg ${x.commodity}</b> to ${name(s, x.destId)}<div class="meta">${x.reason}</div></li>`;
  $('ships').innerHTML = p.shipments.slice(0, 6).map(li).join('') || '<li>Nothing is worth shipping today. Try another situation.</li>';
  $('shipsAll').innerHTML = p.shipments.map(li).join('');
  $('moreShips').hidden = p.shipments.length <= 6;
  $('discs').innerHTML = p.discounts.length ? p.discounts.map(d => `<li><b>${Math.round(d.pct * 100)}% off ${d.commodity}</b> at ${name(s, d.destId)}<div class="meta">${d.reason}</div></li>`).join('')
    : '<li>No discount adds money today, so none is recommended.</li>';
  const rows = [['FreshRoute plan', mp], ...bases.map(b => [b.name, b.m])];
  $('cmp').innerHTML = '<tr><th>Strategy</th><th>Net</th><th>Revenue</th><th>Transport+handling</th><th>Spoilage cost</th><th>Spoiled kg</th><th>Fulfilled</th><th>Rule breaks</th></tr>' +
    rows.map(([n, m]) => `<tr><td>${n}</td><td>${inr(m.net)}</td><td>${inr(m.revenue)}</td><td>${inr(m.transport + m.handling)}</td><td>${inr(m.spoilageCost + m.holding)}</td><td>${Math.round(m.spoiledKg)}</td><td>${pct(m.fulfillment)}</td><td>${m.violations.length}</td></tr>`).join('');
  const cm = s.costModel;
  $('assump').innerHTML = `<p><b>Cost model (same for every strategy).</b> Net = revenue − transport − handling − spoilage − carry-over write-off. Spoilage costs the procurement value of the kg lost.</p>
  <pre>${JSON.stringify({ minSaleDays: cm.minSaleDays, handlingDays: cm.handlingDays, handlingCostPerKg: cm.handlingCostPerKg, elasticity: cm.elasticity, carryWriteOff: cm.carryWriteOff ?? 0.5, holdingCostPerKg: cm.holdingCostPerKg, discountLevels: cm.discountLevels }, null, 1)}</pre>
  <ul><li>A shipment is allowed only if shelf life − travel − handling leaves at least ${cm.minSaleDays} day to sell.</li>
  <li>Demand at a market rises by elasticity × discount (10% off adds ${(cm.elasticity * 10).toFixed(0)}% demand). A discount is kept only when the simulation shows it adds net money.</li>
  <li>Stock not dispatched is written off at ${(cm.carryWriteOff ?? 0.5) * 100}% of its procurement value and counted as unsold.</li>
  <li>Planner: max-profit min-cost flow over batch → market and commodity → lane, then a discount search. Baselines: FIFO to nearest market, FIFO to highest price, and an urgent-first best-margin dispatcher.</li>
  <li>Data is synthetic, generated from a seed. It shows how the plan behaves, not real-world performance. Government post-harvest loss figures are context only.</li></ul>`;
}
function renderStress(r) {
  const c = (t, v, sub) => `<div class="kpi"><div class="big">${v}</div><div class="name">${t}</div><span class="verdict v-ok">${sub}</span></div>`;
  $('stress').innerHTML =
    c('Replanned beats baseline', Math.round(r.replanBeatsBaseline * 100) + '%', `${r.draws} bad days`) +
    c('Average net, replanned', inr(r.replanned.netMean), `baseline ${inr(r.baseline.netMean)}`) +
    c('Worst-10% net, plan kept as is', inr(r.fixed.netP10), `baseline ${inr(r.baseline.netP10)}`);
}

function run() {
  $('err').textContent = '';
  $('skeleton').hidden = false; $('result').hidden = true; $('status').textContent = 'Planning…';
  setTimeout(() => {
    try {
      const base = custom || generateScenario(Number($('seed').value));
      const s = applyPreset(base, $('preset').value);
      const t = performance.now();
      const p = plan(s);
      const ms = Math.round(performance.now() - t);
      const mp = evaluate(p, s);
      const bases = [baselineFifoNearest, baselinePriceGreedy, baselineSmartGreedy].map(f => { const b = f(s); return { name: b.name, m: evaluate(b, s) }; });
      render(s, p, mp, bases);
      renderStress(sensitivity(s, { draws: 30, seed: 7 }));
      $('result').hidden = false;
      $('status').textContent = `Done in ${ms} ms. ${p.shipments.length} dispatches, ${mp.violations.length} rule breaks.`;
      window.__freshroute = { net: mp.net, violations: mp.violations.length, shipments: p.shipments.length };
    } catch (e) { $('status').textContent = 'That did not work. Check the dataset and try again.'; }
    $('skeleton').hidden = true;
  }, 30);
}
$('run').addEventListener('click', run);
$('dl').addEventListener('click', () => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(generateScenario(1), null, 1)], { type: 'application/json' })); a.download = 'freshroute-sample.json'; a.click();
});
$('up').addEventListener('change', async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  const r = parseScenario(await f.text());
  if (!r.ok) { $('err').textContent = r.error; return; }
  custom = r.scenario; $('status').textContent = 'Your dataset is loaded.'; run();
});
run();
