/**
 * Fail if any sample is still advertised without a real review package.
 *
 * Copyright 2026 All Aligned Consulting LLC. Apache-2.0.
 *
 * The README tells judges every sample ships with "a completed review package
 * produced by the real platform. Nothing is staged, hand-written, or mocked."
 * That is a claim about honesty, and the only thing keeping it true is that
 * someone actually ran the boards. This check is what stops the claim rotting
 * into a lie between an edit and a deploy.
 *
 * It is intentionally NOT part of `npm run deploy`: shipping the page with
 * unrun samples is a legitimate intermediate state while boards are still
 * being captured. It is a release check, run deliberately before submission.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const samplesDir = join(root, "public", "samples");
const indexPath = join(samplesDir, "index.json");

if (!existsSync(indexPath)) {
  console.error(
    "check-samples: index.json missing — run `npm run samples:build`",
  );
  process.exit(1);
}

const { samples } = JSON.parse(readFileSync(indexPath, "utf8"));
const missing = [];
const mismatched = [];

for (const entry of samples) {
  const path = join(samplesDir, `${entry.id}.json`);
  if (!existsSync(path)) {
    missing.push(`${entry.id} (no bundle)`);
    continue;
  }
  const bundle = JSON.parse(readFileSync(path, "utf8"));
  if (!bundle.review) {
    missing.push(entry.id);
    continue;
  }
  // A package whose seat count contradicts the catalogue is worse than a
  // missing one: the page would confidently show a 3-reviewer board under a
  // heading promising 7. run-samples.mjs refuses to write these, so finding
  // one here means a bundle was edited by hand.
  const seats = bundle.review?.panel?.size ?? 0;
  if (seats !== entry.panel_size) {
    mismatched.push(
      `${entry.id}: catalogue says ${entry.panel_size}, package has ${seats}`,
    );
  }
}

if (missing.length === 0 && mismatched.length === 0) {
  console.log(
    `✅ check-samples: all ${samples.length} samples carry a real review package.`,
  );
  process.exit(0);
}

if (missing.length) {
  console.error(
    `❌ check-samples: ${missing.length} sample(s) have no review package:`,
  );
  for (const id of missing) console.error(`   - ${id}`);
  console.error("   Capture them with: npm run samples:run -- --panel <3|5|7>");
}
if (mismatched.length) {
  console.error(
    `❌ check-samples: ${mismatched.length} seat-count mismatch(es):`,
  );
  for (const m of mismatched) console.error(`   - ${m}`);
}
process.exit(1);
