# Tenant Isolation Architecture — Cordant Workspace

**Document owner:** Principal Engineer, Platform Security
**Status:** Living document, current as of platform v4.3
**Audience:** Engineering, Security, Compliance, prospective enterprise customers under NDA (a redacted version of this document is part of our SOC 2 evidence package)
**Scope:** Data separation, key management, and authorization model for Cordant Workspace, our multi-tenant B2B document workflow platform

## 1. Overview and Threat Model

Cordant Workspace is a multi-tenant SaaS platform used by logistics and supply-chain companies to manage contracts, customs documentation, and shipment records. As of this writing we serve 312 tenant organizations ranging from 5-person freight brokers to a small number of enterprise accounts with thousands of users. All tenants share the same application tier and, for the large majority, the same database infrastructure — this document exists because "the same database infrastructure" is the single fact about our architecture that every security review, every enterprise procurement questionnaire, and every internal engineer onboarding needs to understand precisely, not approximately.

The threats we are primarily defending against, in rough priority order:

1. **Cross-tenant data leakage via application or database bugs** — a query, a caching layer, or a background job that returns or writes Tenant A's data in a context scoped to Tenant B. This is the threat this document spends the most space on, because it's the one most directly shaped by our architecture rather than by conventional access control.
2. **Compromise of a single tenant's credentials or API keys being used to pivot to other tenants** — mitigated primarily by the authorization model in Section 5.
3. **Insider risk** — a Cordant employee (engineer, support agent) accessing tenant data outside the scope of their job function. Covered in Section 5.3 and Section 8.
4. **Physical/infrastructure compromise** — a compromised database host, a stolen backup, a compromised KMS key. Covered in Section 4.

We do not treat these as independent; the design choices below trade strength against one threat for weakness against another in a few places, and we've tried to be explicit about where that happens rather than presenting the architecture as uniformly strong.

## 2. Tenant Data Separation Model

### 2.1 Why shared schema, not schema-per-tenant or database-per-tenant

We evaluated three models before building the current system:

- **Database-per-tenant:** strongest isolation, worst operational scaling. At 312 tenants and growing toward an expected 800+ within two years, running migrations, connection pooling, and monitoring across hundreds of independent databases was judged operationally infeasible for a team our size (11 engineers on the platform team at the time of the original design, now 19).
- **Schema-per-tenant, single database:** a middle ground some peer companies use. Still requires per-tenant migration orchestration and doesn't meaningfully reduce blast radius versus shared-schema-with-RLS if the database credentials themselves are shared across schemas, which they would be in our deployment model.
- **Shared schema, row-level tenant_id, enforced via Postgres Row-Level Security (RLS):** what we built. Every tenant-scoped table carries a `tenant_id` column, and RLS policies restrict every query to rows matching the session's current tenant context. This gives us single-database operability (one set of migrations, one connection pool, one place to apply a security patch) at the cost of isolation depending on the RLS policy being correctly applied on every table, every time, with no exceptions — which is exactly the property that Section 6 explains is not quite true in practice.

Representative policy, applied to all ~60 tenant-scoped tables:

```sql
ALTER TABLE shipment_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON shipment_documents
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

`app.current_tenant_id` is a session-local Postgres setting, set once per request by application middleware immediately after acquiring a connection from the pool, before any tenant-scoped query runs.

### 2.2 Connection pooling and session context — the sharpest edge in this design

Because we use PgBouncer in transaction pooling mode for connection efficiency (our peak concurrent request volume would not be servable with one Postgres connection per request), a physical database connection is reused across many logical application requests, potentially for different tenants, in sequence. This means `app.current_tenant_id` must be **set fresh on every single request**, without exception, or a connection carrying stale context from the previous request's tenant could serve the wrong tenant's data to the current request if any code path queries before the middleware sets context.

We've built this as connection-acquisition middleware that runs first, before any handler code, and it is covered by an integration test suite that specifically checks — for every route in the application — that no query executes before `SET app.current_tenant_id` for that request. This has caught two regressions in the two years since it was built, both in newly added background-job code paths that didn't go through the standard request middleware (jobs are enqueued and dequeued outside the HTTP request lifecycle, so they set tenant context via a separate, less-exercised code path). We consider this test suite necessary but are not fully confident it's sufficient — it tests known route registration, and a sufficiently unusual code path (a raw SQL query issued from a Rails console during an incident, for instance, which has happened) bypasses it entirely, relying on the human operator to set context manually or scope their query with an explicit `WHERE tenant_id = ...` instead.

RLS is our primary isolation control specifically because it fails closed at the database layer regardless of application-layer bugs in query construction — an application bug that forgets a `WHERE tenant_id = ?` clause is caught by RLS rather than becoming a cross-tenant leak. The place RLS does *not* protect us is exactly the scenario above: a connection that has the wrong tenant context set (or no context set, which fails closed and just errors, actually the safer failure) versus a connection with a *stale but valid-looking* tenant context from connection reuse, which is the failure mode that would silently succeed and return wrong-tenant data rather than erroring.

### 2.3 Enterprise dedicated-infrastructure tier

Nine of our largest enterprise accounts, representing roughly 34% of ARR, are contractually entitled to (and pay a premium for) dedicated database infrastructure — a separate Postgres instance, not shared with the multi-tenant pool. These tenants still use the same RLS policies (defense in depth, and it keeps the codebase from branching on tenant tier), but a bug in shared-pool isolation categorically cannot affect them, because there is no shared pool to leak from. This tier exists because several of these accounts' own security reviews would not accept "you're isolated by a row-level policy alongside 300 other companies" as a sufficient answer, and we agreed that for accounts of that size, we should not be arguing the point.

## 3. Key Management and Encryption

### 3.1 Envelope encryption for sensitive fields

Beyond Postgres's storage-level encryption (which protects against physical media theft, not much else), fields classified as sensitive — bank routing/account numbers on payment instructions, customs identification numbers, and a handful of free-text fields flagged by our data classification pass as frequently containing PII — are encrypted at the application layer using envelope encryption:

```
Plaintext field
   → encrypted with a per-tenant Data Encryption Key (DEK)
      → DEK itself encrypted ("wrapped") by a regional KMS Customer Master Key (CMK)
         → wrapped DEK stored alongside the ciphertext; CMK never leaves KMS
