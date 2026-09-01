# Payment Processor Migration: Ridgeline Payments → Corvant

**Document owner:** Staff Engineer, Payments Platform
**Status:** Approved for Phase 0–2 (dual-run infrastructure); Phase 4 (writer cutover) pending Security, Finance, and Support sign-off
**Last updated:** 2026-07-30
**Audience:** Payments Platform, Finance, Security, Support Operations, Engineering Leadership
**Related tickets:** PAY-2210 (reserve hold dispute with Ridgeline), PAY-2244 (Corvant underwriting approval), FIN-880 (deferred revenue continuity), SEC-514 (PCI scope re-assessment)

## 1. Summary and Motivation

Tenfold is Hollowbrook, Inc.'s subscription workforce-scheduling product for hourly-shift businesses — retail, quick-service restaurants, and healthcare staffing agencies. We currently have 54,300 active paying accounts, $61.2M in ARR, and card-on-file billing only (no bank debit). 71% of accounts are on monthly plans; the remaining 29% prepay annually, which currently sits on our balance sheet as $8.9M of deferred revenue. All billing today runs through Ridgeline Payments, who we signed with at seed stage in 2021 because they were the only processor willing to underwrite an unproven SaaS company with no processing history.

Two things are forcing this migration rather than letting it sit on the backlog:

1. **Reserve hold.** In May, Ridgeline placed a rolling 10% reserve on our monthly processing volume, held for 90 days, citing elevated chargeback rates in our merchant category. Our own dispute rate is 0.35%, below both the card networks' monitoring thresholds and Ridgeline's own stated program limits. After escalation (PAY-2210), Ridgeline's risk team confirmed off the record that we are underwritten in a shared pool with several other subscription-model merchants, including a subscription-box retailer whose chargeback rate spiked into the networks' early-warning program. We are being held responsible, financially, for another merchant's risk profile, and Ridgeline has not offered a way to underwrite us separately without a new merchant account and a new application cycle — which is effectively this migration by another name. The reserve is currently holding approximately $610K of our cash at any given time.
2. **Involuntary churn from declines.** Ridgeline does not participate in card network account updater programs (Visa Account Updater / Mastercard Automatic Billing Updater), so when a customer's card expires or is reissued, we get a hard decline with no automatic refresh, and the subscription lapses unless the customer manually re-enters a card. We measured this directly against a control: a cohort of test transactions run through Corvant's sandbox using card BINs known to be mid-reissue cycle. Ridgeline declined 4.1% of renewal attempts for reasons attributable to stale card data; Corvant declined 0.7% on the same cohort, because network tokenization keeps the underlying card reference current automatically. At our volume, that gap is worth an estimated $1.6M in annualized recovered revenue, separate from the reserve issue entirely.

