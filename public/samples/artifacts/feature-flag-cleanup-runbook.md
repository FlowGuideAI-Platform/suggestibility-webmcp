# Runbook: Removing Stale Feature Flags

**Audience:** Any engineer cleaning up a flag they or their team own
**Owning team:** Platform Infrastructure (flag service maintainers)
**Last updated:** 2026-07-22
**Related:** Feature Flag Usage Guidelines, Flagboard admin docs

## Why this runbook exists

We currently have 214 flags in Flagboard (our internal flag service, thin
wrapper around a hosted provider). A quarterly audit in April found that
61 of them had been at 100% rollout for more than 90 days with no active
experiment attached — dead weight that still gets evaluated on every
request and still shows up when someone's grepping the codebase trying to
understand what's actually configurable. Stale flags are a real cost: they
make the code harder to read, they're a source of "wait, is this thing
even doing anything" Slack threads, and every once in a while one of them
turns out to be silently gating something nobody remembers gates it.

This runbook standardizes how we remove a flag once it's done its job, so
cleanup doesn't depend on whoever's doing it improvising the steps under
time pressure. Follow it in order.

## Before you start: is this flag actually safe to remove?

Not every flag that's "at 100%" is safe to delete. Check all of these
before proceeding:

- [ ] Flag has been at 100% rollout (or 0%, if it's a permanent kill
      switch you've decided to retire) for at least 30 days with no
      rollback in that window
- [ ] No active experiment or gradual rollout references this flag key in
      Flagboard's experiment tab
- [ ] Flag is not referenced in any other team's codebase — search across
      all repos, not just the one you're working in (see Step 5 for the
      search command; run it before you commit to doing the cleanup, not
      just when you get there)
- [ ] Flag is not a documented permanent operational kill switch (these
      are tagged `kill-switch` in Flagboard and are explicitly out of
      scope for this runbook — see the separate Kill Switch Lifecycle doc)
- [ ] You've identified the flag's owner (Flagboard shows "created by,"
      but the actual current owner may have moved teams — check with the
      team lead if it's unclear)

If any of these are unclear, post in `#eng-releases` and get a second
person to confirm before proceeding. Flag cleanup is low-risk work most of
the time, which is exactly the kind of work where skipping the checklist
because "it's just cleanup" bites you.

## Step-by-step

### Step 1: Identify the candidate flag

Pull the list of flags eligible for cleanup from the monthly Flagboard
audit report (`#flag-audit` channel, posted the first Monday of each
month), or run the audit query yourself:

```
flagboard-cli audit --min-age-days 30 --status stable
```

This returns flags at a fixed rollout percentage (0% or 100%) for at least
the given window, with no active experiment.

### Step 2: Confirm with the flag owner

Reach out to whoever owns the flag (or the feature it gates) and confirm
it's genuinely done — no planned rollback, no dependent work still in
flight elsewhere. Get an explicit yes in writing (Slack thread is fine).
This step gets skipped more than any other on this list and it's the one
most likely to save you from an awkward revert.

### Step 3: Post notice in `#eng-releases`

Announce the flag you're removing, which repos/services it touches, and
your target removal date. Give at least 24 hours before proceeding, so
anyone with context you don't have (an in-flight migration, a customer-
specific override, a debugging session that depends on the flag still
existing) has a chance to flag it.

### Step 4: Archive the flag in Flagboard

Once notice period has passed with no objections, archive the flag in the
Flagboard dashboard (Settings → Flag → Archive, not Delete — archiving
keeps the flag's history and evaluation logs for audit purposes, while
freeing up the flag key for reuse and removing it from the active flags
list that engineers see day to day).

Archiving does the following:

- Removes the flag from the default "active flags" view
- Stops the flag from being editable via the dashboard UI (prevents
  someone from accidentally re-enabling a partial rollout on something
  that's being decommissioned)
- Excludes the flag from the ruleset payload our SDKs poll every 30
  seconds, so any remaining `isEnabled()` call for this key stops getting a
  server-evaluated result and falls through to the default value passed at
  the call site in code

That last point sounds bigger than it is in practice. The default value at
the call site is almost always whatever the flag evaluated to before this
whole cleanup process started — the flag's been stable at 100% (or 0%) for
30+ days precisely because that's the value engineers hardcoded as the
fallback when they first wrote the flag check, back before the rollout
ramped. So archiving early just means the SDK starts serving the same
fallback constant it would've served on a flag-service outage, which we
already treat as an acceptable degraded state elsewhere. Doing this ahead
of the code cleanup also means the code-removal PRs in Step 6 aren't racing
a live rollout — by the time you touch the code, the flag's already been
sitting in its final state for however long the PRs take to land.

This step is a good checkpoint because it's easily reversible (unarchive
takes seconds) if something in the next steps turns up an objection you
didn't anticipate, and it signals clearly to the rest of the org — via the
dashboard — that this flag is on its way out.

