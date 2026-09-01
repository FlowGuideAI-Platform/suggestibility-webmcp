/**
 * Run sample artifacts through the real Suggestibility.ai board and capture
 * the resulting packages into the static bundles.
 *
 * Copyright 2026 All Aligned Consulting LLC. Apache-2.0.
 *
 * Usage:
 *   SUGG_SESSION=<session token> node scripts/run-samples.mjs --panel 7
 *   SUGG_SESSION=<session token> node scripts/run-samples.mjs --panel 7 --dry
 *
 * THE CONSTRAINT THAT SHAPES THIS SCRIPT
 * --------------------------------------
 * Panel size is NOT a request parameter. The API resolves it from the plan
 * attached to the credit it spends, and it picks that credit with
 * `ORDER BY period_end DESC LIMIT 1` -- the account's longest-lived active
 * period wins. There is no way to ask for a 3-reviewer board while holding a
 * 7-reviewer entitlement.
 *
 * So this cannot capture all ten samples in one pass. It runs ONE panel size
 * per invocation, and the operator must hold the matching tier when they run
 * it (pro = 3, business = 5, enterprise = 7). --panel is therefore an
 * assertion, not a request: the script verifies the board it got back is the
 * board it expected, and refuses to save a mismatch. Silently writing a
 * 3-reviewer package into a sample the catalogue advertises as 7-reviewer
 * would make the README's central promise false.
 *
 * Runs are idempotent: a sample that already carries a review is skipped, so
 * re-running after a failure never re-spends model calls that already
 * succeeded.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const samplesDir = join(root, "public", "samples");
const API = process.env.SUGG_API ?? "https://api.suggestibility.ai";
const TOKEN = process.env.SUGG_SESSION;

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const panelArg = args[args.indexOf("--panel") + 1];
const PANEL = Number(panelArg);

if (![3, 5, 7].includes(PANEL)) {
  console.error("usage: node scripts/run-samples.mjs --panel <3|5|7> [--dry]");
  process.exit(1);
}
if (!TOKEN && !dry) {
  console.error(
    "SUGG_SESSION is required. Sign in at suggestibility.ai and copy the sug_session cookie value.",
  );
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `non-JSON response (HTTP ${res.status}): ${text.slice(0, 120)}`,
    );
  }
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const index = JSON.parse(readFileSync(join(samplesDir, "index.json"), "utf8"));
const targets = index.samples.filter((s) => s.panel_size === PANEL);

console.log(
  `${dry ? "[dry] " : ""}${targets.length} sample(s) at ${PANEL} reviewers.`,
);

let ran = 0;
let skipped = 0;
for (const entry of targets) {
  const path = join(samplesDir, `${entry.id}.json`);
  const bundle = JSON.parse(readFileSync(path, "utf8"));

  if (bundle.review) {
    console.log(`  skip  ${entry.id} — already has a review`);
    skipped++;
    continue;
  }
  if (dry) {
    console.log(
      `  would run  ${entry.id} (${bundle.char_count.toLocaleString()} chars)`,
    );
    continue;
  }

  process.stdout.write(`  run   ${entry.id} … `);
  const submitted = await api("/api/reviews", {
    method: "POST",
    body: JSON.stringify({
      title: bundle.title,
      content: bundle.artifact,
      type: bundle.domain,
    }),
  });

  // A 7-reviewer board is seven independent reviews plus a synthesis pass, so
  // the ceiling is generous. Polling stops on a terminal status either way.
  let pkg = null;
  let status = "queued";
  for (let i = 0; i < 90; i++) {
    await sleep(4000);
    const got = await api(`/api/reviews/${submitted.review_id}`);
    status = got.status;
    if (["complete", "degraded"].includes(status)) {
      pkg = got.package;
      break;
    }
    if (status === "failed") break;
  }

  if (!pkg) {
    console.log(`FAILED (status: ${status})`);
    continue;
  }

  // Assert, do not assume. See the header: a mismatch here means the operator
  // was holding the wrong tier, and saving it would publish a package that
  // contradicts the catalogue entry pointing at it.
  const seats = pkg.expertPanel?.experts?.length ?? 0;
  if (seats !== PANEL) {
    console.log(
      `MISMATCH — got ${seats} reviewers, expected ${PANEL}. Not saved. ` +
        `Check which tier this account currently holds.`,
    );
    continue;
  }

  bundle.review = pkg;
  bundle.review_id = submitted.review_id;
  writeFileSync(path, JSON.stringify(bundle, null, 2) + "\n");
  console.log(`ok (${seats} reviewers, ${status})`);
  ran++;
}

console.log(
  `\n${dry ? "[dry] " : ""}done — ${ran} captured, ${skipped} already had reviews.`,
);
if (!dry && ran > 0) {
  console.log("Run `npm run samples:build` to refresh index.json.");
}
