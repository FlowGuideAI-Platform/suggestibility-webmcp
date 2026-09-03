# Anchorline Enroll — WCAG 2.2 AA Conformance & Remediation Plan

**Status:** Draft — circulated for cross-functional sign-off
**Document owner:** Accessibility Program Lead (Contract), reporting to VP Product
**Contributors:** Director of Engineering (Web Platform) · Design Systems Lead · General Counsel · Director of Member Support · VP Product
**Audit reference:** External WCAG 2.2 AA conformance audit, Threshold Digital Access, completed 2026-08-14
**Related documents:** VPAT 2.5 (draft, blocked on this plan) · Master Services Agreement Schedule C (Accessibility) — Department of Administrative Services account · Risk Acceptance Register (Section 9)
**Last revised:** 2026-08-29
**Next review:** Weekly during Phase 1.5 (open enrollment window); monthly thereafter

---

## 1. Background and Purpose

Anchorline Enroll is our benefits administration and open-enrollment platform, used by employer HR teams and, downstream, by their employees to select and manage benefits. We have eighteen enterprise customers live on the platform, including two public-sector accounts. The larger of those, a state Department of Administrative Services (DAS), raised an accessibility conformance question during their contract renewal cycle this spring, citing Schedule C of their MSA, which requires a current VPAT and "good-faith conformance" with WCAG 2.2 AA. We had never commissioned a full third-party audit — our accessibility posture to date has been ad hoc, driven by individual engineers flagging issues in code review and by a handful of customer support tickets we resolved reactively. DAS's renewal forced the question, so Procurement engaged Threshold Digital Access to run a formal audit in July and August.

The audit failed. This document is the resulting remediation plan: what was found, how we're sequencing fixes against a hard external deadline (open enrollment opens November 1), what we are and are not fixing before that window, and how we intend to keep the platform conformant once we've closed the gap. It is written for four audiences who each read it differently — Engineering needs it as a work plan, Design needs it as a component inventory, Legal needs it as a risk record, and Product needs it as a sequencing decision they're accountable for. Where those readings pulled in different directions during drafting, I've tried to leave the disagreement visible rather than paper over it, because the version of this document that pretends everyone agreed would be less useful to whoever has to defend it later.

A structural fact shapes almost everything below: eighteen months ago we acquired Larkspur Benefits and absorbed its enrollment wizard rather than rebuild it, because the migration timeline didn't survive contact with the Larkspur integration deadline. That wizard — still iframed into Anchorline Enroll under the internal migration effort we call Project Estuary — runs its own CSS and component library, separate from ours. A large fraction of the findings below either live in that surface, or straddle both surfaces, and that has real consequences for effort estimates, discussed in Section 5.

## 2. Audit Summary and Methodology

Threshold audited a representative sample of flows using WCAG-EM: automated scanning (axe-core) across all sampled templates, manual keyboard-only and screen reader testing (NVDA/Firefox, JAWS/Chrome, VoiceOver/Safari) on the highest-traffic flows, and a color contrast pass across both the core Anchorline design system and the Larkspur wizard's legacy theme. Sampled flows: account setup, plan comparison, benefits election, dependent/beneficiary management, the election confirmation and attestation step, and the employer-side admin console (lower priority — see Section 4).

**Result: does not conform to WCAG 2.2 AA.** 34 distinct findings, 118 recorded instances across the sampled pages. Nine findings are rated Critical. Under the DAS contract, the VPAT cannot state "Supports" for any success criterion with an open Critical finding, and cannot claim overall AA conformance until Critical and Serious findings are resolved or formally risk-accepted with compensating controls — which is what Sections 8 and 9 of this plan attempt to do for the findings we cannot close before open enrollment.

## 3. Findings Summary

