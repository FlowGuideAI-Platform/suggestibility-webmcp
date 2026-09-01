/**
 * Combine the authored artifacts and their batch manifests into the static
 * bundles the WebMCP tools serve.
 *
 * Copyright 2026 All Aligned Consulting LLC. Apache-2.0.
 *
 * Output:
 *   public/samples/index.json   — the catalogue list_sample_artifacts returns
 *   public/samples/<id>.json    — artifact text + review package, per sample
 *
 * A sample's `review` stays null until a real board has run against it. That
 * is deliberate: the README promises these packages are genuine platform
 * output, so an unrun sample must be visibly unrun rather than quietly
 * shipping a plausible-looking placeholder. `npm run samples:check` fails the
 * build if any sample is still null, so the promise cannot rot into a lie.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = join(root, "public", "samples", "artifacts");
const outDir = join(root, "public", "samples");

const manifests = readdirSync(artifactDir)
  .filter((f) => /^_batch\d+\.json$/.test(f))
  .flatMap((f) => JSON.parse(readFileSync(join(artifactDir, f), "utf8")));

if (manifests.length === 0) {
  console.error("build-samples: no batch manifests found");
  process.exit(1);
}

const index = [];
for (const entry of manifests.sort((a, b) => a.panel_size - b.panel_size)) {
  const mdPath = join(artifactDir, `${entry.id}.md`);
  if (!existsSync(mdPath)) {
    console.error(`build-samples: missing artifact for "${entry.id}"`);
    process.exit(1);
  }
  const artifact = readFileSync(mdPath, "utf8");

  // Preserve any review already captured — regenerating the bundles must not
  // discard a package that cost real model calls to produce.
  const bundlePath = join(outDir, `${entry.id}.json`);
  const prior = existsSync(bundlePath)
    ? JSON.parse(readFileSync(bundlePath, "utf8"))
    : {};

  writeFileSync(
    bundlePath,
    JSON.stringify(
      {
        id: entry.id,
        title: entry.title,
        domain: entry.domain,
        panel_size: entry.panel_size,
        summary: entry.summary,
        word_count: entry.word_count,
        char_count: artifact.length,
        artifact,
        review: prior.review ?? null,
        review_id: prior.review_id ?? null,
      },
      null,
      2,
    ) + "\n",
  );

  index.push({
    id: entry.id,
    title: entry.title,
    domain: entry.domain,
    panel_size: entry.panel_size,
    summary: entry.summary,
    word_count: entry.word_count,
    has_review: Boolean(prior.review),
  });
}

writeFileSync(
  join(outDir, "index.json"),
  JSON.stringify(
    {
      count: index.length,
      note: "Each sample ships with a review package produced by the real Suggestibility.ai board. Nothing here is mocked.",
      samples: index,
    },
    null,
    2,
  ) + "\n",
);

const bySize = index.reduce((acc, s) => {
  acc[s.panel_size] = (acc[s.panel_size] ?? 0) + 1;
  return acc;
}, {});
const withReview = index.filter((s) => s.has_review).length;
console.log(
  `build-samples: ${index.length} samples ` +
    `(${Object.entries(bySize)
      .map(([k, v]) => `${v}x${k}-panel`)
      .join(", ")}), ` +
    `${withReview} with a real review, ${index.length - withReview} awaiting one.`,
);