```

Each of our 312 tenants has its own DEK, generated at tenant creation and rotated annually. This gives us a real, meaningful property: **compromising one tenant's DEK (e.g., via an application bug that logs a decrypted field, or a backup restored to the wrong place) does not expose any other tenant's sensitive fields**, because each DEK only decrypts that one tenant's data.

### 3.2 The single-CMK trade-off

All 312 tenant DEKs are wrapped by **one regional KMS CMK** (per region — we operate in a single region today, so effectively one CMK total). We chose this over per-tenant CMKs for a straightforward reason: KMS CMK operations carry a per-request cost and a regional request-rate quota, and wrapping/unwrapping at our request volume against 312 independent CMKs (versus one) would meaningfully increase both cost and the chance of hitting throttling under load, for a property — per-tenant *key-wrapping* isolation, on top of the per-tenant DEKs we already have — whose incremental security benefit over per-tenant DEKs-under-one-CMK is real but, we judged, secondary to DEK-level isolation for our current threat model.

The honest accounting of what this trade-off costs us: if the single CMK were ever compromised (KMS itself compromised, or IAM misconfiguration granting unauthorized `kms:Decrypt` against it), an attacker with that access could unwrap *every* tenant's DEK, which reduces the practical isolation benefit of per-tenant DEKs to "meaningfully slows down and requires an extra step for" rather than "prevents." Per-tenant DEKs still stop the much more likely failure modes — an application bug, a database backup mishandling, a single tenant's data being restored to the wrong environment — cold, because none of those failure modes involve the KMS layer at all. But we want to be precise that "per-tenant encryption keys" is doing less work than it might sound like it's doing, given that they all answer to one CMK. Moving to per-tenant CMKs later, if we decide the cost is justified (e.g., a large customer requires it, or our tenant count and threat model shift), is possible but not free — it requires re-wrapping every existing DEK and updating key-reference metadata across the fleet, which is a migration, not a config change, so the cost of deferring this decision compounds the longer we wait and the more tenants we add under the current scheme.

### 3.3 Key access logging

Every `kms:Decrypt` and `kms:GenerateDataKey` call is logged with the requesting service identity, the tenant DEK identifier involved, and a request ID that ties back to the originating application request where available (background jobs and some batch decryption paths do not always carry a traceable request ID — see Section 8). These logs are retained for 400 days and are part of our SOC 2 evidence.

## 4. Authorization Model

### 4.1 Tenant-scoped tokens

Every authenticated session (human user or service-to-service API key) resolves to a token carrying a `tenant_id` claim, issued by our internal identity service. All application-layer authorization checks are scoped by this claim before any RBAC role check happens — a request cannot be authorized for *any* action against Tenant A's resources unless its token's `tenant_id` claim is Tenant A, full stop, independent of role. Role-based checks (admin, editor, viewer, and a handful of workflow-specific roles like `customs-reviewer`) then further restrict what an already tenant-scoped token can do within that tenant.

### 4.2 Service-to-service authorization

Internal services authenticate to each other using short-lived mTLS-backed service tokens, scoped to the specific downstream service and the specific operation, generated per-request from the originating user or job's tenant context. A service cannot mint itself a token for an arbitrary tenant; the tenant scope is always inherited from whatever triggered the call.

### 4.3 Support impersonation ("assisted access")

Customer support agents need to see what a customer sees in order to troubleshoot — this is a normal and necessary support capability, not an anomaly, and we've built it as a first-class, audited feature rather than leaving it to informal database access (which is how it worked before this system was built three years ago, and which we consider strictly worse).

A support agent can request "assisted access" to a specific tenant, for a specific, logged reason, which:
