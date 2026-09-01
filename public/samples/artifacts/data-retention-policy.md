# Data Retention and Deletion Policy

**Fernbridge Analytics, Inc.**

| Field | Value |
|---|---|
| Document Owner | Legal & Compliance — Priya Anand, Data Protection Officer |
| Co-Owner | Engineering — Marcus Ojeda, VP Data Platform |
| Version | 3.2 |
| Effective Date | 2026-09-15 |
| Supersedes | v3.1 (2025-11-02) |
| Review Cadence | Annual, or upon material product or regulatory change |
| Approvers | General Counsel, CISO, VP Engineering, VP Product |
| Distribution | Internal — Engineering, Product, Support, Legal, Sales Engineering |

## 1. Purpose

This policy defines how long Fernbridge Analytics retains personal data, operational
data, and business records, and the mechanisms by which that data is deleted or
anonymized at the end of its retention period. It exists to satisfy three
overlapping obligations that do not always point the same direction: our
statutory and contractual retention requirements (tax law, audit, customer
DPAs), our privacy obligations under GDPR and CCPA/CPRA (data minimization,
storage limitation, the right to erasure), and our operational need to keep
enough data, for long enough, to run the product our customers pay for.

Fernbridge operates a behavioral analytics platform: our customers (mid-market
e-commerce and media companies) embed our SDK on their sites and apps, and we
collect, store, and analyze event-level data about their end users' behavior.
This makes us a data processor for most of the personal data we hold, and a
data controller for our own customer (account) records, billing data, and
support communications. The distinction matters throughout this policy —
processor obligations are set primarily by customer contracts (Data Processing
Addenda, "DPAs"), while controller obligations are set primarily by law
directly.

## 2. Scope

This policy applies to all data stored or processed by Fernbridge Analytics
in production, staging, backup, and analytics environments, including data
held by subprocessors (AWS, Snowflake, Twilio) on our behalf. It does not
apply to data our customers export from our platform into their own systems;
once exported, retention is governed by the customer's own policies.

## 3. Definitions

- **Personal Data**: any data relating to an identified or identifiable
  natural person, per GDPR Art. 4(1). Includes pseudonymized data where
  re-identification is reasonably possible.
- **Soft Delete**: a record is marked as deleted and excluded from normal
  application queries and customer-facing UI, but remains recoverable in the
  primary datastore for a defined grace window.
- **Hard Delete**: a record is irrecoverably removed from the primary
  datastore, typically via a physical row delete or crypto-shredding of the
  encryption key protecting it.
- **Anonymization**: irreversible removal of identifying attributes such that
  the remaining data can no longer be linked to a natural person, even in
  combination with other data reasonably available to us.
- **Pseudonymization**: replacement of direct identifiers with a token or
  hash, where re-identification remains possible via a mapping table or by
  correlating the pseudonymous identifier against other retained signals
  (device fingerprint, IP, precise timestamp sequences).

## 4. Regulatory and Contractual Drivers

| Driver | Applies to | Key requirement |
|---|---|---|
| GDPR (EU/UK) | End-user event data, EU customer account data | Storage limitation (Art. 5(1)(e)), right to erasure (Art. 17) |
| CCPA/CPRA (California) | California end users and customers | Right to delete, right to know retention purpose |
| SOC 2 Type II | Security and audit logs | Evidence retention sufficient to support annual audit cycle |
| U.S. federal/state tax law | Invoices, payment records | 7-year retention for financial records |
| Customer DPAs | All end-user event data processed on a customer's behalf | Deletion within contractually agreed SLA (typically 30–45 days) of customer instruction or contract termination |
| Litigation hold obligations | Any data subject to a legal hold | Suspends normal deletion schedule for the affected records only |

Where these drivers conflict — for example, a DPA's 30-day deletion SLA
against SOC 2's expectation of a full year of security log history — the
stricter obligation for that specific data category governs, and any
exception is logged (Section 8).

## 5. Data Classification and Retention Schedule

