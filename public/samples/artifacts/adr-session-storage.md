# ADR-0032: Web Session Storage — Redis vs. a Postgres Sessions Table

**Status:** Accepted
**Date:** 2026-06-11
**Owners:** Platform Infrastructure team (@d.arnett, @s.okafor)
**Reviewers:** Backend Guild, SRE on-call leads
**Related:** ADR-0019 (Move to stateless app servers), ADR-0027 (RDS Postgres as system of record)

## Context

Quillstack's web application currently authenticates users with a signed
cookie that references a session record. Until last quarter, sessions lived
in the memory of whichever Node process handled the login request, and we
relied on sticky sessions at the load balancer to route a given user back to
the same instance. ADR-0019 removed sticky routing so we could autoscale the
web tier horizontally and roll deploys without dropping active users. That
means session state now has to live somewhere all app instances can reach.

We need a shared, low-latency store for session data: session ID, user ID,
workspace ID, permission snapshot, MFA-verified flag, and a handful of UI
preference fields we started stuffing into the session object two years ago
and never migrated out. Current session count sits around 40,000 concurrent
sessions at peak (weekday mornings, US and EU business hours overlapping),
growing roughly 8% quarter over quarter alongside seat growth. Sessions are
read on nearly every authenticated request — the auth middleware does a
session lookup before anything else happens — so read latency on this store
sits directly in the critical path of every API call and page load.

Session writes are much less frequent than reads: we write on login, on
MFA step-up, on permission changes (workspace role updated, seat removed),
and roughly every 15 minutes to slide the expiration window forward for
active users. Read:write ratio is somewhere around 200:1 based on current
request logs.

We already run a production Postgres cluster (RDS, Multi-AZ, `db.r6g.xlarge`
primary plus two read replicas) for the core application data — workspaces,
documents, permissions, billing. We do not currently run any in-memory
caching layer in production. Introducing Redis would be a new category of
infrastructure for the team to operate: a new failure mode, a new thing to
monitor, patch, and reason about during incidents, and a new line item for
whoever owns the AWS bill.

## Decision Drivers

- **Read latency** on the auth-critical path (p99 budget: 15ms for the
  session lookup itself, out of a 200ms total request budget)
- **Operational surface area** — the team is four engineers and already
  carries on-call for the API, the web tier, and the Postgres cluster
- **Consistency requirements** — a permission change (e.g., seat removed)
  must be reflected in the next request from that user, not eventually
- **Cost** at current and 18-month-projected scale
- **Team familiarity** — three of four platform engineers have deep
  Postgres experience; nobody on the team has run Redis in production before
- **Native TTL / expiry semantics** for session cleanup

## Options Considered

### Option A: Redis (Amazon ElastiCache, Multi-AZ with cluster mode)

Store sessions as Redis hashes keyed by session ID, with `EXPIRE` set on
each key matching the session's sliding expiration window. Reads and writes
are both O(1) key lookups against an in-memory store built for exactly this
access pattern.

**Pros**

- Sub-millisecond read/write latency under normal load
- Native key expiry means stale sessions disappear on their own — no
  cleanup job to write, schedule, or debug
- Purpose-built for this workload; this is the textbook Redis use case
- Fully decoupled from the primary OLTP database — session traffic can
  spike (e.g., a bot triggering mass logout/login cycles, or a client
  library bug causing retry storms) without touching Postgres capacity at
  all

**Cons**

- New piece of infrastructure: cluster mode has its own operational
  quirks (resharding, hot keys, `MOVED`/`ASK` redirects), and Multi-AZ
  failover takes several seconds during which writes can fail or, in some
  failure modes, be lost
- No one on the team has operated Redis in production; there's a real
  ramp-up cost and a real chance we misconfigure something (eviction
  policy, maxmemory settings) in a way that doesn't show up until we're
  under load
- Additional AWS spend: roughly $340/month for a `cache.r6g.large`
  Multi-AZ pair at current sizing, growing with session count
- Redis Multi-AZ failover is not synchronous by default; depending on
  replication lag at the moment of failover, a just-written session
  (e.g., a fresh MFA step-up) could be lost, silently logging a user back
  down to a lower trust level. This is rare but not zero.

### Option B: Postgres sessions table on the existing RDS cluster

Add a `sessions` table (`id`, `user_id`, `workspace_id`, `data jsonb`,
`expires_at`, `created_at`, `updated_at`) to the existing production
database, with an index on `id` and a partial index on `expires_at` for
cleanup. Reads go through the existing read replicas where consistency
allows; writes go to the primary.

**Pros**

- Zero new infrastructure. Same backup strategy, same monitoring, same
  IAM/networking, same failover behavior we already understand and have
  run incidents against
- Full ACID guarantees — a permission-change write and a session-read are
  both subject to the same transactional semantics we already reason about
  everywhere else in the app. No separate consistency model to think
  through for this one subsystem.
- The team can write, debug, and tune this with existing skills. No new
  runbook category.
- Cost is effectively zero at current scale — the added table and indexes
  are small relative to the existing database, and we're not paying for a
  new cluster
