import { generateScenario } from '../adapters/generator.js';
import { parseScenario } from '../adapters/validate.js';
import { evaluate } from '../domain/simulator.js';
import { plan } from '../application/planner.js';
import { strongestBaseline } from '../application/baselines.js';
import { sweepScenario } from '../application/comparison.js';
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
    kpi(pct(mp.unsoldRate), 'Stock left unsold today', `${pct(best.m.unsoldRate)} with ${best.name.toLowerCase()} · really spoiled: ${Math.round(mp.trueSpoiledKg)} kg`, mp.unsoldRate <= best.m.unsoldRate ? 'v-ok' : 'v-warn') +
    kpi(pct(mp.fulfillment), 'Demand fulfilled', `${pct(best.m.fulfillment)} with ${best.name.toLowerCase()}`, mp.fulfillment >= best.m.fulfillment ? 'v-ok' : 'v-warn');
  const li = (x) => `<li><span class="rank">${x.rank}</span><b>${x.qty} kg ${x.commodity}</b> to ${name(s, x.destId)}<div class="meta">${x.reason}</div></li>`;
  $('ships').innerHTML = p.shipments.slice(0, 6).map(li).join('') || '<li>Nothing is worth shipping today. Try another situation.</li>';
  $('shipsAll').innerHTML = p.shipments.map(li).join('');
  $('moreShips').hidden = p.shipments.length <= 6;
  $('discs').innerHTML = p.discounts.length ? p.discounts.map(d => `<li><b>${Math.round(d.pct * 100)}% off ${d.commodity}</b> at ${name(s, d.destId)}<div class="meta">${d.reason}</div></li>`).join('')
    : '<li>No discount adds money today, so none is recommended.</li>';
  const rows = [['FreshRoute plan', mp], ...bases.map(b => [b.name, b.m])];
  $('cmp').innerHTML = '<tr><th>Strategy</th><th>Net</th><th>Revenue</th><th>Transport+handling</th><th>Write-off cost</th><th>Unsold kg</th><th>Really spoiled kg</th><th>Fulfilled</th><th>Rule breaks</th></tr>' +
    rows.map(([n, m]) => `<tr><td>${n}</td><td>${inr(m.net)}</td><td>${inr(m.revenue)}</td><td>${inr(m.transport + m.handling)}</td><td>${inr(m.spoilageCost + m.holding)}</td><td>${Math.round(m.unsoldKg)}</td><td>${Math.round(m.trueSpoiledKg)}</td><td>${pct(m.fulfillment)}</td><td>${m.violations.length}</td></tr>`).join('');
  const cm = s.costModel;
  $('assump').innerHTML = `<p><b>Cost model (same for every strategy).</b> Net = revenue − transport − handling − write-off of lost kg − carry-over write-off. Stock left unsold is mostly fresh stock that was not dispatched (written off at half its procurement value); real spoilage is shown separately and is near zero for every strategy.</p>
  <pre>${JSON.stringify({ minSaleDays: cm.minSaleDays, handlingDays: cm.handlingDays, handlingCostPerKg: cm.handlingCostPerKg, elasticity: cm.elasticity, carryWriteOff: cm.carryWriteOff ?? 0.5, holdingCostPerKg: cm.holdingCostPerKg, discountLevels: cm.discountLevels }, null, 1)}</pre>
  <ul><li>A shipment is allowed only if shelf life − travel − handling leaves at least ${cm.minSaleDays} day to sell, and only if it arrives inside the market's delivery window (travel + handling ≤ window).</li>
  <li>Demand at a market rises by elasticity × discount (10% off adds ${(cm.elasticity * 10).toFixed(0)}% demand). A discount is set per market and commodity (it applies to every batch sent there, which the reason lists) and is kept only when the simulation shows it adds net money. One dispatch round, so no discount timing. The elasticity is our assumption, not a measurement: see the table above.</li>
  <li>Stock not dispatched is written off at ${(cm.carryWriteOff ?? 0.5) * 100}% of its procurement value and counted as unsold.</li>
  <li>Planner: max-profit min-cost flow over batch → market and commodity → lane, then a discount search. Baselines: FIFO to nearest market, FIFO to highest price, an urgent-first best-margin dispatcher, and that dispatcher plus a flat 30% discount on surplus stock. The comparison always uses the best of the four.</li>
  <li>Data is synthetic, generated from a seed. It shows how the plan behaves, not real-world performance. Government post-harvest loss figures are context only.</li></ul>`;
}
function renderSweep(rows, s) {
  const f = (x) => inr(x);
  $('sweep').innerHTML = '<tr><th>If demand reacts to price</th>' + rows.map(r => `<th>elasticity ${r.elasticity}</th>`).join('') + '</tr>' +
    [['FreshRoute plan', (r) => f(r.plan.net)], ['FreshRoute, no discounts', (r) => f(r.planNoDisc.net)], ['Strongest baseline (of 4)', (r) => `${f(r.best.m.net)}<div class="meta">${r.best.name}</div>`],
     ['Dispatcher + flat 30% off', (r) => f(r.smartDisc.net)],
     ['Plan vs strongest', (r) => { const u = (r.plan.net / r.best.m.net - 1) * 100; return `<b>${u >= 0 ? '+' : ''}${u.toFixed(1)}%</b>`; }],
     ['Stock unsold: plan / strongest', (r) => `${pct(r.plan.unsoldRate)} / ${pct(r.best.m.unsoldRate)}`]]
      .map(([n, g]) => `<tr><td>${n}</td>${rows.map(r => `<td>${g(r)}</td>`).join('')}</tr>`).join('');
  const lo = Math.min(...rows.map(r => (r.plan.net / r.best.m.net - 1) * 100));
  $('sweepNote').textContent = `Most conservative gap on this dataset: ${lo >= 0 ? '+' : ''}${lo.toFixed(1)}%. Food price elasticity in the literature is about 0.3 to 0.8, so 1.5 is the optimistic column.`;
}
function renderStress(r) {
  const c = (t, v, sub) => `<div class="kpi"><div class="big">${v}</div><div class="name">${t}</div><span class="verdict v-ok">${sub}</span></div>`;
  $('stress').innerHTML =
    c('Plan kept as is beats the strongest baseline kept as is', Math.round(r.fixedBeatsBaseline * 100) + '%', `${r.draws} bad days · ${r.baselineName}`) +
    c('Average net, plan kept as is', inr(r.fixed.netMean), `baseline ${inr(r.baseline.netMean)}`) +
    c('Worst-10% net, plan kept as is', inr(r.fixed.netP10), `baseline ${inr(r.baseline.netP10)}`) +
    c('Replanned with the new values known', inr(r.replannedOracle.netMean), 'upper bound, not a forecast');
}

function run() {
  $('err').textContent = '';
  $('skeleton').hidden = false; $('result').hidden = true; $('status').textContent = 'Planning…';
  setTimeout(() => {
    try {
      const base = custom || generateScenario(Number($('seed').value));
      const s0 = applyPreset(base, $('preset').value);
      const s = { ...s0, costModel: { ...s0.costModel, elasticity: Number($('elast').value) } };
      const t = performance.now();
      const p = plan(s);
      const ms = Math.round(performance.now() - t);
      const mp = evaluate(p, s);
      const bases = strongestBaseline(s).all.map(x => ({ name: x.name, m: x.m }));
      render(s, p, mp, bases);
      renderSweep(sweepScenario(s), s);
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
