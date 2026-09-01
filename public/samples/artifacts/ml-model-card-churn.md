# Model Card: Residential Churn Propensity Model (RCPM-v4)

**Solstice Broadband — Retention Analytics Team**

## Model Details

| Field | Value |
|---|---|
| Model name | RCPM (Residential Churn Propensity Model) |
| Version | 4.2 |
| Model type | Gradient-boosted decision trees (XGBoost, binary classification) |
| Training date | 2026-07-18 |
| Owners | Retention Analytics (modeling), Data Platform (feature pipeline) |
| Primary contact | Dana Whitfield, Sr. Data Scientist, Retention Analytics |
| Review status | Approved for production by Model Risk Review, 2026-07-29 |
| Retraining cadence | Quarterly, or on trigger from drift monitor (Section 9) |

## 1. Summary

RCPM scores every active residential broadband subscriber weekly with a
probability of voluntary churn (disconnect or non-renewal) within the next
60 days. The score feeds the Retention Ops team's outbound call and offer
queue, replacing a prior process that prioritized outreach primarily by
contract end-date, which caught expirations but missed early-warning churn
signals like usage collapse or repeated service complaints.

This card documents training data, features, evaluation results, and known
limitations, including one feature and one deployment design choice that
were contested during model review and remain contested today. Both are
described in Section 8 rather than smoothed over, because the disagreement
is the part of this document most likely to matter to anyone auditing the
model later.

## 2. Intended Use

**Primary intended use:** Rank active residential subscribers by relative
churn risk to prioritize a limited pool of retention outreach capacity
(call center hours, discretionary discount budget) toward accounts most
likely to churn in the next 60 days.

**Intended users:** Retention Ops queue management (automated), Retention
Ops team leads (manual override and QA), Marketing Analytics (cohort
reporting only, not individual scoring).

**Out-of-scope uses — explicitly prohibited:**

- Pricing or plan-eligibility decisions for individual customers.
- Credit, deposit, or service-denial decisions of any kind.
- Any use that determines the *content or tone* of a customer-facing
  interaction based on score alone (e.g., de-escalation scripting) without
  a human agent in the loop.
- Any use outside the residential consumer segment (the model was not
  trained on, and has not been evaluated against, small-business or
  enterprise accounts, which have materially different churn dynamics —
  contract terms, multi-site accounts, dedicated account management).

## 3. Training Data

- **Source systems:** Billing (Zuora), CRM (Salesforce Service Cloud),
  network telemetry (modem uptime/error logs from the NOC data lake),
  support ticketing (Zendesk).
- **Population:** All residential subscribers active at any point between
  2023-01-01 and 2026-06-30, with at least 90 days of tenure at time of
  observation (shorter-tenure accounts are excluded — see Section 8,
  known limitations).
- **Size:** ~1.4M subscriber-month observations after downsampling the
  majority (non-churn) class 3:1 to balance training; ~38,000 confirmed
  churn events.
- **Label definition:** Positive label = subscriber initiated disconnect,
  or failed to renew at contract end and did not reconnect within 14 days.
  Involuntary churn (collections-driven disconnect for non-payment) is
  **excluded** from the positive class and modeled separately by the
  Collections team — mixing the two was tried in RCPM-v2 and degraded
  precision because the two populations have almost opposite risk
  profiles (voluntary churners tend to be low-usage-friction, high
  price-sensitivity; involuntary churners tend to be payment-distressed
  regardless of satisfaction).
- **Held-out validation:** temporal split — trained on data through
  2026-03-31, validated on April–June 2026 to avoid leakage from
  seasonal effects and to simulate real deployment conditions (predicting
  forward, not interpolating).

## 4. Features

