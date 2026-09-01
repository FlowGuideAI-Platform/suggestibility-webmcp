# Design Doc: Offline-First Sync for Fieldnote Mobile

| Field | Value |
|---|---|
| Status | Proposed — targeting implementation in Q4 |
| Author | Sana Okafor, Mobile Platform |
| Reviewers | Tom Reyes (Backend), Ilse Vance (QA/Compliance), Priyank Bose (Product) |
| Related systems | `fieldnote-mobile` (iOS/Android, React Native), `fieldnote-api` (sync backend) |
| Last updated | 2026-08-20 |

## 1. Background

Fieldnote is used by field technicians performing utility and telecom
infrastructure inspections — pole inspections, cabinet checks, right-of-way
clearance surveys. A large share of our inspection volume happens in rural
or industrial sites with no or intermittent cellular coverage: our own
telemetry from the last two quarters shows that 34% of inspection sessions
have at least one 15-minute stretch with zero connectivity, and roughly 6%
of sessions are conducted entirely offline, syncing only once the
technician returns to a vehicle or depot with signal.

The current app (v2.x) handles this by queuing writes locally and
replaying them to the server on reconnect, in submission order, with the
server accepting whichever write arrives last for a given record. This has
worked acceptably for single-author records, but it breaks down in a
specific and increasingly common scenario: a technician completes an
inspection offline, and *before their device reconnects*, a QA supervisor
reviewing a related, already-synced inspection in the web console makes a
correction to the same record (for example, re-classifying a defect
severity after a phone call with the technician). When the technician's
device finally reconnects, its queued write — built from a now-stale local
copy of the record — overwrites the supervisor's correction with no
warning to either party. We have three documented incidents in the last
two quarters where this caused a real inspection record to silently revert
to an incorrect state, one of which was only caught because a compliance
auditor cross-referenced a paper photo log against the app record and
noticed the mismatch.

This document proposes a conflict-aware sync design to replace the current
last-submission-wins behavior.

## 2. Problem Statement

We need a sync design that:

- Tolerates extended offline periods (multi-day, in some remote-crew
  cases) without data loss.
- Handles concurrent edits to the same record from more than one device
  or user without silently discarding either party's work.
- Does not introduce so much friction that field technicians — who are
  frequently working one-handed, in gloves, in poor lighting or bright
  sun — abandon the app or route around it.
- Gives compliance and QA confidence that safety-relevant fields
  (specifically: hazard classification and pass/fail disposition) cannot
  be silently overwritten without a record of the fact that a conflict
  occurred.

## 3. Goals and Non-Goals

**Goals**

- Field-level conflict detection with automatic resolution for the large
  majority of low-stakes fields (notes, photo attachments, timestamps of
  sub-steps).
- Explicit, never-silent handling for a small, named set of safety-critical
  fields.
- Correct behavior under clock skew: field devices routinely go days
  without a network time sync and device clocks in the field fleet have
  been observed drifting by as much as 40 minutes.
- A design implementable by a two-person mobile team plus one backend
  engineer within a quarter.

**Non-Goals**

- General-purpose real-time collaborative editing (Google-Docs-style
  concurrent cursors). Inspections are not edited concurrently character
  by character; conflicts arise from two separate offline-then-sync
  events, not live co-editing.
- Full CRDT-based document convergence for every field type. We considered
  this (Section 8) and are explicitly not building it for v1.
- Peer-to-peer (device-to-device) sync. All sync goes through the
  `fieldnote-api` server; devices never sync directly with each other.

## 4. Proposed Design, Overview

Each inspection record is represented locally as a set of fields, not a
single opaque blob. Writes are captured as an append-only local operation
log (an "outbox") rather than as in-place mutations to a local mirror of
server state. On reconnect, the client ships its outbox to the server,
which merges incoming operations against the current server state on a
**per-field** basis using a Hybrid Logical Clock (HLC) for ordering, not
raw device wall-clock time. Most fields resolve automatically
(last-write-wins by HLC order). A small set of fields designated
"critical" never auto-resolve on conflict — a true concurrent edit to one
of those fields produces a conflict record that blocks final submission
until a human — currently, always a QA reviewer, not the technician —
resolves it explicitly.