- Point-in-time recovery, snapshotting, and encryption-at-rest are already
  configured for this cluster and cover sessions for free

**Cons**

- Every authenticated request now issues an additional query against the
  same database that serves core application traffic. At 200:1 read:write
  and ~40k concurrent sessions, we estimate roughly 900 additional queries
  per second at peak against a cluster that's currently running at 35-40%
  CPU on the primary and comfortably under capacity on replicas.
- No native TTL. Expired sessions accumulate until a cleanup job deletes
  them; we'll need a scheduled job (pg_cron or an application-level cron)
  and it needs to not run during peak traffic or it will contend for locks
  on a hot table.
- Row-level lock contention on a hot `sessions` table is a real risk if
  the 15-minute sliding-expiration touch and a concurrent permission-change
  write land on the same row at the same moment. Unlikely to be common,
  but the failure mode (a blocked auth request) is worse than the
  equivalent Redis case (a slightly stale read).
- Couples session availability to primary database availability. If the
  primary is down or saturated — for any reason, including something
  entirely unrelated to auth, like a slow migration or a bad analytics
  query — logins and every authenticated request degrade together. There
  is no independent failure domain for "can users prove who they are."

### Option C: DynamoDB

Considered and rejected quickly. We have no existing DynamoDB usage
anywhere in the stack, it would be a second new infrastructure category
(on top of whichever of A/B we didn't pick), and per-request pricing at our
volume is harder to reason about than either alternative. Not explored
further in this ADR.

## Decision

We will use **Option B: a Postgres sessions table on the existing RDS
cluster.**

The deciding factors were operational surface area and team familiarity.
We are a four-person platform team already carrying on-call for three
production systems. Adding Redis means adding a fourth thing that can page
someone at 2am, and it would be the one thing on that list nobody has
operated before. The cost savings are real but secondary — the operational
argument would hold even if Redis were free.

We recognize this decision trades a well-isolated, purpose-built solution
for one that adds load to a shared, already-critical system, and reasonable
engineers on this team disagreed about whether that trade is worth it. The
counterargument — that coupling the availability of "prove who you are" to
the availability of "look up a workspace's documents" removes a failure
domain we currently don't have to think about, and that this coupling
matters more as we scale than the operational-simplicity argument does —
was raised in review and is not fully resolved by this ADR. We are making a
bet that our current database headroom (see Decision Drivers) and existing
Multi-AZ failover behavior make that coupling acceptable through at least
the next scaling milestone, and we're documenting the disagreement rather
than pretending it wasn't raised.

## Consequences

**Positive**

- No new infrastructure category to operate, monitor, or carry on-call for
- Session data inherits existing backup, PITR, and encryption-at-rest
  posture for free
- Strong consistency for permission-sensitive session fields, by
  construction, with no separate cache-invalidation logic to get wrong
- Lower near-term cost

**Negative**

- Adds an estimated 900 QPS to the primary database's query load at
  current peak, projected to grow with session count independent of core
  application load growth
- Session availability is now coupled to primary database availability;
  a database incident is now also an auth incident
- Requires a new scheduled cleanup job for expired session rows, which we
  did not previously need and which itself needs to be scheduled carefully
  to avoid contending with peak traffic
- Revisiting this decision later means a live migration of session state
  with zero acceptable downtime, which is more disruptive than standing up
  Redis alongside the existing store would have been

## Mitigations

- Session reads will go through the read replicas wherever the request
  path tolerates replica lag (i.e., everywhere except immediately after a
  permission-changing write, where we'll read-your-writes from the
  primary for a short grace window)
- The `sessions` table gets its own connection pool (PgBouncer, separate
  pool from the main application pool) so a spike in session traffic
  cannot starve connections for core application queries, and vice versa
- Cleanup job runs hourly at low-traffic windows (03:00 and 15:00 UTC,
  chosen to fall outside both US and EU business hours) and deletes in
  batches of 5,000 rows to avoid long-held locks
- We will track primary CPU, connection pool saturation, and p99 session
  lookup latency on a dedicated dashboard for the first two full traffic
  cycles after rollout, with a rollback path (dual-write to Redis,
  documented but not built) if the added load proves worse than modeled

## Revisit Triggers

We should revisit this ADR if any of the following happen:

- Concurrent session count exceeds ~150,000 (roughly 3.5x current peak)
- Primary database CPU at peak exceeds 65% sustained over a rolling 7-day
  window
- We experience two or more incidents in a quarter where a database issue
  unrelated to auth (e.g., a slow migration, an analytics query) causes
  measurable login or session-lookup latency degradation
- We adopt Redis for another purpose (e.g., rate limiting, job queues) and
  the marginal operational cost of also moving sessions onto it drops
  significantly

## Follow-up Work

- [ ] Add `sessions` table migration and partial index on `expires_at`
- [ ] Stand up dedicated PgBouncer pool for session queries
- [ ] Write and schedule the cleanup job
- [ ] Build the session-lookup latency dashboard and alert on p99 > 15ms
- [ ] Document the rollback path to Redis in the runbook wiki, even though
      we are not building it now, so a future on-call engineer isn't
      starting from zero if we hit a revisit trigger under pressure