| Feature | Description | Source | Notes |
|---|---|---|---|
| `tenure_months` | Months since account activation | Billing | |
| `contract_end_days` | Days until current contract term expires | Billing | Strongest single predictor |
| `usage_trend_30d` | % change in data usage vs. trailing 90-day average | Network telemetry | |
| `outage_events_90d` | Count of service outages affecting the account, 90d | NOC | |
| `truck_rolls_180d` | Count of technician site visits, 180d | Field Ops | |
| `support_tickets_90d` | Count of support contacts, any channel, 90d | Zendesk | |
| `complaint_ticket_ratio` | Share of tickets tagged "complaint" vs. "informational" | Zendesk | See Section 8 |
| `price_increase_flag` | Whether a rate increase applied in trailing 60d | Billing | |
| `competitor_promo_density` | Count of known competitor promotional offers active in subscriber's census tract | Third-party market intel feed | |
| `autopay_enrolled` | Boolean | Billing | |
| `bundle_count` | Number of bundled services (internet, streaming add-on, phone) | Billing | More bundles correlates with lower churn |
| `nps_last_survey` | Most recent NPS response, if any, decayed by recency | Survey vendor | Null for ~60% of accounts |
| `billing_zip_median_income_decile` | Decile (1–10) of median household income for the subscriber's billing ZIP, from ACS 5-year estimates | Third-party demographic append | **Ethically contestable — see Section 8** |
| `plan_tier` | Current service tier (Basic/Standard/Gig) | Billing | |
| `speed_downgrade_flag` | Whether subscriber downgraded speed tier in trailing 12mo | Billing | |

Categorical features are target-encoded with 5-fold cross-fitting to avoid
leakage. Missing values (notably `nps_last_survey`) are imputed with a
missingness indicator rather than mean imputation, since missingness itself
is informative (customers who never respond to satisfaction surveys churn
at a modestly higher rate).

## 5. Model Architecture and Training

- **Algorithm:** XGBoost, `binary:logistic` objective.
- **Key hyperparameters:** `max_depth=6`, `n_estimators=450`,
  `learning_rate=0.03`, `subsample=0.8`, early stopping on validation
  AUC with patience 25 rounds.
- **Class balancing:** 3:1 downsampling of majority class at training time;
  scores are recalibrated post-hoc (Platt scaling) against true population
  base rate for reporting, so that the probabilities Retention Ops sees are
  not artificially inflated by the downsampling.
- **Feature importance (top 5 by gain):** `contract_end_days`,
  `usage_trend_30d`, `billing_zip_median_income_decile`,
  `competitor_promo_density`, `complaint_ticket_ratio`.

```python
# feature_pipeline/train.py — excerpt
import xgboost as xgb

model = xgb.XGBClassifier(
    max_depth=6,
    n_estimators=450,
    learning_rate=0.03,
    subsample=0.8,
    colsample_bytree=0.8,
    objective="binary:logistic",
    eval_metric="auc",
    early_stopping_rounds=25,
)
model.fit(
    X_train, y_train,
    sample_weight=class_weights,          # 3:1 downsample compensation
    eval_set=[(X_val_temporal, y_val_temporal)],
)
```

## 6. Evaluation

| Metric | Value | Notes |
|---|---|---|
| AUC-ROC (temporal holdout) | 0.81 | |
| Precision @ top 10% scored | 0.34 | i.e., of the top decile flagged, 34% churn within 60d, vs. 2.7% base rate |
| Recall @ top 10% scored | 0.41 | 41% of all churners captured in the top-scored decile |
| Brier score (calibration) | 0.061 | Post-recalibration |
| Precision @ top 10%, Income Decile 1–3 (lowest) | 0.29 | See Section 8 |
| Precision @ top 10%, Income Decile 8–10 (highest) | 0.39 | See Section 8 |

Subgroup evaluation by income decile was run specifically because of the
contested feature described below, not as standard practice — RCPM-v3 did
not include this breakdown, and its absence was one of the review
committee's findings.

## 7. Deployment and Decision Workflow