| Category | Examples | Retention Period | Trigger | Legal Basis / Driver |
|---|---|---|---|---|
| Customer account & auth data | Org name, admin emails, hashed passwords, SSO config | Active + 90 days post-termination | Account closure | Contract, legitimate interest (fraud prevention) |
| End-user event data (raw) | Click, pageview, and conversion events tied to a pseudonymous ID | 25 months rolling | Event timestamp | Legitimate interest (year-over-year analytics), DPA |
| End-user event data (aggregated/model features) | Rollups, churn model feature store | Indefinite, reviewed annually | N/A | See Section 6.4 |
| Application logs | Request logs, error traces | 13 months | Log timestamp | Security monitoring, SOC 2 |
| Security/audit logs | Auth events, permission changes, admin actions | 7 years | Event timestamp | SOC 2, incident forensics |
| Backups (full + incremental) | Encrypted snapshots of production databases | 35 days rolling | Snapshot creation | Disaster recovery |
| Billing and financial records | Invoices, payment metadata (via Stripe), tax records | 7 years | Fiscal year end | Tax law |
| Support tickets & communications | Zendesk tickets, chat transcripts | 3 years post-close | Ticket closure | Contract support, quality review |
| Marketing contact data | Newsletter subscribers, webinar registrants | Until unsubscribe + 30 days | Opt-out event | Consent (GDPR/CAN-SPAM) |

## 6. Detailed Schedules and Rationale

### 6.1 User Account Data

Account and admin-user records are retained for the life of the customer
contract plus a 90-day post-termination window. The 90 days exists for two
practical reasons: it gives Sales and Customer Success a window to
re-engage a churned account without re-onboarding from scratch, and it
covers the typical 60-day invoice dispute period plus buffer. After 90 days,
account records are hard-deleted except for the minimum billing history
required under Section 6.6.

### 6.2 Application, Access and Security Logs

Application logs (request/response traces, error logs) are kept 13 months —
one month beyond a full year — so that Engineering can diff year-over-year
traffic patterns (e.g., Black Friday incident review) without carrying
multi-year log volume that nobody queries in practice. Security and audit
logs are held separately at 7 years, driven by SOC 2 auditor expectations and
by the fact that account-takeover investigations sometimes surface evidence
of slow-burn credential compromise that predates the incident by a long
margin.

### 6.3 Backups and Disaster Recovery

This is the schedule most likely to draw follow-up questions from a customer
security review, so it is worth stating plainly.

Production databases take encrypted incremental snapshots every 6 hours and a
full snapshot weekly, retained on a 35-day rolling window before automatic
overwrite. When a user's data is deleted — whether via a customer's own
deletion request, an end-user DSAR, or routine expiry under Section 6.5 —
the deletion is applied immediately to the production datastore (soft
delete) and irreversibly (hard delete / crypto-shred) within 30 days. But
that data can remain present inside backup snapshots taken before the
deletion, for up to 35 additional days until those snapshots roll off.

**Engineering's position**, and the one currently reflected in this policy,
is that this is the correct and honest trade-off. Our backup system uses
block-level deduplication and delta chaining for storage efficiency;
surgically redacting one user's rows from a historical snapshot would mean
either breaking the delta chain (forcing a full re-snapshot of everything
downstream) or maintaining a per-user redaction index across every backup
generation, which is a meaningfully different and more expensive system than
the one we run today. Backups are access-restricted to a two-person
break-glass procedure, never queried in normal operations, and encrypted at
rest with keys separate from the production KMS — so the practical
exposure of "deleted but not yet purged" data sitting in a backup is very
low. GDPR Recital 65 and subsequent regulatory guidance generally accept
that erasure obligations can be met by putting data "beyond use" rather than
requiring instant physical removal from every backup medium, provided the
delay is bounded and the data isn't accessed for any purpose.

