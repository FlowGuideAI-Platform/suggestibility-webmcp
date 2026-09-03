# Postmortem: Authentication Outage, 2026-06-11 (INC-2231)

**Status:** Final
**Severity:** SEV-1
**Duration:** 4h 07m (07:52–11:59 UTC)
**Customer impact:** 100% of active tenants unable to log in or refresh sessions; ~61% of already-logged-in users hit a hard re-auth wall within the first 40 minutes as short-lived access tokens expired
**Postmortem owner:** the incident commander (IC) for INC-2231
**Review status:** Reviewed by Auth Platform, SRE, Security, and Support leads. This document is blameless by policy — see Section 9.

This document follows Northlane's standard blameless postmortem template. Its purpose is to establish what happened, what we believe caused it, what we're uncertain about, and what we're committing to change. Section 4 (Root Cause) and Section 5 (Contributing Factors) were the most debated sections internally, and we've kept some of that disagreement visible rather than smoothing it into a single tidy narrative, because we think the disagreement is informative.

## 1. Summary

At 07:52 UTC, a scheduled signing-key rotation for Northlane Identity (our internal auth service, used by all customer-facing products) completed successfully by its own internal health check. Within 90 seconds, JWT validation for newly issued and refreshed tokens began failing across all regions. Because our access tokens are short-lived (15 minutes) and validation failures were indistinguishable at the edge from "expired token, please re-authenticate," the practical effect was that every customer session degraded to requiring a fresh login within the 15-minute token lifetime window, and fresh logins were themselves failing the same validation check. This produced a full authentication outage: no customer could log in, and no customer with an active session could stay logged in past their token's remaining TTL. The outage lasted until 11:59 UTC, when we completed an emergency reissue of the signing key material and a forced global purge of the CDN-layer JWKS cache.

No customer data was exposed or modified. This was an availability incident, not a confidentiality or integrity incident.

## 2. Timeline (UTC)

| Time | Event |
|---|---|
| 07:50 | Scheduled key rotation job (`identity-key-rotate`, runs every 90 days per our key hygiene policy) begins. |
| 07:52 | Rotation completes. New signing key (`kid: 2026-06-a`) is active in the identity service's primary key store. Old key (`kid: 2026-03-c`) is marked revoked and removed from the identity service's live key store per the rotation job's "immediate revocation" step (see Section 4). |
| 07:52–07:53 | Identity service begins signing all newly issued tokens with `2026-06-a`. |
| 07:54 | First elevated 401 rate visible in raw edge logs (not yet alerted on — see Section 6). |
| 08:14 | First customer-reported login failures reach Support via the normal ticket queue, tagged as routine "can't log in" tickets, not yet escalated. |
| 08:31 | Support lead notices ticket volume for "can't log in" is ~40x the hourly baseline and pages the on-call SRE. |
| 08:36 | On-call SRE acknowledges page. Confirms elevated 401 rate on the auth service dashboards. Auth service's own health check (which checks liveness and DB connectivity, not end-to-end token validation) is green, which delays the initial diagnosis. |
| 08:47 | On-call SRE escalates to the auth platform secondary contact, who is off-shift and takes 19 minutes to respond (no dedicated auth on-call rotation exists; escalation goes to whichever auth platform engineer is listed as the general team contact, per Section 5). |
| 09:06 | Auth platform engineer joins the incident. Declares SEV-1. IC assigned. |
| 09:12 | Status page updated to "investigating" — 1h 20m after first customer-visible impact, and after Support had already fielded several dozen tickets and at least one customer post on a public forum, which is how our own marketing team first found out. |
| 09:20 | Team identifies that JWT validation failures correlate exactly with the 07:52 key rotation. Working theory: edge/CDN layer is still serving the old JWKS document (which lists `2026-03-c` as the valid key) because of a cache TTL, while the identity service is signing with `2026-06-a`, which the edge doesn't yet know about. |
| 09:31 | First mitigation attempt: manually purge the CDN cache for the JWKS endpoint in the primary region. Purge succeeds; 401 rate does not improve. |
| 09:44 | Team discovers the purge alone doesn't help because the *client-side* JWKS cache in several of our own service SDKs (the internal library each product team uses to validate tokens) has its own 60-minute in-process cache, independent of the CDN. Even with a fresh CDN response, individual service instances won't pick up the new key until their own cache expires or the process restarts. |
| 09:58 | Second mitigation attempt considered: roll back the key rotation, reinstating `2026-03-c` as valid. Discovered to be **not possible** — the rotation job's revocation step had already deleted the old key material from the HSM-backed key store as part of its "immediate revocation for security hygiene" design (Section 4). There is no key to roll back to. |
| 10:05 | Team pivots to forward-fix: force-restart all service instances platform-wide to clear in-process JWKS caches, combined with a global (not just primary-region) CDN purge. |
| 10:05–11:40 | Rolling restart executed across all regions and all consuming services (production has 34 services that validate tokens independently, each with its own SDK cache instance — enumerating and confirming restart of all 34 took the bulk of this window). |
| 11:40 | 401 rate returns to baseline in the primary region. |
| 11:52 | Confirmed at baseline in all regions. |
| 11:59 | Incident declared resolved after 15 minutes of stable metrics and a successful synthetic login test from each region. |
| 12:30 | Public status page updated to "resolved." Customer communication sent. |

