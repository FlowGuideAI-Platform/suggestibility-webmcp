/**
 * Reject person names in sample-artifact metadata.
 *
 * Copyright 2026 All Aligned Consulting LLC. Apache-2.0.
 *
 * The artifacts are fiction, but an invented name is not a safe one.
 * "Priyank Bose" or "Dana Whitfield" is very likely a real person somewhere,
 * this repository is public, and the documents themselves are submitted to a
 * live review pipeline. Attaching a real-looking name to a fictional failed
 * accessibility audit, or to a churn model with ethically contestable
 * features, is a small harm with no upside -- a role title carries the same
 * realism at zero risk.
 *
 * Scope is deliberately narrow: only fields that ATTRIBUTE a document to
 * someone, and only values shaped like "Firstname Lastname". Prose is not
 * scanned. A guard with a high false-positive rate is one people learn to
 * skip, which is worse than no guard at all.
 *
 * Run `--selftest` to prove the detector still works. The first version of
 * this check was written in shell and silently did nothing: its role-word
 * exclusion matched anywhere on the line, so
 * "| Author | Sana Okafor, Mobile Platform |" was suppressed by the "Mobile"
 * further along. It reported success. A guard nobody has watched fail is only
 * a guess that it works, so the fixtures below include exactly that line.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "samples",
  "artifacts",
);

// The leading `\**` matters: bold metadata ("**Document owner:** ...") is as
// common in these documents as table rows, and omitting it made the guard
// blind to half the real shapes. The selftest caught that.
const FIELD =
  /^\|?\s*\**\s*(Author|Reviewers?|Approvers?|Owners?|Primary contact|Prepared by|Document owner|Contact)\s*\**\s*[|:]\s*\**\s*(.+?)\s*\**\s*\|?\s*$/i;

/** Words that begin a ROLE rather than a given name. Only the FIRST token of
 *  the value is tested against this — that positional anchoring is the whole
 *  fix relative to the shell version. */
const ROLE_HEAD =
  /^(Staff|Senior|Sr|Junior|Jr|Lead|Principal|Head|Chief|Director|Deputy|Vice|Acting|Interim|Program|Platform|Product|Project|Engineering|Engineer|Security|Backend|Frontend|Mobile|Data|Payments|Accessibility|Retention|General|Legal|Site|Software|Solutions|Technical|Team|Group|Analytics|Operations|Quality|Compliance|Infrastructure|Support|Finance|Sales|Marketing|Customer|Design|Research|Counsel|Manager|Owner|Architect|Analyst|Scientist|Consultant|Contractor|The|A|An|None|TBD|Unassigned|CISO|CTO|CEO|VP|Developer|Partner|Web|Cloud|Core|Internal|External|Business|Enterprise|Trust|Privacy|Identity|Billing|Growth|Content|Community|Field|Release|Incident|Reliability|Network|Database|Systems|Service|Client|Server|Access|Risk|Audit|Vendor|Procurement|Human|People|Talent|Training|Documentation|Localization|Global|Regional)\b/i;

/** "Firstname Lastname" with no role word leading it. */
const NAME_SHAPE = /^[A-Z][a-z]{1,11}\s+[A-Z][a-z]{1,13}\b/;

/** Returns the offending value, or null. Exported shape kept trivial so the
 *  selftest exercises exactly what the file scan exercises. */
function offendingValue(line) {
  const m = line.match(FIELD);
  if (!m) return null;
  const value = m[2].trim();
  if (ROLE_HEAD.test(value)) return null;
  return NAME_SHAPE.test(value) ? { field: m[1], value } : null;
}

if (process.argv.includes("--selftest")) {
  const mustFlag = [
    "| Author | Sana Okafor, Mobile Platform |",
    "| Reviewers | Tom Reyes (Backend), Ilse Vance (QA/Compliance) |",
    "| Primary contact | Dana Whitfield, Sr. Data Scientist |",
    "**Document owner:** Marcus Feld",
    "Author: Priyank Bose",
  ];
  const mustPass = [
    "| Author | Staff Engineer, Mobile Platform |",
    "| Reviewers | Backend Lead, QA/Compliance Lead, Product Manager |",
    "| Primary contact | Sr. Data Scientist, Retention Analytics |",
    "**Document owner:** Accessibility Program Lead (Contract)",
    "| Approvers | General Counsel, CISO, VP Engineering, VP Product |",
    "| Owners | Retention Analytics (modeling), Data Platform |",
    "| Status | Draft — circulated for sign-off |",
    "Author: VP Engineering",
    // Team names read exactly like person names to a shape-matcher. This one
    // was a live false positive on api-pagination-spec.md, which is why the
    // role list has to cover team-name heads and not just job titles.
    "| Reviewers | Developer Experience, Partner Integrations |",
    "| Owners | Trust & Safety, Privacy Engineering |",
    "| Approvers | Release Management |",
  ];

  let failed = 0;
  for (const line of mustFlag) {
    if (!offendingValue(line)) {
      console.error(`SELFTEST FAIL — should have flagged: ${line}`);
      failed++;
    }
  }
  for (const line of mustPass) {
    const hit = offendingValue(line);
    if (hit) {
      console.error(
        `SELFTEST FAIL — false positive on: ${line} (matched "${hit.value}")`,
      );
      failed++;
    }
  }
  if (failed) {
    console.error(`\n❌ name-guard selftest: ${failed} case(s) wrong.`);
    process.exit(1);
  }
  console.log(
    `✅ name-guard selftest: ${mustFlag.length} caught, ${mustPass.length} correctly allowed.`,
  );
  process.exit(0);
}

const hits = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
  readFileSync(join(dir, file), "utf8")
    .split("\n")
    .forEach((line, i) => {
      const hit = offendingValue(line);
      if (hit)
        hits.push(
          `${file}:${i + 1}: ${hit.field} = "${hit.value.slice(0, 60)}"`,
        );
    });
}

if (hits.length) {
  console.error("person names found in sample metadata:");
  for (const h of hits) console.error(`   - ${h}`);
  process.exit(1);
}
process.exit(0);
