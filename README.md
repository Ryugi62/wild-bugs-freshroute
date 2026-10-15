# FreshRoute

**Decision support for perishable produce distribution: what to dispatch first, where to send it, and when a discount pays.** Wild Bugs 24h Online Hackathon, problem statement PS 03.

Live app: https://wild-bugs-ten.vercel.app/ · Demo video: [docs/demo.mp4](https://github.com/Ryugi62/wild-bugs-freshroute/raw/main/docs/demo.mp4) · Spec: [SPEC.md](SPEC.md)

![mobile](docs/screenshot-mobile.png)

## What is different, and what is not
FreshRoute is a **one-day dispatch decision**: for the stock in the depot today, which batch ships first, to which market, and what to discount, each with a stated reason and **zero shipments that cannot physically happen** (a verifier re-checks stock, lane capacity, shelf life and delivery window). It does not forecast demand and it does not plan multiple days. Existing solutions are strong at what we skip:

| Type | Example | What it is built for | Source (vendor claims, not ours) |
|---|---|---|---|
| Retail AI ordering | Afresh | Multi-day demand forecast and ordering for store fresh departments; vendor claims 25% less waste, an independent WWF pilot reports 14.8% | [supermarketnews](https://www.supermarketnews.com/grocery-technology/ai-powered-food-waste-fighter-afresh-nabs-a-115m-investment), [pacificcoastcollaborative](https://pacificcoastcollaborative.org/?p=23621) |
| Dynamic markdown | Wasteless, RELEX | Expiry-based price changes in stores | [FAO agritech](https://agritechobservatory.review.fao.org/en/wasteless), [relex](https://www.relexsolutions.com/resources/case-nemlig-com/) |
| Indian B2B fresh supply chain | Ninjacart | Farm-to-retailer network with demand prediction (vendor claims 95-97% forecast accuracy) | [AIM interview](https://analyticsindiamag.com/how-ninjacart-utilises-ai-a-chat-with-ceo-thirukumaran-nagarajan/) |
| Open-source optimiser | Google OR-Tools min-cost flow | General solver; the same model class we use, no produce rules or explanations | general knowledge, URL not checked |

Our claim is narrow: a small, testable single-day dispatcher whose every line is explained and whose output is verified feasible. We do not claim better waste numbers than these products.

## The obvious fix vs ours
- Obvious: ship the nearest or highest-priced market first, hope it sells. A careful manager's version is a greedy rule: most perishable batch first, best margin market that still has demand and lane room. That rule is our strongest baseline, and we also give it a flat 30% surplus discount.
- FreshRoute: a max-profit min-cost flow over batch, market and lane. It never creates a shipment that would arrive with less than one day to sell or after the market's delivery window, orders dispatches most perishable first, and keeps a discount only where the simulation shows it adds net money.

## How it works (3 lines)
1. Every batch has remaining shelf life; a shipment is allowed only if shelf life minus travel minus handling leaves at least one sellable day and the shipment arrives within the market's delivery window.
2. The planner solves the allocation as min-cost flow (stock, demand, lane capacity), then searches discount levels per market and commodity against a shared cost model. A discount applies to every batch sent to that market for that commodity; the reason line lists the batch IDs.
3. A verifier re-checks stock, lane capacity, shelf-life and delivery-window limits, and a simulator scores the plan against four baselines on the same cost model.

## Requirement table (problem statement to where it lives)
| Mandatory MVP item | Where |
|---|---|
| Batches by commodity, quantity, remaining shelf life | `src/domain/simulator.js`, `src/adapters/generator.js`, UI dispatch list |
| Allocate stock using demand, price, transport time/cost, capacity, delivery windows | `src/application/planner.js` (min-cost flow), `deliveryOk()` in the simulator |
| Prioritise by perishability and shelf-life feasibility | dispatch rank, `arrivalLife()` rule, verifier |
| Discounts for batches at risk, disclosed assumptions | planner discount search per market x commodity (batch IDs in the reason), elasticity selector (0.5 / 1.0 / 1.5) in the UI |
| Compare against baseline: unsold stock, fulfilment, net revenue after defined costs | first screen cards, comparison table, elasticity table |
| Optional: replan on disruption, uncertainty | situation presets (closed market, delay, heat wave, demand drop), 30-draw stress test |

## Results on 30 held-out seeds (1000-1029, never used while developing)
Run `npm run eval`. Full output: [eval-results.json](eval-results.json). The datasets come from our own seeded generator, not from the organisers. Everything is synthetic and shows behaviour, not real-world performance.

**Headline (most conservative of three elasticity assumptions): net revenue +0.6% over the strongest of four baselines, never worse in 30 of 30 datasets, strictly better in 15 of 30, 0 hard-rule violations.** The gain grows to +4.1% only if demand reacts strongly to price (elasticity 1.5, the optimistic column; food elasticity in the literature is about 0.3 to 0.8).

| Elasticity (demand gain per unit of discount) | Plan net (INR) | Plan, no discounts | Strongest baseline (best of 4, per seed) | Dispatcher + flat 30% off | Plan vs strongest | Never worse / strictly better | Stock left unsold: plan vs strongest |
|---|---|---|---|---|---|---|---|
| 0.5 | 398,156 | 398,156 | 395,680 | 344,713 | +0.6% | 30/30 · 15/30 | 36.6% vs 37.1% |
| 1 | 399,286 | 398,156 | 395,680 | 374,582 | +0.9% | 30/30 · 30/30 | 34.9% vs 37.1% |
| 1.5 | 418,508 | 398,156 | 402,125 | 398,696 | +4.1% | 30/30 · 30/30 | 27.9% vs 30.0% |

What the metric means: "stock left unsold" is the share of stock kg that was not sold this round. For every strategy it is almost entirely fresh stock that stays in the depot and is written off at 50% of procurement value in the cost model; **really spoiled stock is about 0 kg for the plan and all baselines**, so we do not claim a spoilage reduction. Without any discount the plan is +0.6% (routing gain only). Mean fulfilment of the plan is 72.6%; we make no fulfilment claim over the baselines. Planning time: under 100 ms (max 37 ms).

Stress test (10 datasets x 30 bad days: shelf life up to -20%, trips up to +0.5 days, demand -25% to +15%, prices +-10%). Both the plan and the strongest baseline are computed once on the normal day and kept fixed:
| Elasticity | Plan kept fixed beats strongest baseline kept fixed | Mean net, plan vs baseline (INR) |
|---|---|---|
| 0.5 | 208 of 300 (69%) | 50,552 vs 49,490 |
| 1 | 132 of 300 (44%) | 51,335 vs 49,490 |
| 1.5 | 187 of 300 (62%) | 50,707 vs 46,880 |

The plan earns more on average at every elasticity, but it wins fewer than three quarters of individual bad days: delivery windows make routes that run close to the limit fragile when trips run late. Re-solving the plan after the disturbance (with the new values known) is an upper bound, not a forecast, and we do not count it as a win.

## Limits (read before judging)
- Data is synthetic from our generator; no organiser dataset was available, so "hidden" means held-out seeds of our generator.
- Price elasticity is an assumption, not a measurement. The win shrinks to +0.6% at 0.5; we show all three columns.
- Delivery windows are one latest-arrival time per market (days after dispatch), not time-of-day slots.
- Discounts are decided per market and commodity, not per batch, and only for one dispatch round (no discount timing).
- Not implemented: demand forecasting, multi-day simulation, map UI, real distributor or price feeds.
- Government post-harvest loss statistics are context only.

## Run and test
```
npm test         # 22 tests (domain, planner, baselines, delivery windows, elasticity sweep, validation)
npm run eval     # held-out seed evaluation, elasticity sweep
python3 -m http.server 8080 --bind 127.0.0.1   # then open http://127.0.0.1:8080
python3 scripts/smoke.py                       # browser smoke at 390 and 1280 px (needs playwright)
```
No build step, no dependencies, no external fonts or CDN. Architecture: `domain` (pure) <- `application` <- `adapters` <- `ui`.

## Pre-existing code (Devfolio Code of Conduct disclosure)
Application code in `src/` was written during the hackathon window. Reused from the author's earlier hackathon projects: the demo-video builder pattern in `video/build.py` (narration, Playwright recording, ffmpeg mux, caption burn-in) and the browser smoke script pattern in `scripts/smoke.py`. They are tooling for the demo video and checks, not part of the product. Text to speech uses edge-tts.