RCPM output feeds a weekly scoring job. Scores above the 90th percentile
route to the Retention Ops priority queue; scores in the 75th–90th
percentile route to an automated email/SMS save-offer flow; below the 75th
percentile, no proactive action is taken. Retention Ops has a fixed weekly
capacity of roughly 4,000 outbound contacts and a discretionary discount
budget capped monthly by Finance, so the queue is necessarily a ranking,
not a full-coverage list — not everyone flagged gets reached, and the
threshold is a capacity constraint as much as a modeling one.

This design was contested during model review, on a question that is
methodological rather than about any single feature: **should the queue be
ranked by raw churn probability, or by estimated uplift** (the incremental
reduction in churn probability *if contacted*, versus doing nothing)?

**Retention Ops and Product's position** was to ship on churn probability
ranking, which is what RCPM does today. It's directly interpretable, it
reuses a model the team already understands and can debug, and it was
buildable in the quarter allotted. The team's operating assumption is that
outreach to a high-risk account is very unlikely to be harmful and often
helps, so ranking by risk is a reasonable proxy for ranking by value of
intervention, even though the two are not the same thing.

**Data Science's position**, argued most consistently by the model's own
author, is that raw churn probability is the wrong ranking criterion for an
*intervention* queue, and that the literature on this is fairly settled:
some of the highest-risk accounts are highest-risk *because* they've
already decided to leave (a competitor's install date is booked), and
contacting them wastes capacity and discount budget that could have saved
a different, more persuadable account; other high-risk accounts would
churn regardless of contact, for reasons outreach can't fix (moving out of
the service area). What the queue should optimize for is uplift —
accounts where the model believes contact meaningfully changes the outcome
— which requires either a randomized holdout to estimate a causal
treatment effect, or an uplift-modeling approach (e.g., a two-model or
causal-forest formulation) rather than a single churn classifier. This is
a materially larger modeling and experimentation investment, and it was
not resourced for the v4 release.

The compromise implemented in v4 is a partial one: 10% of the top-decile
population is randomly withheld from outreach each week as a measurement
holdout, generating the data an uplift model would eventually need, but
the production ranking itself remains raw churn probability. Whether that
holdout accumulates enough signal to justify an uplift model in v5, and
whether Retention Ops will accept a model that occasionally ranks a
lower-raw-risk account above a higher-raw-risk one because it's more
persuadable, is unresolved and tracked as an open modeling question, not a
committed roadmap item.

## 8. Ethical Considerations

### 8.1 `billing_zip_median_income_decile`

This feature is a third-party demographic append based on the median
household income of the subscriber's billing ZIP code, bucketed into
deciles. It is one of the five highest-importance features in the model
(Section 5) and its removal in an ablation test reduced top-decile
precision from 0.34 to 0.30 — a real, non-trivial degradation.

It is also, in the modeling committee's own review notes, "not really a
behavioral feature" — it doesn't describe anything the subscriber did, it
describes where they live, which correlates strongly with income and,
in Solstice's footprint, with race, given well-documented residential
segregation patterns in several of the metro areas we serve. The feature
is not a protected-class attribute directly, but it functions substantially
as a proxy for one, and its predictive power likely derives in part from
correlations the company should not want to act on, even indirectly:
lower-income and majority-minority ZIP codes plausibly show elevated churn
because of price sensitivity to a legitimate competitive dynamic
(prepaid/low-cost competitor entry is denser in those tracts), not because
of anything about the individual subscriber's behavior or intent.

**Data Science and Growth's position** is that the feature should stay.
Telecom broadband is not a credit product; there is no fair-lending
statute directly on point the way there would be for a loan-underwriting
model, and the *outcome* of using this feature is that Solstice offers
*more* retention discounts to lower-income neighborhoods, not fewer — the
model isn't gating service, it's allocating a discretionary discount
budget, and a feature that improves targeting of that budget arguably
benefits price-sensitive customers rather than harming them. Removing a
working feature because of what it correlates with, without evidence of
concrete harm, was viewed by this camp as symbolic caution at the cost of
measurable retention performance, worth roughly $340K in projected annual
saved-revenue based on the precision delta.