## 3. Impact

- 100% of customer-facing login attempts failed for the duration of the outage.
- Estimated 61% of users with an active session were forcibly logged out as their access tokens expired and refresh attempts also failed (refresh uses the same validation path).
- Support received 1,340 tickets in the 4-hour window, roughly 55x normal volume for that period.
- Three enterprise customers invoked contractual SLA credit clauses; estimated credit exposure is being finalized with Finance separately from this document.
- No data was read, written, or exfiltrated outside of normal authenticated access patterns — this was strictly an inability to authenticate, not a security breach of any tenant's data.

## 4. Root Cause

**As determined by the incident review and agreed by the auth platform team:** the root cause was a **CDN cache TTL misconfiguration on the JWKS endpoint**. The JWKS document (the public keys clients use to verify token signatures) was cached at the CDN edge with a 24-hour TTL, rather than the 5-minute TTL specified in the original design doc for this endpoint from three years ago. Nobody had verified in some time that the deployed TTL matched the design doc; it appears to have been set to 24 hours during a general CDN cost-optimization pass 14 months ago that raised default TTLs across several low-write endpoints, and the JWKS endpoint was swept up in that change without anyone flagging that it was cache-sensitive in a way most of the other endpoints weren't. When the key rotation happened, edge nodes continued serving the stale JWKS document — listing only the old, now-revoked key — for up to 24 hours, causing every token signed with the new key to fail validation at any edge node that hadn't organically cycled its cache.

**The corrective action shipped for this (Section 8, AI-1 and AI-2) is to fix the TTL and add a mandatory manual purge step to the rotation runbook.**

**Dissenting view, recorded per our blameless postmortem policy of not suppressing disagreement:** one of the auth platform engineers involved in the response, and independently the security lead who reviewed this document, both flagged that framing the TTL as *the* root cause understates the actual failure mode. Their view, which the rest of the reviewing group did not fully adopt but agreed was worth recording: the TTL misconfiguration was the *proximate trigger*, but the reason it caused a full outage rather than a brief, partial degradation is that **Northlane Identity's key rotation has no overlap window** — the old key is signed out of validity at the exact moment the new key becomes the only valid one, with no period where both are simultaneously accepted. Every mature JWKS-based rotation pattern we're aware of (and several of our own API design docs for *other* systems specify this) keeps the previous key valid for a grace period after rotation, specifically so that any propagation delay anywhere in the chain — CDN cache, client SDK cache, a slow config reload, a network partition — degrades gracefully instead of causing a hard cliff. Under that view, the TTL bug was almost incidental: if the TTL had been correctly set to 5 minutes, we still would have had *some* window of correlated failures on every rotation, just a shorter one, and the underlying fragility — that the system has zero tolerance for any propagation delay, from any cause, at the exact moment of rotation — would have remained unaddressed and would eventually have been triggered by something else (a slow config rollout, a partial CDN outage, a client SDK bug). The counterargument, from the auth platform lead, is that a 5-minute TTL working as designed would have kept the failure window under 5 minutes and likely below the threshold where it becomes customer-visible at all, so calling the missing overlap window "the real root cause" overstates a design gap that has apparently never caused a problem in three years of quarterly rotations at the correct TTL.