```
┌──────────────┐        outbox ops (HLC-stamped)        ┌──────────────┐
│  Mobile app  │ ───────────────────────────────────────▶│  Sync API    │
│ (SQLite +    │                                          │ (per-field   │
│  outbox log) │◀─────────────────────────────────────────│  merge)      │
└──────────────┘   accepted ops + any CONFLICT markers    └──────────────┘
```

## 5. Data Model

Local storage is SQLite. Each inspection record's mutable fields are
stored in an EAV-style (entity-attribute-value) table rather than fixed
columns, which is what makes per-field conflict detection and HLC
stamping tractable without a schema migration every time a new field type
is added.

```sql
-- local (SQLite) and server (Postgres) share this shape
CREATE TABLE inspection_field_values (
    record_id       TEXT NOT NULL,       -- inspection record UUID
    field_key       TEXT NOT NULL,       -- e.g. 'hazard_classification'
    value           TEXT NOT NULL,       -- JSON-encoded scalar, array, or object
    hlc_timestamp   TEXT NOT NULL,       -- hybrid logical clock, e.g. '2026-08-20T14:03:11.482Z-0007-devABC'
    author_id       TEXT NOT NULL,
    author_device   TEXT NOT NULL,
    is_critical     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (record_id, field_key)
);

CREATE TABLE outbox (
    op_id           TEXT PRIMARY KEY,
    record_id       TEXT NOT NULL,
    field_key       TEXT NOT NULL,
    value           TEXT NOT NULL,
    hlc_timestamp   TEXT NOT NULL,
    synced          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE conflicts (
    conflict_id     TEXT PRIMARY KEY,
    record_id       TEXT NOT NULL,
    field_key       TEXT NOT NULL,
    server_value    TEXT NOT NULL,
    incoming_value  TEXT NOT NULL,
    server_hlc      TEXT NOT NULL,
    incoming_hlc    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open'  -- open | resolved
);
```

A Hybrid Logical Clock combines a physical timestamp with a logical
counter and a device ID, so that ordering remains consistent even when two
devices' physical clocks disagree — the logical component only ever moves
forward, and the device ID breaks ties deterministically. This directly
addresses the clock-drift problem noted in Section 3: with raw wall-clock
LWW, a device with a fast clock can always "win" regardless of which edit
actually happened later in real terms, which is exactly the failure mode
implicated in at least one of the three incidents referenced above.

## 6. Sync Protocol

1. **Local write**: every field change is written to the local
   `inspection_field_values` mirror immediately (optimistic, for
   responsive UI) and appended to `outbox` with a freshly minted HLC
   timestamp.
2. **On reconnect**, the client requests the server's current HLC-stamped
   state for every record it has pending outbox entries for.
3. **Client-side pre-check**: for each field, if the server's HLC for that
   field is causally *before* the client's last known HLC for that field
   (i.e., the client had the latest version when it made its edit), no
   conflict exists — the client's write is simply newer and is queued for
   normal apply.
4. **True conflict**: if the server's HLC for a field is causally
   *concurrent with or after* the client's baseline for that field — i.e.,
   someone else wrote to that same field after the point the client's copy
   was last known-current — a conflict exists.