**Legal and the model risk reviewer's position** is that "it helps them"
is a framing that doesn't survive contact with how the queue actually
works in practice: it's a fixed-capacity queue (Section 7), so a feature
that shifts ranking toward lower-income ZIP codes for one subscriber
necessarily shifts a higher-income subscriber with a similar behavioral
profile out of the reachable queue. Whether that nets out as "helping"
low-income subscribers or as a defensible-sounding channel for a proxy
variable to influence who gets attention depends on distributional
assumptions nobody on the team has actually tested. More narrowly, the
optics risk was flagged as real regardless of the underlying fairness math:
a regulator, journalist, or customer advocacy group reviewing "Solstice
uses your neighborhood's income to help decide whether you get a retention
call" would not likely read the intent charitably, irrespective of the
direction of the effect.

The feature was retained in v4 pending a fairness audit that Legal
requested and that has not yet been scheduled against Data Science's
capacity (see Section 10). This is documented as an open, contested
decision, not a resolved one — the subgroup metrics in Section 6 exist
specifically so this disagreement has evidence attached to it rather than
resting on assertion from either side.

### 8.2 Complaint ticket ratio and the "penalize complainers" concern

A secondary but related concern was raised about `complaint_ticket_ratio`:
because higher complaint volume increases predicted churn risk, and
predicted churn risk increases retention attention, the net effect is that
subscribers who complain more get *more* attention, which the team
considers the intended and correct behavior. The concern raised in review
was narrower: because outreach sometimes comes with a discretionary
discount, this could create a perceptible incentive structure where
complaining is rewarded, which Customer Experience flagged as a possible
long-term behavioral distortion, distinct from the income-proxy concern
above. No design change was made in response; it is noted here as a
secondary, lower-severity open question.

## 9. Limitations and Caveats

- The model is trained and evaluated only on residential accounts with
  90+ days of tenure; new-subscriber churn (the first 90 days, which
  industry benchmarks suggest is a disproportionately high-risk period) is
  not covered by RCPM and is handled by a separate onboarding-risk
  heuristic that has not been formally validated.
- `nps_last_survey` is missing for roughly 60% of the population;
  performance has not been separately evaluated for the surveyed vs.
  unsurveyed subpopulations, and survey response itself is not random
  (skews toward higher-tenure, higher-engagement subscribers).
- The model has not been evaluated on subscribers in newly-acquired
  service territories (two markets added via acquisition in Q2 2026);
  those territories have under 4 months of history and were excluded from
  training.
- Precision at the top decile (0.34) means roughly two in three flagged
  accounts would not have churned regardless of contact — this is
  expected and typical for this class of problem, but Retention Ops
  leadership should not communicate the score to agents as a "will churn"
  prediction; it is a relative ranking, not a forecast of individual
  outcome.

## 10. Monitoring and Maintenance

- Weekly PSI (population stability index) monitoring on top-10 features;
  alert threshold PSI > 0.2 triggers a review.
- Quarterly retraining on rolling 3-year window.
- Fairness audit for `billing_zip_median_income_decile` requested by
  Legal on 2026-07-29, not yet scheduled; tracked as open action item
  RCPM-OA-3.
- Owner for monitoring dashboard: Data Platform on-call rotation.

## 11. Change Log

| Version | Date | Change |
|---|---|---|
| 4.2 | 2026-07-18 | Added measurement holdout (10% of top decile) for future uplift modeling |
| 4.1 | 2026-04-02 | Added `competitor_promo_density` feature |
| 4.0 | 2026-01-15 | Separated voluntary/involuntary churn labels (previously combined in v3) |
| 3.0 | 2025-06-01 | Initial production release |