| ID | WCAG 2.2 SC | Severity | Description | Surface | Instances | User Impact |
|----|-------------|----------|--------------|---------|-----------|--------------|
| F-01 | 4.1.2 Name, Role, Value | Critical | Custom dropdown (plan selector, dependent picker) built on Larkspur's component library exposes no role, state, or accessible name to AT | Larkspur wizard | 6 | Screen reader users cannot determine what a control is or select an option; blocks plan selection entirely |
| F-02 | 2.1.1 / 2.1.2 Keyboard / No Keyboard Trap | Critical | Focus enters the election-confirmation attestation modal (third-party widget, vendor Attestly) and cannot be moved out via keyboard | Larkspur wizard | 1 (blocking) | Keyboard and screen reader users become trapped and cannot complete or abandon their election |
| F-03 | 3.3.1 Error Identification | Critical | Validation errors on the benefits election form are conveyed only by a red border; no text, icon, or programmatic association | Core app | 11 | Screen reader and low-vision users cannot tell which fields failed or why |
| F-04 | 1.3.1 Info and Relationships | Critical | Form fields in dependent management are visually adjacent to labels but not programmatically associated (`<label>`/`for` missing or mismatched) | Core app | 14 | AT users hear "edit text" with no indication of what's being edited |
| F-05 | 1.4.3 Contrast (Minimum) | Serious | Body text and secondary button labels fall below 4.5:1; disabled-state text falls below 3:1 against its own guidance threshold | Both surfaces | 27 | Low-vision users cannot read significant portions of the interface |
| F-06 | 2.4.7 Focus Visible | Serious | Focus outline suppressed by a global CSS reset carried over from Larkspur; no visible focus indicator anywhere in the wizard | Larkspur wizard | 1 (global) | Keyboard users cannot tell where focus is at any point in the flow |
| F-07 | 2.5.7 Dragging Movements | Serious | Reordering beneficiary allocation percentages is drag-only, no keyboard or button alternative | Core app | 1 | Motor-impaired and keyboard users cannot complete beneficiary allocation |
| F-08 | 3.3.2 Labels or Instructions | Serious | Several required fields (SSN last 4, coverage effective date) have placeholder text as the only label, which disappears on input | Core app | 8 | Users who lose the placeholder (low vision, cognitive load, AT) don't know what to enter |
| F-09 | 4.1.3 Status Messages | Moderate | Toast confirmations ("Election saved") are not announced to AT; sighted keyboard users get no non-visual confirmation either | Core app | 5 | Users may resubmit or believe an action failed |
| F-10 | 2.4.11 Focus Not Obscured (Minimum) | Moderate | Sticky page header covers the top ~40px of the viewport, obscuring the first focused field on several forms | Core app | 4 | Users can't see what they're editing when focus lands under the header |
| F-11 | 2.5.8 Target Size (Minimum) | Moderate | Icon-only action buttons (remove dependent, edit allocation) render at ~18×18px on responsive breakpoints | Both surfaces | 9 | Motor-impaired and low-dexterity users mis-tap or cannot activate controls |
| F-12 | 1.1.1 Non-text Content | Moderate | Icon-only buttons lack accessible names (aria-label absent) | Both surfaces | 12 | Screen reader users hear "button" with no indication of function |
| F-13 | 2.4.3 Focus Order | Moderate | Tab order in the plan comparison table jumps column-then-row instead of row-then-column, disorienting relative to visual layout | Core app | 1 | Screen reader users build an inaccurate mental model of the comparison |
| F-14 | 3.3.7 Redundant Entry | Minor | Dependent date of birth is re-entered manually in a later step despite being captured earlier in the flow | Core app | 1 | Extra burden, particularly for users relying on AT for data entry |
| F-15 | 3.2.6 Consistent Help | Minor | "Contact support" link appears in a different location/order across three flow steps | Both surfaces | 3 | Minor navigational inconsistency, disproportionately costly for cognitive-load and low-vision users |

**Severity definitions used in this audit and plan:** *Critical* — blocks task completion for users of assistive technology, no workaround within the product. *Serious* — significantly impairs task completion or requires an unreasonable workaround. *Moderate* — creates friction or requires effort beyond what an equivalent user without a disability would need, but the task remains completable. *Minor* — non-blocking, best-practice or consistency issue.

## 4. Prioritization Framework

