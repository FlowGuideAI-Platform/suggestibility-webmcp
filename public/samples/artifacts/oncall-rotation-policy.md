# Engineering On-Call Policy

**Owner:** VP Engineering / SRE Lead
**Applies to:** All Engineering, effective for rotations starting 2026-09-01
**Last revised:** 2026-08-14
**Supersedes:** On-Call Guidelines v3 (2024-11)

## 1. Purpose

Quillstack runs production infrastructure that our customers depend on
during their business hours across US and EU time zones, and increasingly
APAC as our Sydney office ramps up. This policy defines how on-call
rotations are staffed, how incidents escalate, and how engineers are
compensated for carrying a pager. The goal is a rotation that's sustainable
long-term, not one that burns out whoever happens to be on it during a bad
week.

This policy was rewritten this cycle after feedback from the engineering
survey (see Q2 eng-wide retro notes) that the old system was unclear about
escalation timing and didn't compensate secondary on-call at all. Both are
addressed below.

## 2. Rotation Structure

### 2.1 Teams in rotation

Every service-owning team maintains its own primary on-call rotation.
Platform Infrastructure, API Platform, and the Web Application team each
run independent weekly rotations. Smaller teams (Billing, Search) rotate
jointly with an adjacent team under a shared on-call agreement documented
in their team's on-call runbook.

### 2.2 Eligibility

Engineers join the on-call rotation after 90 days on the team and
completion of the on-call shadow program (two full shifts shadowing a
current rotation member, sign-off from the on-call lead). This is
unchanged from the prior policy and has worked well — it gives new hires
enough ramp time to actually be useful during an incident rather than
just being another confused person on the call.

### 2.3 Shift length and cadence

Primary on-call shifts run Monday 10:00 to the following Monday 10:00,
local team time zone. A full week was chosen over shorter shifts (the old
policy used 3-day rotations) because handoffs are themselves a source of
dropped context — a shorter cycle means more handoffs, and more handoffs
means more opportunities for an open incident or a known-flaky alert to
fall through the cracks between two people. Weekly also aligns rotation
boundaries with sprint boundaries, which teams found easier to plan around.

Each team maintains a **secondary on-call**, staffed on the same weekly
cadence, one rotation slot offset from primary. Secondary exists to answer
if primary doesn't acknowledge within the SLA window (see Section 3) and to
share the load on weeks with unusually high page volume.

### 2.4 Swaps

Engineers may swap shifts with another eligible rotation member. Swap
requests must be submitted via the on-call swap form at least 48 hours in
advance and require acknowledgment from both parties plus the on-call lead.
This advance-notice window exists to give the lead time to update the
paging schedule and confirm the swapped-in engineer is actually
available, not just nominally willing.

We recognize 48 hours doesn't cover every situation — a same-day family
emergency doesn't wait for a form. In that case, contact your on-call lead
or manager directly and they will arrange emergency coverage; the swap form
is for planned swaps, not the only path to getting help.

## 3. Escalation Tiers

| Tier | Trigger | Who's paged | Ack SLA | Resolve/Mitigate SLA |
|------|---------|-------------|---------|------------------------|
| Sev1 | Customer-facing outage, data loss risk, security incident | Primary on-call, then secondary, then Eng Director | 5 minutes | 30 minutes to mitigation |
| Sev2 | Degraded service, single-customer-impacting issue, elevated error rate | Primary on-call, then secondary | 15 minutes | 2 hours to mitigation |
| Sev3 | Non-urgent issue, no customer impact, needs attention before next business day | Primary on-call | Next business day | Team discretion |

If primary does not acknowledge within the Ack SLA, the page automatically
escalates to secondary. If secondary does not acknowledge within a further
5 minutes (Sev1) or 15 minutes (Sev2), the page escalates to the Eng
Director on-call, and for Sev1, to the VP Engineering.