**Legal's position**, which is a matter of ongoing internal disagreement
rather than a resolved question, is that "up to 65 days" (30 to hard-delete
in production, plus up to 35 more for backup rotation) is on the long side
of what a regulator or a sophisticated enterprise customer's security team
will accept as "without undue delay" under Art. 17, particularly for CCPA
requests, where enforcement guidance has trended toward stricter operational
expectations than GDPR's. Two customer DPAs signed in the last 18 months
(both enterprise media accounts) contractually commit us to full deletion,
backups included, within 45 days — which we can technically miss if a
deletion request lands right after a weekly full snapshot. Compliance has
flagged this gap twice; Engineering's counter is that rebuilding backup
architecture around per-record redaction is a multi-quarter project competing
against roadmap commitments, and that the actual risk (a regulator or
customer specifically requesting proof that backup-resident data was purged
within their contractual window, during the narrow days it wouldn't yet be)
is low relative to the engineering cost. This policy documents the current
production behavior (30 days + up to 35) as the operative standard;
resolving the gap against the two stricter DPAs is tracked as an open risk
in Section 11, not as a solved problem.

```yaml
# retention-jobs/backup-rotation.yaml — excerpt, purge-eligible snapshot policy
snapshot_policy:
  incremental:
    frequency: "6h"
    retention_days: 35
    delete_on_expiry: true
  full:
    frequency: "168h"   # weekly
    retention_days: 35
    delete_on_expiry: true
  access_control:
    mode: break-glass
    approvers_required: 2
    audit_log: security-audit-logs   # see Section 6.2, 7yr retention
```

### 6.4 Product Analytics and Behavioral Event Data

Raw, event-level data (individual clicks, pageviews, session data tied to a
pseudonymous visitor ID) is retained for 25 months on a rolling basis, then
hard-deleted. Twenty-five months, not 24, exists so that a customer running
a January retrospective can compare against the January thirteen months
prior without a data gap opening mid-analysis — a small operational
accommodation that Data Science requested and Legal accepted without much
friction, since it only extends raw retention by a month.

The harder disagreement is over the feature store: aggregated,
model-ready rollups derived from that raw event data (session counts,
recency/frequency/monetary features, engagement trend scores) are retained
**indefinitely**, subject only to an annual review. This is where Product
and Data Science's position and Legal's position genuinely diverge, and
where this policy currently sides with Product/Data Science while flagging
the tension rather than resolving it.

**The case for indefinite retention (Product, Data Science):** churn and
recommendation models materially improve with multi-year behavioral
history — seasonality effects (annual subscription renewal cycles, holiday
shopping behavior) only become visible with 24+ months of history per
customer cohort, and re-collecting that history from scratch after a
deletion would set model quality back by a year or more. The rollups are
pseudonymized: they're keyed to an internal visitor ID, not an email or
name, and the underlying raw events that could be cross-referenced to
re-identify a specific person are deleted at 25 months per the schedule
above.

**The case against (Legal, and specifically the DPO's read of GDPR storage
limitation):** "pseudonymized" is doing a lot of work in that argument, and
it does not mean "anonymized." The rollups retain enough behavioral
granularity — device class, approximate geography down to metro area,
precise-enough interaction timing — that combined with a customer's own
CRM data (which the customer can join against our pseudonymous ID via the
API we provide for exactly this purpose), a specific person can plausibly be
re-identified indefinitely into the future. Under GDPR, that makes the
rollups personal data indefinitely, and Article 5(1)(e)'s storage limitation
principle requires retention no longer than necessary for the stated
purpose — "indefinitely, reviewed annually" is not really a period at all,
and "improves model quality" is a legitimate-interest justification that
weakens the longer the data ages past the relationship with the original
processing purpose. A regulator examining this in detail would likely ask
why 5 years of history, not 25 months, isn't sufficient to capture
seasonality, and we do not currently have a data-driven answer to that
specific question — Data Science has evidence that more history helps, not
evidence pinpointing where the marginal value drops off.

The current operative policy is indefinite retention with annual review,
because Product's position carried the day in the FY26 policy revision.
This is recorded here as a live disagreement, not a settled one — see
Section 11.

### 6.5 Support and Communications Records

Support tickets and chat transcripts are retained for 3 years past ticket
closure, to support quality review, dispute resolution, and pattern analysis
for product bugs that resurface. This period was set by Customer Success
and has not been seriously contested by Legal, since the data is
lower-sensitivity and the retention period is well within norms for support
systems generally.

### 6.6 Billing and Financial Records

Invoices and payment metadata are retained for 7 years to satisfy IRS
recordkeeping requirements and equivalent state tax obligations. This is the
one retention period in this document that is not seriously contested by
any stakeholder — it is a bright-line legal requirement, Engineering's cost
to store it is negligible (financial records are low-volume relative to
event data), and Product has no competing interest. It is included here
mainly as a contrast: not every retention decision in this document is
contested, and it is useful to be explicit about which ones are settled and
which ones aren't.

## 7. Deletion Mechanics

Deletion proceeds in three stages for most data categories:

1. **Soft delete**: record flagged `deleted_at`, excluded from application
   queries and customer-facing exports within 24 hours.
2. **Hard delete**: record physically removed (or its encryption key
   destroyed, for data encrypted per-record) from the primary datastore
   within 30 days of soft delete.
3. **Backup rollout**: the record ages out of backup rotation naturally
   within 35 days of the last snapshot that contained it (see Section 6.3).

Cascading deletion (e.g., deleting a customer account also deletes its
users' event data) is enforced via foreign-key `ON DELETE CASCADE` in
Postgres for account-scoped tables, and via a nightly reconciliation job for
the event warehouse (Snowflake), which does not support cascading deletes
natively.

```sql
-- reconciliation-jobs/purge_orphaned_events.sql (nightly, Snowflake)
DELETE FROM events.raw_events e
WHERE e.visitor_id IN (
  SELECT visitor_id FROM deletion_requests
  WHERE status = 'confirmed'
    AND requested_at <= DATEADD(day, -30, CURRENT_DATE())
);
```

## 8. Litigation Holds and Legal Exceptions

Legal may place a hold on specific records or accounts, which suspends the
normal deletion schedule for those records only. Holds are tracked in the
`legal_holds` table and checked by all deletion jobs before execution. A
hold does not exempt the held data from security controls or access
restrictions — it only pauses deletion.

## 9. Data Subject Access and Deletion Requests (DSAR)

| Step | Owner | SLA |
|---|---|---|
| Request received (portal, email, or via customer as controller) | Support | Acknowledged within 5 business days |
| Identity verification | Support / Security | 5 business days |
| Data location and export/delete execution | Data Platform Eng | 25 calendar days from verification |
| Confirmation to requester | Legal | 30 calendar days from original request |

Where Fernbridge is a processor (end-user data collected via a customer's
SDK integration), DSARs from end users are routed to the customer as
controller; Fernbridge executes deletion on the customer's instruction, not
directly on the end user's request, per the DPA.

## 10. Roles and Responsibilities

| Role | Responsibility |
|---|---|
| Data Protection Officer | Owns this policy, interprets regulatory obligations, approves exceptions |
| VP Engineering, Data Platform | Owns deletion job implementation and backup architecture |
| Security | Owns audit log retention, access controls on backups |
| Product | Owns retention requirements for analytics/model features, represented in annual review |
| Customer Success | Executes account-level deletion on contract termination |
| Engineering on-call | Executes emergency data purges under legal hold release or breach response |

## 11. Known Limitations and Open Risks

This section exists so that this policy describes what we actually do, not
an idealized version of it.

- **Backup deletion window vs. contractual SLA (Section 6.3).** Two signed
  DPAs commit to 45-day full deletion including backups; our worst-case
  timeline (30 + 35 days) can exceed that by up to 20 days depending on
  where in the snapshot cycle a request lands. Tracked as risk R-114 in the
  compliance register; no engineering work is currently scheduled against
  it.
- **Indefinite feature-store retention (Section 6.4)** is reviewed annually
  but has not, in three review cycles, resulted in any data actually being
  deleted. The annual review has functioned as a checkpoint for
  re-affirming the status quo rather than a genuine sunset mechanism. The
  DPO has requested that the FY27 review include a proposal for a bounded
  maximum (e.g., 5 years) rather than indefinite-with-review; this has not
  yet been drafted.
- **Pseudonymization strength is not independently verified.** We do not
  currently have a formal re-identification risk assessment for the feature
  store data described in 6.4. Our internal argument that it is
  "sufficiently" pseudonymized has not been tested against an external
  standard (e.g., a k-anonymity or motivated-intruder analysis).

## 12. Review and Change History

| Version | Date | Summary |
|---|---|---|
| 3.2 | 2026-09-15 | Extended raw event retention 24 → 25 months per Data Science request |
| 3.1 | 2025-11-02 | Added CPRA-specific language; clarified processor vs. controller DSAR routing |
| 3.0 | 2025-02-10 | Introduced indefinite feature-store retention with annual review (Section 6.4) |
| 2.4 | 2024-06-01 | Reduced backup rotation window 60 → 35 days for cost optimization |
