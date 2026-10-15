# FreshRoute — SPEC (Wild Bugs PS 03)
Decision support for perishable produce distribution: which batches ship first, where they go, when to discount.

## Ubiquitous language
Batch (commodity, quantity kg, remaining shelf life days, depot) · Destination (market: demand per commodity, price, travel days, transport cost per kg, lane capacity kg) · Shipment (batch to destination, kg) · Plan (ordered shipments + discounts) · Baseline (FIFO-nearest, price-greedy) · Scenario (a full dataset + cost model) · Cost model (transport, handling, spoilage = procurement value of wasted kg, holding) · Sell window (minSaleDays that must remain after arrival + handling) · Delivery window (latest arrival, in days after dispatch, that a market accepts) · Unsold stock (kg not sold this round: carry-over written off + spoiled/unsold at market; real spoilage is reported separately) · Strongest baseline (best net among four baselines on the same seed) · Elasticity sweep (0.5 / 1.0 / 1.5).

## 목적 / Purpose
One-day MVP of a perishable-produce distribution decision aid, judged against baselines on one shared cost model.

## 성공 조건 / Goal and numeric success conditions (hidden seeds 1000-1029, never used in development)
- S1 Unsold-stock share (unsold + written-off carry-over + real spoilage, share of stock kg; the honest name, because both strategies spoil ~0 kg and the share is mostly stock left at the depot): reported at elasticity 0.5 / 1.0 / 1.5 against the strongest of four baselines (FIFO-nearest, FIFO-highest-price, urgent-first best-margin dispatcher, dispatcher + simple 30% surplus discount). Plan <= strongest baseline at every elasticity; real spoiled kg reported alongside.
- S2 Net revenue, elasticity sweep (revised after measurement: the first draft demanded a strict win in >= 90% of seeds at every elasticity; at 0.5 the plan ties the dispatcher in half the seeds because nothing contends for lanes, so the honest condition is non-inferiority plus a reported strict-win count): plan >= strongest of four baselines in 100% of seeds at every elasticity in {0.5, 1.0, 1.5}, strict wins reported. The headline is the MOST CONSERVATIVE mean uplift over the sweep, shown with the discount-free plan so routing gain and discount gain are separate. Measured: +0.6% / +0.9% / +4.1%; headline +0.6%. Food elasticity in the literature is 0.27-0.81, so 1.5 is the optimistic column only.
- S3 Demand fulfillment: reported (plan mean 72.6% at the default elasticity), no superiority claim (profit-first objective).
- S4 Feasibility: 0 hard-constraint violations (stock, lane capacity, shelf-life window, delivery window) in 100% of seeds.
- S5 Robustness: under 30 random perturbations per scenario (shelf life -20%, delay +0.5d, demand -25..+15%, price +-10%) the original plan and the strongest baseline are both computed once and kept fixed on every bad day; mean net of the fixed plan >= fixed baseline at each elasticity, and the share of draws won is reported, not promised (measured 69% / 44% / 62% at 0.5 / 1.0 / 1.5; delivery windows make a fixed plan fragile when trips run late). Re-solving with known disturbed values is an oracle upper bound and is labelled as such.
- S6 Runtime: full plan + discount search < 2 s in the browser for 30 batches x 6 destinations.
- S7 Determinism: same seed -> identical plan JSON.

## Given / When / Then
- AC1 Given a batch with life L and a destination with travel T and handling H, When arrival life L-T-H < minSaleDays, Then the shipment is infeasible and the planner never creates it.
- AC2 Given total shipments to a destination, When they exceed lane capacity or a batch's stock, Then the verifier reports a violation; planner output has none.
- AC3 Given surplus stock vs demand at a market, When a discount level raises net revenue in the simulation, Then the plan recommends it with the stated elasticity assumption and the measured gain; otherwise 0%.
- AC4 Given perishable and durable batches competing for one lane, Then the perishable one is dispatched first (priority rank by remaining life).
- AC5 Given a disruption (closed market, delay, demand shock, shelf-life loss), When Replan is run, Then a new feasible plan is produced and compared again.
- AC6 Given malformed custom dataset JSON, Then the UI shows a one-line cause and fix and keeps the previous result.
- AC8 Given a market with a delivery window W, When travel + handling > W, Then the shipment is infeasible (verifier type delivery_window) and the planner never creates it.
- AC9 Given the elasticity sweep, Then the comparison table has one column per elasticity, a discount-free plan column and a baseline + simple-discount column.
- AC7 Every shipment and discount has a one-line reason (why this market, why this order, why this discount).

## 비목표 / Non-goals
Real distributor integration, live price feeds, ML demand forecasting, authentication, hardware sensors (discounts are decided per market x commodity cell and the reason lists the batch IDs that feed the cell; there is one dispatch round, so discount timing is out of scope; optional extensions only if time permits: shelf-life/delay/demand uncertainty is included).

## Architecture
domain (pure: model, cost model, simulator, verifier) <- application (planner via min-cost flow, baselines, discount search, sensitivity, replan) <- adapters (seeded dataset generator, JSON validator) <- ui (static ES modules, no build, no CDN).

## UI 수용기준 / UI acceptance (notes/원칙-디자인.md checklist 10, applied)
1 mobile first: no horizontal scroll at 390px, viewport meta. 2 one question per screen: scenario chooser + one primary button. 3 type: body 16px, headings 22+, no text < 12px. 4 spacing multiples of 4/8, side gutter >= 16. 5 primary button full width >= 52px, touch targets >= 44px. 6 numbers first: result cards start with the big number (>= 28px), verdict below. 7 evidence collapsed: assumptions, cost model and formulas in closed details. 8 microcopy: active, positive, error = cause + fix. 9 white background + one brand color + 3 state pairs, contrast >= 4.5:1, focus ring, dark mode safe. 10 no external fonts/CDN, loading skeleton, status text.