**Missed acknowledgments.** Every missed page that escalates past primary
is logged automatically by the paging system and reviewed in the following
week's on-call retro. If an engineer misses two or more page
acknowledgments within their SLA window during a single on-call rotation,
regardless of cause, the on-call lead flags it to the engineer's manager as
a reliability concern to be addressed in their next 1:1. This exists because
a rotation only works if the org can trust that "on-call" means reachable,
and repeated misses put real load on secondary and on whoever gets
escalated to above them. Managers have discretion in how they handle
individual cases in that conversation.

### 3.1 Escalation contacts

Escalation contacts (Eng Director, VP Engineering rotation) are maintained
in the paging system and reviewed quarterly. Each team's specific
escalation chain is documented in that team's runbook.

## 4. Compensation

### 4.1 Stipend

Primary on-call: **$300/week** flat stipend, paid via the following pay
cycle, regardless of how many pages come in during the week.
Secondary on-call: **$150/week** flat stipend under the same terms. This is
new in this revision — secondary previously received no compensation,
which the Q2 survey flagged repeatedly as a gap given that secondary can
end up doing real incident work when primary is unreachable or when volume
is high.

A flat stipend was chosen over per-incident pay because per-incident
compensation creates a perverse incentive to under-report or resolve
things quietly rather than page in help, and it's simpler to administer
than tracking incident counts per person per week. The stipend is meant to
compensate for the burden of being reachable and interruptible for a full
week, not as payment per page.

### 4.2 Overtime for after-hours incident work

Time spent actively working an incident outside normal business hours
(defined as before 9:00 or after 18:00 local time, or any time on a
weekend) is compensated as overtime at 1.5x base hourly rate, in addition
to the weekly stipend, for non-exempt employees. Exempt employees accrue
equivalent comp time, to be used within the following 60 days. Log
after-hours incident time in the on-call tracking sheet within 48 hours of
the incident so it can be processed in the next pay cycle.

### 4.3 Holiday on-call

Rotations that fall across a company holiday (US or the relevant regional
holiday calendar) receive an additional **1.5x stipend multiplier** for
that week. Holiday weeks are flagged in advance in the rotation calendar so
engineers can plan around them.

## 5. Exemptions and Accommodations

- Engineers on parental leave, or in the 8 weeks following return from
  parental leave, are automatically excluded from the rotation. No action
  needed — this is handled by HR notifying the on-call lead.
- Engineers may request a standing exemption or modified rotation for
  documented medical or accessibility needs by contacting their manager
  and HR. These requests are handled confidentially and do not require
  disclosing the underlying medical reason to the on-call lead or team.
- New parents returning to the rotation may request a gradual ramp
  (secondary-only for the first two rotations back) — this is a standing
  option, not something that requires special approval.

## 6. Tooling and Escalation Path

- Paging: PagerDuty, integrated with the alerting rules in each service's
  monitoring config
- Primary channel during an active incident: `#incident-active` in Slack,
  bridged to a Zoom room auto-created by the PagerDuty integration
- Incident commander role rotates independently of on-call — see the
  Incident Response Runbook for how IC assignment works during a live Sev1

## 7. Rotation Health Review

The on-call lead for each team reviews rotation health monthly and reports
to Eng Leadership on: page volume per person, after-hours hours logged,
and any patterns suggesting a service needs reliability investment rather
than just more pages absorbed by the rotation. A team whose on-call volume
exceeds an average of 3 Sev1/Sev2 pages per week for two consecutive months
should treat that as a signal to prioritize reliability work in the next
planning cycle, not as a staffing problem to route around.

## 8. Feedback

This policy is reviewed twice a year, or sooner if the eng-wide survey or a
retro surfaces a specific problem with it. Send feedback to the SRE Lead or
raise it in the #oncall-policy Slack channel. The secondary-compensation
change in this revision came directly from that channel, and we'd rather
keep iterating this way than let it calcify for another two years before
the next full rewrite.