We are not resolving this disagreement in this document. Both framings are defensible, and they lead to different action item priorities (see Section 8), which is part of why we're surfacing the disagreement explicitly rather than picking one narrative.

## 5. Contributing Factors

1. **No dedicated on-call rotation for the auth platform.** Escalation from the generalist on-call SRE to someone who understood the JWKS/key-rotation subsystem took 30 minutes (08:47–09:12 including the page delay), during which the team was diagnosing partly blind. The auth platform team is 4 engineers; a dedicated 24/7 rotation for a team that size has real cost and quality-of-life implications, which is why it hasn't existed to date — this incident is the first time the gap has been directly costly.
2. **Health checks did not cover the failure mode.** The auth service's health check verifies process liveness and database connectivity, not "can this service actually issue and validate a token end-to-end." A synthetic end-to-end login probe would very likely have caught this within seconds rather than the ~40 minutes it took for ticket volume to trigger a page.
3. **401 responses were excluded from the primary error-rate alerting.** Our SLO dashboards and paging alerts are scoped to 5xx rates by design, on the reasoning that 401s are frequently legitimate (expired sessions, bad credentials) and a naive 401-rate alert would be noisy. That reasoning is still probably correct in general, but it meant a genuine, service-wide 401 spike produced no automated signal at all, and detection depended entirely on Support noticing ticket volume — which took 40 minutes and only worked because the Support lead happened to be reviewing the queue at that moment.
4. **The rotation job's immediate-revocation behavior removed our rollback option.** The rotation job was originally built with immediate revocation of the old key as an intentional security choice — minimizing the window during which a compromised old key could still be used, on the theory that if a rotation is happening at all, keeping the old key valid any longer than necessary is exposure we don't need. That's a coherent security argument on its own terms. Its side effect, not fully appreciated at design time, is that it also deletes our only rollback path the instant a rotation completes, which meant that once we diagnosed the problem, "revert the rotation" was not an available option at any point in the incident, and we were committed to a forward-fix from the moment the old key was deleted, regardless of how bad the forward-fix turned out to be.
5. **Communication lag to customers and internally.** Status page update at 09:12 was 1h20m after first impact. Marketing and Sales leadership learned about the outage from a customer's public social post before they learned about it internally. Our incident communication runbook says to update the status page "as soon as impact is confirmed," but confirmation itself was delayed by factor #3, so this is partly downstream of detection delay rather than a separate communication failure — worth naming as its own factor anyway because even after detection, the update took another 36 minutes.
6. **Rotation runbook was stale.** The documented rotation procedure referenced a deprecated internal CLI tool for manual key management; the automated job had replaced this tool 8 months ago but the runbook wasn't updated, which meant that during the incident, an engineer's first instinct to "just manually push the old key back" following the documented procedure did not work and cost roughly 6 minutes of confusion before the team realized the tooling referenced no longer existed in that form.

## 6. Detection

Time to detection (first customer impact to acknowledged page): approximately 42 minutes, driven almost entirely by contributing factor #3 (401s excluded from alerting) and #2 (health check doesn't cover token validation end-to-end). We consider this the single most fixable gap in the whole incident and have prioritized it accordingly (AI-3).

## 7. What Went Well