5. **Resolution branch**:
   - If `is_critical = 0`: resolve automatically, server value wins if its
     HLC is greater, else client value wins and is applied. No user is
     interrupted.
   - If `is_critical = 1`: no automatic resolution. A row is written to
     `conflicts` with `status = 'open'`, the client's write is held (not
     discarded — both versions are retained), and the record is flagged
     `needs_review` in the QA queue. The technician's app shows a
     non-blocking banner ("This inspection has a pending review — your
     entries are saved") rather than a resolution dialog; **resolution
     UI is only shown to the QA reviewer role**, not in the field.
6. **Array/set-valued fields** (e.g., `defects_found`, a list of
   independently-addable defect entries) are treated specially: rather
   than LWW on the whole list, each list item is its own addressable
   entity with its own HLC (effectively an OR-Set), so two people adding
   different defects concurrently both survive, and only an edit to the
   *same* defect entry triggers field-level conflict logic.

```
CRITICAL_FIELDS = {
  "hazard_classification",
  "pass_fail_disposition",
  "safety_hold_flag",
}
```

## 7. Conflict Resolution Strategy — the core design decision

This is the section most likely to be second-guessed, and it should be,
because it embeds a judgment call rather than a provably correct answer.

### 7.1 Why not full CRDTs everywhere

An earlier draft of this design proposed representing the entire
inspection record as a CRDT document (evaluated: Automerge). This would
give mathematically guaranteed convergence for every field type, including
nested structures, without hand-maintaining a critical-fields list. It was
set aside for this iteration for three reasons: the storage and CPU
overhead of CRDT metadata on our lowest-spec supported devices (a
meaningful fraction of the field fleet is 4-year-old Android hardware) was
measured at roughly 2.3x the local storage footprint per record in a
spike; the team's collective CRDT experience is limited, which is a real
implementation-risk cost, not just a preference; and — most importantly —
CRDT convergence guarantees *eventual consistency of the data structure*,
not correctness of the safety judgment it contains. A CRDT would happily
and correctly converge to a merged state for `hazard_classification`; it
would not tell anyone that two people disagreed about whether a hazard
exists, which is the actual thing QA needs to know about. We still need
explicit conflict surfacing for critical fields regardless of the merge
mechanism underneath, which reduces the marginal benefit of full CRDT
semantics for exactly the fields where correctness matters most.

### 7.2 The critical-fields carve-out is a judgment call, not a formula

**Backend/mobile engineering's position** (reflected in the current
design): a small, explicit, hand-maintained allowlist of critical fields
is the right mechanism. It's auditable — anyone can read the
`CRITICAL_FIELDS` set and know exactly what's protected — and it keeps
the common case (the other ~40 fields on an inspection record) fast and
frictionless. Expanding it is a one-line code change with review, which
is an acceptable cost for a decision that shouldn't change often.

**QA/Compliance's position**, raised in review and not fully resolved,
is that a hand-maintained allowlist will drift out of date as the
inspection form schema evolves — new field types get added by Product
roughly every other release, and nothing in the proposed design forces a
reviewer to consciously decide whether a new field belongs on the
critical list; the default, silently, is that it doesn't. Ilse's
specific counter-proposal was to invert the default: *all* fields
conflict-block unless explicitly marked safe-to-auto-resolve, on the
theory that a false positive (an unnecessary review prompt for a
low-stakes field) costs a QA reviewer a few seconds, while a false
negative (a safety field silently auto-resolved because someone forgot to
add it to the list) has already caused a real incident. This is a
legitimate position that the current draft does not adopt, primarily
because Product's concern (Section 7.3) is that a default-blocking
posture would make review-queue volume unpredictable and potentially large
as the form schema grows, and no one has data yet on what fraction of
fields would reasonably need to be non-critical. This is recorded as an
open disagreement, not a resolved one; see Section 11.

### 7.3 Silent auto-resolution vs. always-visible conflict trail

A second, related disagreement is about the non-critical path. The
current design auto-resolves and does not notify anyone that a conflict
occurred, even after the fact — the "losing" write is simply discarded
(though its HLC and value are retained in an audit log table, so it's
recoverable by an engineer, just not surfaced to any human in the normal
workflow).

**Product's position**: this is correct and is a hard requirement, not a
nice-to-have. Field technicians are the primary users, they are not going
to triage a conflict resolution inbox between site visits, and any
UI that asks them to adjudicate a merge is UI they will learn to dismiss
without reading, which is worse than not showing it at all. Silent
auto-resolution for non-critical fields (notes, sub-step timestamps, photo
captions) is the right trade because the stakes of a wrong auto-resolution
on those fields are genuinely low.

**A dissenting view raised by Tom (Backend)** during review, which the
design does not currently adopt but which is worth recording rather than
discarding: an alternative to "critical fields block, everything else is
silent" is "everything auto-resolves, but *every* auto-resolution — not
just critical-field conflicts — is written to a visible, append-only
conflict trail attached to the record, viewable on demand but never
interrupting anyone's workflow." This would give compliance a complete
picture without adding friction to the technician's flow at all, at the
cost of building a more general audit surface now rather than only for
the critical-field carve-out. The reason this wasn't adopted for v1 is
scope and time, not disagreement that it would be better — it's flagged
here because "we didn't build the more complete version because of
capacity, not because it was wrong" is a distinction worth preserving for
whoever revisits this doc.

### 7.4 Rejected alternative: "most severe value wins" for critical fields

