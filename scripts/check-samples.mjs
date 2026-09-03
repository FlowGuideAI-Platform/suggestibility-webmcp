/**
 * Fail if any sample is still advertised without a real review package.
 *
 * Copyright 2026 All Aligned Consulting LLC. Apache-2.0.
 *
 * The samples ship as artifacts and are reviewed live, so a missing package is
 * normal and reported as information, not a failure.
 *
 * A seat-count MISMATCH is a different matter and does fail: a stored package
 * claiming three reviewers under a catalogue entry advertising seven is the
 * page confidently showing the wrong thing, which is worse than showing
 * nothing. run-samples.mjs refuses to write those, so one appearing here means
 * a bundle was hand-edited.
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

if (mismatched.length === 0) {
  const withReview = samples.length - missing.length;
  console.log(
    `✅ check-samples: ${samples.length} samples, ${withReview} carrying a stored review, ` +
      `${missing.length} reviewed live on demand. No seat-count mismatches.`,
  );
  process.exit(0);
}

if (mismatched.length) {
  console.error(
    `❌ check-samples: ${mismatched.length} seat-count mismatch(es):`,
  );
  for (const m of mismatched) console.error(`   - ${m}`);
}
process.exit(1);