We ranked findings on four axes rather than severity alone: (1) audit severity, (2) whether the affected flow sits on the critical path to a statutorily deadlined action — specifically, completing a benefits election before the enrollment window closes — (3) estimated remediation cost, and (4) contractual/legal exposure under the DAS Schedule C and our general Title III posture. The admin console was explicitly deprioritized this cycle: it's used by a small, known set of HR administrators, none of whom have identified as AT users in three years of support tickets, and its findings (not itemized above) are lower severity across the board. That's a judgment call, not a finding of no risk — Legal's position, noted for the record, is that "no employee has told us" is not the same as "no employee needs it," and we should not treat support-ticket silence as evidence of absence. We're accepting that gap for this cycle and will audit the admin console in Phase 3.

Weighting axis (2) above — critical-path proximity — is what pushed F-01 through F-04 to the top of Phase 1 ahead of some higher-instance-count findings like F-05 (contrast). It's also the axis that produced the disagreement in Section 6.

## 5. Phase 1 — Immediate Remediation (through 2026-10-25, pre-freeze)

| Findings | Fix | Owner | Estimated Effort | Target |
|----------|-----|-------|-------------------|--------|
| F-01, F-12 | Rebuild dropdown and icon-button components with proper ARIA roles/states/names | Web Platform (2 eng) | 3 weeks | 2026-10-04 |
| F-03, F-04, F-08 | Programmatic label association + inline error text/icon across election and dependent forms | Web Platform (2 eng) | 3 weeks | 2026-10-11 |
| F-06 | Restore visible focus indicator; remove global reset override | Web Platform (1 eng) | 2 days | 2026-09-12 |
| F-05 | Contrast remediation — design tokens + component sweep | Design Systems + Web Platform | **Disputed — see note below** | 2026-10-18 (Design estimate) |
| F-13 | Correct DOM order in comparison table | Web Platform (1 eng) | 1 week | 2026-09-26 |
| F-09, F-10 | `aria-live` region for toasts; header z-index/scroll-margin fix | Web Platform (1 eng) | 1 week | 2026-10-04 |

**Engineering dissent, recorded per Design Systems Lead's request for transparency:** The Phase 1 estimate for F-05 was set at "1 sprint, token-level change" on the assumption that contrast is a single design-token update. The Web Platform Director disputes this. Anchorline's core app and the Larkspur wizard run on two separate theming systems with no shared token layer — Larkspur's colors are hardcoded Sass variables scattered across ~40 component files, not tokens at all. A token-level fix addresses the core app only; the wizard requires a manual pass per component, plus visual regression testing on a codebase none of the current Web Platform team wrote. Engineering's estimate for full F-05 closure across both surfaces is 5–6 weeks, not one sprint. As of this draft, the two estimates have not been reconciled; the table above reflects Design's original estimate because it was already communicated to DAS, and Engineering's variance is tracked as a schedule risk in the program's weekly status, not yet reflected in the customer-facing date. This will slip, and everyone drafting this plan knows it — it's being carried forward unresolved because re-committing a date to DAS mid-cycle has its own cost, and Product wants one more sprint of data before doing that.

## 6. Phase 1.5 — Open Enrollment Compensating Controls (Interim Risk Acceptance)

F-02, the attestation-modal keyboard trap, is the finding this plan handled worst, and it's worth describing plainly rather than smoothing over.

The trap sits in the final step of benefits election — the Attestly-embedded modal where an employee legally attests to and signs their elections. It is a third-party widget; we do not own its code, and Attestly's last accessibility remediation commitment (per their support portal) is "targeted for their Q1 2027 release," which is outside our control and outside our timeline. A full in-house replacement of the attestation step is a Phase 2 item (Section 7) — reworking the widget integration touches election submission, our highest-stakes transactional flow, and Engineering was firm that shipping a rebuild of it in the four weeks before open enrollment risks a worse outcome than the current bug: a broken submission path during the highest-traffic week of the year.

Product's proposal, which I initially accepted into this plan, was a compensating control: document the trap in a known-issues note, and instruct Member Support to complete the election by phone for any employee who reports being stuck, ahead of their individual deadline. Member Support agreed to staff for it.