One alternative considered for critical-field conflicts specifically was
automatic resolution toward the more conservative value — e.g., if either
party marked `pass_fail_disposition` as "fail," the merged result is
"fail," no human review required, on the theory that erring toward caution
is always safe. This was rejected for the current design, but the
rejection is itself contestable: the argument against it is that a
"most-severe-wins" rule can mask a genuine factual disagreement (technician
says pass, supervisor says fail because of new information) behind an
outcome that happens to be safe *this time*, without ever surfacing that
the two parties need to actually reconcile their understanding of the
site condition — which matters for the next inspection, not just this
one. The argument for it is that it guarantees a safe default without
requiring a review queue at all, and a reasonable QA lead could still
prefer it over the current blocking-review design on the grounds that
guaranteed-safe-and-automatic beats correct-but-sometimes-delayed. This
was not put to a final vote; it is recorded here as a live alternative
rather than a closed question.

## 8. Alternatives Considered

| Approach | Pros | Cons | Disposition |
|---|---|---|---|
| Last-write-wins, wall-clock (current v2.x behavior) | Simple, already built | Directly implicated in the incidents motivating this doc; vulnerable to clock skew | Rejected |
| Full CRDT document (Automerge) | Mathematically guaranteed convergence, no allowlist to maintain | Storage/CPU overhead on low-spec devices; team unfamiliar; doesn't solve the "surface the disagreement" problem on its own | Deferred, not rejected outright — revisit if critical-field list grows unwieldy |
| Field-level HLC + critical-field carve-out (proposed) | Balances friction and safety; implementable in a quarter | Allowlist can drift; silent path has no audit trail visible to non-engineers | **Proposed** |
| Server-authoritative, no offline writes to in-progress records | Eliminates conflicts by construction | Defeats the core offline-first requirement; unacceptable given connectivity data in Section 1 | Rejected |
| Operational Transform (OT) | Well-understood in text editors | Poor fit for structured field data; primarily solves concurrent character-level editing, which is a non-goal (Section 3) | Rejected |

## 9. Failure Modes and Edge Cases

- **Extended offline (multi-day) with multiple local edits to the same
  critical field**: the outbox correctly orders these by HLC before
  transmission, so only the final local state is compared against server
  state — intermediate local edits don't each generate separate conflicts.
- **Device clock reset mid-session** (e.g., battery pull, manual clock
  change): HLC's logical counter is monotonic independent of physical
  time, so ordering correctness is preserved, but the physical-time
  component of the HLC (used for human-readable audit display, not for
  ordering) can be misleading in this case. This is a known cosmetic gap,
  not a correctness gap.
- **Conflict on a record that gets deleted server-side before the client
  reconnects**: the client's outbox writes for that record are rejected
  with a `record_deleted` response; the client surfaces this to the user
  as a distinct state from a normal conflict, since there's nothing to
  merge into.
- **Two QA reviewers resolving the same conflict concurrently** (web
  console, both online): standard optimistic concurrency control
  (`If-Match` on the conflict record's version) prevents a double-resolve;
  the second reviewer gets a "already resolved" response.

## 10. Rollout Plan

- Phase 1 (internal dogfood, 2 weeks): deploy to the 12-person internal QA
  fleet, critical-field list limited to `pass_fail_disposition` only,
  synthetic conflict injection in staging.
- Phase 2 (single region, 4 weeks): one field region (roughly 40
  technicians), full critical-field list, conflict rate and review-queue
  volume monitored daily.
- Phase 3 (general availability): gated on Phase 2 showing review-queue
  volume under 15 conflicts/week per 40-technician region — the number
  Ilse's team believes is sustainable within existing QA staffing. If
  volume exceeds that, we revisit the critical-fields list or the
  always-visible-audit-trail alternative (Section 7.3) before wider
  rollout, rather than shipping and hoping.

## 11. Open Questions

- Should the critical-fields list default to closed (current design) or
  open (Ilse's counter-proposal, Section 7.2)? Unresolved.
- Should non-critical auto-resolutions get a visible (if non-blocking)
  audit trail in v1, or is that acceptable to defer (Tom's proposal,
  Section 7.3)? Currently deferred for scope; not re-litigated before
  Phase 3 exit unless queue volume data suggests otherwise.
- What is the actual sustainable review-queue volume for QA staffing
  beyond the Phase 3 gate number, which is an estimate, not a measured
  figure?
- Do we need a technician-facing (not just QA-facing) resolution path at
  all, for cases where the QA reviewer genuinely needs the technician's
  input to resolve a critical-field conflict rather than deciding
  unilaterally? Not addressed in this draft.
