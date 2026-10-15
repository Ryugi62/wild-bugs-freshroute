# FreshRoute — SPEC (Wild Bugs PS 03)
Decision support for perishable produce distribution: which batches ship first, where they go, when to discount.

## Ubiquitous language
Batch (commodity, quantity kg, remaining shelf life days, depot) · Destination (market: demand per commodity, price, travel days, transport cost per kg, lane capacity kg) · Shipment (batch to destination, kg) · Plan (ordered shipments + discounts) · Baseline (FIFO-nearest, price-greedy) · Scenario (a full dataset + cost model) · Cost model (transport, handling, spoilage = procurement value of wasted kg, holding) · Sell window (minSaleDays that must remain after arrival + handling).

## Goal and numeric success conditions (hidden seeds 1000-1029, never used in development)
- S1 Spoilage: mean spoilage rate of the plan <= 50% of the best baseline's.
- S2 Net revenue: plan beats both baselines in >= 90% of seeds; mean uplift >= +25% vs best baseline.
- S3 Demand fulfillment: plan >= baseline in >= 90% of seeds.
- S4 Feasibility: 0 hard-constraint violations (stock, lane capacity, shelf-life window) in 100% of seeds.
- S5 Robustness: under 30 random perturbations per scenario (shelf life -20%, delay +0.5d, demand -25..+15%, price +-10%) replanned plan keeps net >= baseline in >= 90% of draws.
- S6 Runtime: full plan + discount search < 2 s in the browser for 30 batches x 6 destinations.
- S7 Determinism: same seed -> identical plan JSON.

## Given / When / Then
- AC1 Given a batch with life L and a destination with travel T and handling H, When arrival life L-T-H < minSaleDays, Then the shipment is infeasible and the planner never creates it.
- AC2 Given total shipments to a destination, When they exceed lane capacity or a batch's stock, Then the verifier reports a violation; planner output has none.
- AC3 Given surplus stock vs demand at a market, When a discount level raises net revenue in the simulation, Then the plan recommends it with the stated elasticity assumption and the measured gain; otherwise 0%.
- AC4 Given perishable and durable batches competing for one lane, Then the perishable one is dispatched first (priority rank by remaining life).
- AC5 Given a disruption (closed market, delay, demand shock, shelf-life loss), When Replan is run, Then a new feasible plan is produced and compared again.
- AC6 Given malformed custom dataset JSON, Then the UI shows a one-line cause and fix and keeps the previous result.
- AC7 Every shipment and discount has a one-line reason (why this market, why this order, why this discount).

## Non-goals
Real distributor integration, live price feeds, ML demand forecasting, authentication, hardware sensors (optional extensions only if time permits: shelf-life/delay/demand uncertainty is included).

## Architecture
domain (pure: model, cost model, simulator, verifier) <- application (planner via min-cost flow, baselines, discount search, sensitivity, replan) <- adapters (seeded dataset generator, JSON validator) <- ui (static ES modules, no build, no CDN).

## UI acceptance (notes/원칙-디자인.md checklist 10, applied)
1 mobile first: no horizontal scroll at 390px, viewport meta. 2 one question per screen: scenario chooser + one primary button. 3 type: body 16px, headings 22+, no text < 12px. 4 spacing multiples of 4/8, side gutter >= 16. 5 primary button full width >= 52px, touch targets >= 44px. 6 numbers first: result cards start with the big number (>= 28px), verdict below. 7 evidence collapsed: assumptions, cost model and formulas in closed details. 8 microcopy: active, positive, error = cause + fix. 9 white background + one brand color + 3 state pairs, contrast >= 4.5:1, focus ring, dark mode safe. 10 no external fonts/CDN, loading skeleton, status text.