### Step 5: Find every code reference

Search across all repos for the flag key. Don't rely on memory or on
knowing "which service" — flags get referenced from unexpected places
(admin tooling, internal scripts, a debug page nobody's opened in a year).

```bash
# from the monorepo root, or run per-repo if your org isn't monorepo'd
rg -l "your-flag-key-here" --type-add 'flagfiles:*.{ts,tsx,js,py,go}' -t flagfiles
```

Cross-check the results against Flagboard's own "last evaluated from"
telemetry (Settings → Flag → Usage) to make sure you're not missing a
service that evaluates the flag via a code path your grep didn't catch
(e.g., a dynamically constructed flag key, which a couple of our older
services still do — check the Usage tab even if your grep comes back
clean).

### Step 6: Remove the flag checks from code

For each reference found in Step 5, replace the conditional with whichever
branch matches the flag's final state (the "on" branch if the flag was at
100%, the "off" branch if you're retiring a flag that ended up at 0%).
Delete the other branch entirely — don't leave it commented out or behind
a TODO; if it turns out to be needed again, that's what version control is
for.

```ts
// before
if (flagClient.isEnabled('new-billing-flow', { userId })) {
  return renderNewBillingFlow(user);
} else {
  return renderLegacyBillingFlow(user);
}

// after
return renderNewBillingFlow(user);
```

Open one PR per repo. Keep these PRs focused on just the flag removal —
resist the urge to also clean up adjacent code in the same diff, it makes
the change harder to review and harder to revert cleanly if something goes
wrong.

### Step 7: Review and merge

Get a review from someone who understands the feature the flag was gating,
not just someone rubber-stamping a mechanical diff. The reviewer's job is
specifically to check that the branch you kept is actually the correct
final behavior — this is where a mistake in Step 1's rollout-percentage
check would surface, so treat this review as a real checkpoint, not a
formality.

### Step 8: Deploy

Deploy through the normal pipeline for each affected service. No special
deploy process is needed for flag-removal PRs — they go through the same
staging → canary → full rollout process as any other change.

Watch the standard service dashboards (error rate, latency, relevant
business metrics for the feature) through canary and for at least one hour
post-full-rollout. Flag removal is usually low-risk, but "usually" is
doing some work in that sentence, and a quiet watch period costs you
almost nothing.

### Step 9: Delete the flag from Flagboard

Once all code references are removed and deployed to production across
every affected service, go back to Flagboard and change the flag's status
from Archived to Deleted. This is the point of no return — deletion
removes the flag key entirely, including its evaluation history. Only do
this after confirming (via the Usage tab) that the flag has received zero
evaluations for at least 48 hours, which confirms nothing is still calling
it.

### Step 10: Close the tracking ticket

Update the cleanup ticket (filed automatically from the monthly audit, or
create one if you're doing ad hoc cleanup) with a link to the merged PRs
and mark it done. This keeps the audit report accurate for next month.

## Rollback

If something breaks after Step 6 (code removal) but before Step 9
(deletion), revert the code-removal PR and redeploy — the flag is still
archived in Flagboard at this point but its evaluation endpoint is still
live, so reverting the code restores the previous conditional behavior
exactly.

If something breaks after Step 9 (deletion), there is no clean rollback —
the flag key and its history are gone. This is why Step 9 has an explicit
48-hour zero-evaluation confirmation gate before you're allowed to pull the
trigger. If you're ever unsure whether it's really safe, wait longer before
deleting; archived-but-not-deleted costs nothing to leave in that state for
an extra week.

## Common mistakes

- **Skipping the cross-repo search.** The flag you're cleaning up in one
  service's code might still be referenced by an internal admin tool or a
  data pipeline in another repo that doesn't show up if you only grep the
  service you're focused on.
- **Leaving dead branches commented out** instead of deleting them, which
  defeats the entire point of the cleanup.
- **Rushing the notice period** in Step 3 because the flag "obviously"
  isn't needed anymore. The 24-hour window exists precisely for the cases
  that aren't obvious to the person doing the cleanup.
- **Batching too many flags into one PR.** One flag per PR keeps the
  blast radius of any single mistake small and makes review meaningfully
  easier.

## Questions

Post in `#eng-releases` or ping the Platform Infrastructure on-call if
you're unsure whether a flag is safe to remove, or if Flagboard's Usage
tab is showing something that doesn't match what your code search found —
that mismatch is worth chasing down before you proceed, not after.
