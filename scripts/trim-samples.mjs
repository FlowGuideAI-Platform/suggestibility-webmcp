/**
 * Trim sample artifacts to the platform's accepted length.
 *
 * Copyright 2026 All Aligned Consulting LLC. Apache-2.0.
 *
 * The platform caps an artifact at MAX_ARTIFACT_CHARS (15,000). Eight of the
 * twelve samples were written past it, so they rendered fine and could never
 * actually be reviewed — the failure only appears at submit time, which is
 * exactly where a judge would have found it.
 *
 * Trimming at the last complete `##` section boundary keeps each document
 * coherent: it ends where a section ends rather than mid-sentence. The samples
 * stay substantial — a 14,000-character technical document is still far more
 * than a panel needs to disagree over.
 *
 * The alternative was raising the platform limit to fit the demo content.
 * That is backwards: the samples exist to show the product working, so they
 * belong inside its real constraints.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "samples",
  "artifacts",
);

const LIMIT = 15000;
const TARGET = 14300; // headroom, so nothing sits on the boundary

const manifests = readdirSync(dir).filter((f) => /^_batch\d+\.json$/.test(f));
let trimmed = 0;

for (const mf of manifests) {
  const entries = JSON.parse(readFileSync(join(dir, mf), "utf8"));
  let changed = false;

  for (const e of entries) {
    const path = join(dir, e.id + ".md");
    const body = readFileSync(path, "utf8");
    if (body.length <= LIMIT) continue;

    // Cut at the LATEST clean boundary under target, trying progressively
    // finer ones. A document whose only `##` heading sits early would
    // otherwise lose most of its body to a boundary that happened to be
    // convenient rather than close.
    const head = body.slice(0, TARGET);
    const cut = Math.max(
      head.lastIndexOf("\n## "),
      head.lastIndexOf("\n### "),
      head.lastIndexOf("\n\n| "), // end of a table block
      head.lastIndexOf("\n\n"),
    );
    if (cut < 1000) {
      console.error(`  ${e.id}: no boundary found — skipped`);
      continue;
    }
    const out = body.slice(0, cut).trimEnd() + "\n";
    writeFileSync(path, out);

    const words = out.split(/\s+/).filter(Boolean).length;
    console.log(
      `  ${e.id}: ${body.length} -> ${out.length} chars, ${e.word_count} -> ${words} words`,
    );
    e.word_count = words;
    changed = true;
    trimmed++;
  }
  if (changed)
    writeFileSync(join(dir, mf), JSON.stringify(entries, null, 2) + "\n");
}

console.log(`\ntrim-samples: ${trimmed} artifact(s) trimmed under ${LIMIT}.`);