Corvant has approved us for a dedicated underwriting profile (not a shared pool), offers network tokenization, a lower blended rate (2.7% + $0.30 versus Ridgeline's 3.1% + $0.35), and — critically for this plan — a documented vault-to-vault credential migration API that moves stored payment methods directly between processors without the PAN ever transiting Hollowbrook's servers.

This document covers the dual-running strategy, how we move 54,300 live subscriptions and their stored credentials, the PCI DSS scope changes, webhook and reconciliation handling, the cutover sequence, the rollback plan, and how Finance keeps continuous revenue reporting across the boundary. This is a one-way door in the specific sense that once a customer's card has been migrated and their subscription's renewal authority has moved to Corvant, un-migrating them means re-vaulting through the same bulk transfer process in reverse — not a config flip. We are treating the per-cohort cutover as reversible up to that point and effectively irreversible after.

## 2. Current State

Ridgeline hosts our card vault (we never store raw PANs — we hold Ridgeline's tokenized payment method references, format `rl-pm-<20 hex>`) and owns subscription lifecycle: billing cycle dates, retry/dunning schedule on failed payments, and invoice generation. Our application calls Ridgeline's API to create and modify subscriptions; Ridgeline calls our webhook endpoint on billing events (`invoice.paid`, `invoice.payment_failed`, `subscription.canceled`, `card.updated`). Our billing service consumes those webhooks to update account entitlement (feature access, seat counts) and forwards normalized events to the Finance data warehouse for revenue recognition.

Ridgeline's dunning logic retries a failed card charge on a fixed schedule: day 1, day 4, day 8, then cancel. This schedule is not configurable per account and is not adaptive to decline reason (a hard decline like "stolen card" gets the same three retries as a soft decline like "insufficient funds," which wastes retry attempts and, per some published research on retry timing, mildly increases the odds of a dispute on hard-decline cases where the retries look like unauthorized charge attempts to the cardholder).

## 3. Target State

Corvant's subscription and vault model is broadly similar in shape — tokenized payment method references (format `cv-pm-<uuid>`), webhook-driven lifecycle events, hosted-fields card capture — which is what makes a fairly direct migration feasible rather than a rebuild. The meaningful differences: Corvant's dunning is decline-reason-aware (soft declines get up to 4 retries over 12 days; hard declines get 1 retry then immediate cancellation, reducing dispute-triggering retries), and Corvant supports network tokenization so card references self-heal on reissue without customer action.

We are not changing our subscription tiers, pricing, or billing cadence as part of this migration — this is a processor swap, not a pricing project. Scope is deliberately narrowed to keep the blast radius to "how money moves," not "what customers pay."

## 4. Dual-Running Strategy

We will run both processors live simultaneously for the duration of the migration, rather than a single hard cutover for all 54,300 accounts at once. Every subscription record in our billing service gets a new field, `renewal_authority`, set to either `ridgeline` or `corvant`. The routing layer consults this field on every billing-relevant action — a renewal charge, a plan change, a cancellation — and directs the call to the corresponding processor's API. Only one processor is ever authoritative for a given subscription's renewal at a time; there is no dual-charging by design, enforced by the fact that Ridgeline subscriptions are explicitly canceled (not just left dormant) at the moment a cohort's authority moves to Corvant.

```yaml
# billing-router config (excerpt) — per-account renewal authority
routing:
  default_authority: ridgeline
  cohort_overrides:
    - cohort: pilot-internal
      authority: corvant
      accounts: ["acct_8841", "acct_8842", "acct_8850"]   # 12 internal test accounts
    - cohort: wave-1-monthly-low-risk
      authority: corvant
      criteria:
        plan_type: monthly
        dispute_history: none
        tenure_days_min: 180
      target_start: 2026-08-11
  webhook_dedup_window_seconds: 172800   # 48h idempotency window, both providers
  freeze_on_migration: true              # blocks writes during a subscription's flip window
```

This is where the first real disagreement in this plan sits, and we want to name it rather than bury it. The dual-run window — the period where both processors are live and some fraction of subscriptions is on each — is currently scoped to run 10 weeks (Section 8). A gradual, cohort-by-cohort rollout is the right call operationally: it lets us catch integration bugs against a small blast radius, gives Support time to build muscle memory on two sets of processor error codes, and gives us a real rollback path per cohort instead of an all-or-nothing bet. That is the case Ops and Support leadership have made, and we agree with it.

Security's position, raised in SEC-514 review, is that every week the dual-run window stays open is a week we are maintaining full PCI DSS scope against *two* processor integrations, two webhook signature-verification paths, two sets of API credentials with card-data-adjacent permissions, and two vaults of live customer cards instead of one. A 10-week gradual rollout is, from that angle, 10 weeks of doubled attack surface in exchange for rollback convenience. Security's counter-proposal is a compressed 3-week window with larger cohorts. We have not resolved this. The plan as written goes with Ops' 10-week gradual schedule because the rollback value feels concrete and the incremental security exposure feels diffuse, but we recognize that is exactly the kind of reasoning that looks bad in hindsight if the diffuse risk is the one that materializes, and we think this genuinely deserves an independent read rather than a Payments Platform judgment call.

## 5. Migrating Stored Payment Credentials and Subscriptions

We are not asking customers to re-enter card details. Re-prompting 54,300 accounts for a fresh card would predictably cost us real revenue — every additional friction point in a re-auth flow measurably increases lapse rates in every dunning study we've seen internally and externally — and would defeat a large part of the point of switching to a processor with better retention tooling in the first place.

Instead we're using Corvant's vault-to-vault migration API. The mechanics: Ridgeline and Corvant both support a processor-initiated bulk transfer where Ridgeline encrypts and transmits the underlying card data directly to Corvant's vault over a dedicated, mutually authenticated channel, keyed by a merchant-authorization token we generate per batch. Hollowbrook's servers send and receive only the token references (`rl-pm-...` in, `cv-pm-...` out) — never the PAN, never even transiently. This preserves our SAQ A eligibility (Section 6) because the card data path never enters our environment; it moves processor-to-processor under an agreement both providers are independently attesting to.

```
Migration batch record (internal schema, illustrative)

subscription_migrations
  id                 uuid primary key
  account_id         text not null
  rl_subscription_id text not null          -- Ridgeline subscription reference
  rl_pm_ref          text not null          -- Ridgeline tokenized payment method
  cv_subscription_id text                   -- null until created
  cv_pm_ref          text                   -- null until vault transfer completes
  cohort             text not null
  status             text not null          -- queued | vault_transferred | subscription_created
                                             -- | reconciled | flipped | rolled_back
  next_renewal_at    timestamptz not null   -- carried over unchanged from Ridgeline
  requested_at       timestamptz not null
  completed_at       timestamptz
  failure_reason     text
```

Two properties of this schema matter. First, `next_renewal_at` is copied verbatim from the Ridgeline subscription and never recalculated — we do not want a migrated customer's bill date to shift by even a day, since an unexpected charge-date change is one of the most common triggers for "I don't recognize this charge" disputes. Second, `status` is a strict forward progression with `rolled_back` as the only exit that isn't `reconciled`/`flipped`; there is deliberately no partial state where a subscription is simultaneously chargeable from both sides.

The open disagreement here is about verification, not mechanism. Both Ridgeline and Corvant are PCI DSS Level 1 certified merchants and service providers, and our current plan treats that attestation as sufficient grounds to proceed with the bulk vault transfer without additional technical controls beyond the mutually authenticated channel both vendors provide by default. A more conservative position — one a security reviewer is likely to hold — is that "both parties are Level 1 certified" describes their general compliance posture, not this specific one-time bulk transfer mechanism, which is a less commonly audited code path than day-to-day transaction processing at either company. Under that view, we should be requiring Corvant to produce transfer-specific evidence (a recent penetration test report scoped to the migration API, or a right-to-audit clause invoked before go-live) rather than accepting their compliance program's general reputation as proof this specific pipe is sound. We have not requested that evidence as of this writing; Legal has the vendor agreement and has not flagged it as a gap, but Legal was not asked the question in those terms.

## 6. PCI DSS Scope Implications

Hollowbrook's SAQ A scope depends on card data never touching our systems in any form — we use hosted fields (an iframe served by the processor) for card capture today, and will continue to for both providers during and after the migration. That does not change. What does change, temporarily, is the number of PCI-relevant integration surfaces we operate:

- Two sets of webhook signature-verification keys, both able to trigger billing-state changes, need independent rotation schedules and independent monitoring for verification failures.
- Two API credential sets with the ability to create/modify subscriptions and payment methods need separate least-privilege scoping (Corvant's credentials should not be able to touch Ridgeline resources and vice versa — a mistake here, like a shared secrets store with insufficiently scoped IAM roles, would create exactly the kind of cross-processor blast radius PCI segmentation is meant to prevent).
- Our SAQ A attestation, currently filed against a single processor relationship, needs a new attestation cycle covering both relationships for the dual-run window, and a subsequent one after Ridgeline is decommissioned. We have not yet confirmed with our Qualified Security Assessor whether a mid-cycle attestation update is required the moment dual-run begins, or whether it can wait until the window closes — this is flagged to Security as an open item, not resolved here.

Assuming the vault-to-vault transfer path in Section 5 holds and hosted fields remain in place on both sides, our SAQ A eligibility should carry through the migration unchanged. That "should" is doing real work in that sentence — we are asserting it based on how the mechanism is documented, not based on independent confirmation from our QSA that this specific migration pattern has been reviewed against our current SAQ.

## 7. Webhook and Reconciliation Changes

During dual-run, our webhook endpoint receives events from both processors, with materially different payload shapes and different event vocabularies (Ridgeline calls a canceled subscription `subscription.canceled`; Corvant calls the same lifecycle transition `subscription.terminated`, with a separate `subscription.paused` state Ridgeline doesn't have at all). We're normalizing both into a single internal event schema before anything downstream — entitlement service, Finance warehouse — ever sees it, rather than teaching every consumer to understand two vocabularies.

```json
{
  "internal_event_id": "evt-9c1f2a-000441",
  "source_processor": "corvant",
  "source_event_id": "cv-evt-77213a9c",
  "account_id": "acct_204471",
  "subscription_ref": "cv-sub-5f0192",
  "normalized_type": "invoice.paid",
  "amount_cents": 9400,
  "currency": "usd",
  "occurred_at": "2026-08-14T03:12:05Z",
  "received_at": "2026-08-14T03:12:06Z",
  "idempotency_key": "acct_204471:invoice.paid:2026-08-14T03:12:05Z"
}
```

The idempotency key is what protects us against a specific dual-run failure mode: a subscription in `flipped` status where a stale Ridgeline webhook (delayed in transit, or retried by Ridgeline after a timeout on our end) arrives after we've already processed the equivalent Corvant event for the same billing cycle. Both processors retry undelivered webhooks on their own schedules, and those schedules don't know about each other or about our migration state. The 48-hour dedup window in the router config (Section 4) is sized against Ridgeline's documented maximum webhook retry duration (36 hours) plus a margin; if Ridgeline's actual retry behavior in production runs longer than documented — which happened once before, unrelated to this migration, per an old incident ticket — the dedup window could close before a legitimate late retry arrives, and we'd double-process it. We have not built a canary for this specifically; Section 12 covers what we have tested.

Reconciliation runs as a separate nightly job comparing three sources per subscription: the processor's own ledger (Ridgeline's or Corvant's, whichever is currently authoritative), our internal subscription record, and the Finance warehouse's revenue-recognition record. Discrepancies are queued for manual review rather than auto-corrected, on the reasoning that auto-correcting a revenue discrepancy without a human looking at it is how a small reconciliation bug turns into a material misstatement.

## 8. Cutover Sequence

Cutover proceeds cohort by cohort rather than all at once, per the dual-run rationale in Section 4.

| Phase | Window | Scope | Exit criteria |
|---|---|---|---|
| 0 — Infra & credentials | Weeks 1–2 | Corvant merchant account live, API credentials scoped and stored, webhook endpoints registered on both sides, normalized event schema deployed | Corvant sandbox parity test suite passes; internal 12-account pilot cohort created end-to-end in Corvant |
| 1 — Pilot cohort | Weeks 3–4 | 12 internal test accounts + 150 opted-in low-volume customer accounts, vault transfer + subscription creation + one full renewal cycle observed | Zero reconciliation discrepancies across 1 full billing cycle; no unexpected dunning triggers |
| 2 — Wave 1 (low-risk monthly) | Weeks 5–6 | ~9,000 monthly accounts, tenure > 180 days, no dispute history | Decline rate at or below Ridgeline baseline; support ticket volume from cohort within 1.2x baseline |
| 3 — Wave 2 (remaining monthly) | Weeks 7–8 | ~29,600 remaining monthly accounts | Same as Wave 1, evaluated per-batch (batches of ~5,000) |
| 4 — Wave 3 (annual/prepaid) | Weeks 9–10 | ~15,700 annual accounts, including all deferred-revenue balances | Finance sign-off on deferred revenue continuity (Section 10) per batch before flip |
| 5 — Decommission | Week 11+ | Ridgeline subscriptions fully migrated or explicitly excluded (Section 9 edge cases); Ridgeline API credentials revoked; SAQ A re-attestation filed for single-processor state | Zero active `renewal_authority: ridgeline` records; Ridgeline reserve released per PAY-2210 |

Annual/prepaid accounts are deliberately last. They carry the largest single-transaction dollar amounts, the longest deferred-revenue tail, and the least forgiving failure mode — a botched renewal on a $1,800 annual plan is a materially worse support and trust incident than a botched $79 monthly renewal, and we want maximum confidence from the first four waves before touching them.

Each wave's per-account flip follows the same daily runbook: freeze new writes on the account (blocks plan changes and cancellations, not read access, typically under 90 seconds), run the vault transfer, create the mirrored Corvant subscription with `next_renewal_at` copied over, run the three-way reconciliation check, cancel the Ridgeline subscription, flip `renewal_authority`, unfreeze. Any account that fails reconciliation is held in `queued` status and re-attempted the next business day rather than force-completed.

## 9. Rollback Plan

Rollback is scoped per subscription, not platform-wide — there is no single switch that reverts all migrated accounts back to Ridgeline at once, deliberately, because a platform-wide reverse migration carries the same one-way-door properties as the forward migration and shouldn't be executable as a panic response.

| Trigger | Detected by | Rollback action | Data implication | Owner |
|---|---|---|---|---|
| Reconciliation mismatch found before Ridgeline subscription is canceled | Nightly reconciliation job | Abort flip, leave account on Ridgeline, requeue for next cycle | None — Ridgeline remains authoritative, no data loss | Payments Platform |
| Vault transfer fails or returns partial data | Migration batch job, synchronous | Retry up to 3x, then hold account in `queued`, alert on-call | None — original Ridgeline `rl-pm-ref` untouched | Payments Platform |
| Post-flip renewal fails unexpectedly on Corvant within first billing cycle | Corvant webhook (`invoice.payment_failed`) + manual triage | Manually re-create subscription on Ridgeline using retained `rl-subscription-id` and `rl-pm-ref` (both kept, not deleted, for 30 days post-flip); flip `renewal_authority` back | Possible 1-cycle billing gap for the account; requires manual dunning outreach | Support Ops + Payments Platform |
| Systemic issue discovered across a whole wave (e.g., Wave 2) after Ridgeline subscriptions in that wave are already canceled | Elevated decline/dispute rate on wave-level dashboard | No automated rollback; wave is paused, root-caused, and affected accounts are individually triaged per the row above | Same per-account gap risk, multiplied by wave size; this is the scenario the 30-day Ridgeline-record retention (row above) exists to soften | Payments Platform + Eng leadership |
| Ridgeline merchant account is closed or suspended before decommission is complete | Ridgeline API returning auth errors | Escalate to Ridgeline account team; any `renewal_authority: ridgeline` subscriptions not yet migrated are frozen for new charges until resolved | Potential missed renewals for whatever cohort hadn't yet migrated | Payments Platform + Finance |

The 30-day retention of canceled Ridgeline subscription records and payment method references is the load-bearing safety net for everything after Wave 1 — it's what turns "the customer's card is gone from the old system" into "the customer's card reference still exists but isn't being charged, and we can reactivate it." After 30 days, those Ridgeline references are purged as part of closing out our obligations under the migration agreement, and past that point, a post-flip failure genuinely requires the customer to re-enter a card. We chose 30 days as a balance between rollback safety and not indefinitely maintaining two live card vaults for every migrated customer, which itself extends the double-PCI-scope problem from Section 4. We have not stress-tested whether 30 days is enough time to catch every plausible delayed-failure mode — most of what we've modeled resolves within the first billing cycle (at most 31 days for the longest monthly cycle), which is uncomfortably close to the retention window rather than comfortably inside it.

## 10. Revenue Reporting Continuity

Finance needs MRR, ARR, and deferred revenue to read continuously across the migration — no artificial step-change in reported revenue on the day a cohort flips, and no double-counting or under-counting during dual-run. The approach: the Finance warehouse ingests normalized events (Section 7) tagged with `source_processor`, and revenue recognition logic is written against the normalized schema, not against either processor's native reporting. A subscription's MRR contribution is attributed to the account, not to the processor, so a flip from Ridgeline to Corvant mid-quarter doesn't change which bucket the revenue lands in.

Deferred revenue for annual prepays is the harder case, and it's the one we're least settled on. An annual subscription's remaining deferred balance is currently tracked against the Ridgeline subscription ID as the join key in the revenue-recognition system. When that subscription is recreated under a new Corvant subscription ID (Section 5), the deferred revenue schedule has to be re-pointed to the new ID without resetting the recognition clock — the customer paid on day 0 of their Ridgeline subscription, and recognition needs to keep running against that original date, not restart against the Corvant creation date. We're handling this with an explicit `original_subscription_start` field carried through the migration record and required by the Finance warehouse's ingestion job, but this is new code in a code path (deferred revenue recognition) that materially affects reported financials, being written and tested by Payments Platform engineers rather than by anyone with a Finance/accounting background reviewing the recognition logic itself, only the plumbing. Finance has reviewed the schema; Finance has not independently re-derived the recognition math against a sample of migrated annual accounts before Wave 4 runs. We think that review should happen before Wave 4, not after, given that annual accounts carry the deferred revenue balance that actually shows up on the balance sheet, and a bug caught after the fact means restating numbers rather than just fixing forward.

This is arguably the most consequential unresolved disagreement in the plan, and it hasn't been framed as one yet inside the team, because it reads as an engineering task ("re-point the join key") rather than a financial-controls question ("who verifies the recognition math is right before it's live"). We're naming it here so it gets treated as the latter.

## 11. Customer Communication

We have not finalized whether to proactively notify customers ahead of their individual cutover. The case for notifying: a subscription's billing descriptor — the line on a customer's card statement — changes from "HOLLOWBROOK TENFOLD" via Ridgeline's processing entity to a Corvant-routed descriptor that, per Corvant's onboarding docs, will read slightly differently by default unless we configure a custom descriptor (open item, not yet confirmed with Corvant as of this writing). An unannounced statement descriptor change is a well-documented driver of "I don't recognize this charge" disputes — the customer's bank statement shows a name they don't immediately associate with a subscription they in fact still want, and some fraction call their card issuer instead of us. Proactive notice reduces that risk directly.

The case against blanket notification: an email that says "we're changing how your card is billed" is also, to a nontrivial fraction of subscribers, a prompt to think about the subscription at all — which some support and growth leads on the team believe increases voluntary cancellation among marginal accounts who'd otherwise have renewed on autopilot without reconsidering the purchase. We don't have internal data on this specific to a processor-change email, only general instincts from past billing-related communications, which had mixed results depending on framing. This is a genuine human-factors disagreement inside the company, not a settled call: Support wants transparency ahead of the charge; Growth is wary of manufacturing a cancellation moment. The current plan compromises by confirming the custom-descriptor configuration with Corvant (removing the actual trigger for statement-based disputes) and skipping proactive email, on the theory that if the descriptor doesn't change in a way the customer would notice, the argument for notifying largely dissolves. That compromise depends entirely on the descriptor configuration landing before Wave 2, which is not yet confirmed.

## 12. Testing and Validation

- **Sandbox parity suite**: every Ridgeline API call our billing service makes today has a Corvant-sandbox equivalent test, run in CI, covering subscription create/modify/cancel, card update, and all four dunning outcomes.
- **Pilot cohort live-fire**: 12 internal accounts plus 150 opted-in customer accounts run one full observed billing cycle on Corvant before Wave 1 begins (Section 8, Phase 1).
- **Webhook replay testing**: recorded production Ridgeline webhook payloads replayed against the normalized-event pipeline to confirm parity with recorded Corvant sandbox payloads for equivalent events.
- **Reconciliation dry run**: the three-way reconciliation job (Section 7) run against the pilot cohort for two full cycles before being trusted as a Wave 2+ go/no-go gate.
- **Not yet built**: a load test of the webhook dedup window under realistic Ridgeline retry-delay conditions (Section 7); a Finance-led independent verification of deferred revenue math (Section 10); a formal review of migration-specific evidence from Corvant beyond their standing PCI DSS Level 1 attestation (Section 5).

## 13. Risk Register

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R-1 | Bulk vault transfer mechanism relies on standing PCI attestations rather than transfer-specific verification (§5) | Low | High (compliance/security) | None beyond standing attestations currently; flagged for Security review | Security |
| R-2 | 10-week dual-run window extends double-PCI-scope exposure vs. a compressed schedule (§4) | Medium | Medium | Segmented credentials, independent webhook key rotation; window length itself unresolved | Payments Platform + Security |
| R-3 | Deferred revenue re-pointing logic not independently verified by Finance before Wave 4 (§10) | Medium | High (financial restatement risk) | Finance schema review done; recognition math re-derivation not done | Finance |
| R-4 | Webhook dedup window (48h) may be shorter than Ridgeline's actual retry tail under load, risking double-processed events (§7) | Low | Medium | Sized against documented retry window plus margin; not load-tested against worst case | Payments Platform |
| R-5 | 30-day Ridgeline record retention may not cover all delayed post-flip failure modes, especially for longer billing cycles (§9) | Low | Medium | Retention window chosen heuristically, not derived from failure-mode modeling | Payments Platform |
| R-6 | Custom billing descriptor on Corvant not confirmed before Wave 2; default descriptor could trigger dispute spike (§11) | Medium | Medium | Configuration requested from Corvant, not yet confirmed | Payments Platform |
| R-7 | Annual/prepaid accounts (largest dollar exposure) are gated on Wave 4 timing, which depends on all prior waves going cleanly — a slip anywhere compounds into this cohort | Low | High | Sequencing deliberately puts lowest-risk cohorts first; no fallback if Waves 1–3 run long against other business deadlines | Eng leadership |

## 14. Open Questions for Reviewers

- Is a 10-week gradual dual-run (Ops' rollback-friendly preference) the right trade against the doubled PCI scope it sustains (Security's concern), or should this compress to something closer to 3 weeks with larger cohorts, accepting less rollback granularity?
- Does relying on both processors' standing PCI DSS Level 1 attestations sufficiently cover the one-time bulk vault-to-vault transfer mechanism itself, or does that specific code path warrant independent verification (pen test scope, right-to-audit) before Wave 1 proceeds?
- Should Finance independently re-derive the deferred-revenue recognition math for a sample of annual accounts before Wave 4, given that this logic currently exists only as engineering-reviewed plumbing rather than Finance-verified accounting logic?
- Is 30 days the right retention window for canceled Ridgeline subscription and payment method records, given that our own modeling shows most — but not conclusively all — delayed failure modes resolve within a single billing cycle?
- Does skipping proactive customer notification (in favor of a silent descriptor fix) correctly balance dispute risk against voluntary-cancellation risk, or is that a judgment call that shouldn't be made by Support and Growth informally without a documented decision owner?

## Appendix A: Normalized Event Type Mapping

| Ridgeline event | Corvant event | Internal `normalized_type` |
|---|---|---|
| `invoice.paid` | `invoice.paid` | `invoice.paid` |
| `invoice.payment_failed` | `invoice.payment_failed` | `invoice.payment_failed` |
| `subscription.canceled` | `subscription.terminated` | `subscription.canceled` |
| *(no equivalent)* | `subscription.paused` | `subscription.paused` |
| `card.updated` | `payment_method.refreshed` | `payment_method.updated` |

## Appendix B: Vault Transfer Batch Authorization (illustrative shape, not a live schema)

```json
{
  "batch_id": "vtb-2026-08-11-wave1-003",
  "source_processor": "ridgeline",
  "destination_processor": "corvant",
  "authorization_scope": "payment_method_transfer",
  "account_count": 512,
  "requested_by": "payments-platform-migration-service",
  "expires_at": "2026-08-11T18:00:00Z",
  "callback_url": "https://internal.hollowbrook.example/webhooks/vault-transfer-status"
}
```

The batch authorization token is single-use, scoped to a specific account list, and expires within 6 hours of issuance — it cannot be replayed against a different batch or reused after the transfer window closes.
