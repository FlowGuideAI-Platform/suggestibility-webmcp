#!/usr/bin/env bash
# ============================================================================
# LEAK GUARD — run before every commit and every deploy from this repository.
#
# This repo is PUBLIC and is linked from a hackathon gallery with thousands of
# participants. A demo token committed here is not a disclosure risk, it is a
# billing one: every redemption spends real frontier-model calls.
#
# This check has already caught real leaks. The first: a token input whose
# placeholder spelled out the code prefix, publishing the naming scheme and
# making the live codes guessable on sight. It looked like UI copy.
#
# The second was in THIS FILE. It excludes itself from the scan below so it
# does not match its own pattern -- and that blind spot is where a comment
# naming the live codes verbatim sat undetected, in the one file whose job is
# preventing that. Do not write a real code here, not even as an example.
# Nothing enforces this line but this line.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() {
  echo "❌ leak-guard: $*" >&2
  echo "❌ DO NOT COMMIT OR DEPLOY" >&2
  exit 1
}

# Trial/demo code prefixes. Matched loosely on purpose: a partial code or a
# placeholder hinting at the scheme is as dangerous as the code itself.
if grep -rInE "SUGG(JUDGE|DEMO|COMP|CAP|OP)" \
  --exclude-dir=.git --exclude-dir=node_modules \
  --exclude="check-no-secrets.sh" . 2>/dev/null; then
  fail "a demo/trial code (or a hint at one) appears above"
fi

# Credential shapes. The API base is public and belongs here; keys never do.
if grep -rInE "(sk-[a-zA-Z0-9]{16,}|AKIA[0-9A-Z]{12,}|ghp_[a-zA-Z0-9]{20,}|cfat_[a-zA-Z0-9]{16,}|cfut_[a-zA-Z0-9]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY)" \
  --exclude-dir=.git --exclude-dir=node_modules \
  --exclude="check-no-secrets.sh" . 2>/dev/null; then
  fail "a credential-shaped string appears above"
fi

# Sample artifacts are fiction and must stay that way: they are submitted to a
# real pipeline and published here, so a stray real address is both a privacy
# problem and a fabricated-record problem.
if grep -rInE "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}" \
  public/samples 2>/dev/null; then
  fail "an email address appears in the sample artifacts above"
fi

# Attributed person names in sample metadata.
#
# The artifacts are fiction, but an invented name is not a safe one: "Priyank
# Bose" or "Dana Whitfield" is very likely a real person somewhere, and this
# repo is public while the documents themselves get submitted to a live review
# pipeline. Attaching a real-looking name to a fictional failed audit or a
# churn model with contestable features is a small harm with no upside --
# role titles carry the same realism at zero risk.
#
# Deliberately narrow: only metadata fields that ATTRIBUTE a document to
# someone, and only values shaped like "Firstname Lastname". Prose is not
# scanned, because the false-positive rate there would make the guard noise
# and a guard people learn to skip is worse than no guard.
#
# Implemented in node, not grep. The shell version of this check silently did
# nothing: its role-word exclusion matched anywhere on the line, so
# "| Author | Sana Okafor, Mobile Platform |" was suppressed by the "Mobile"
# further along. The test that caught that is `npm run guard:selftest` -- a
# guard nobody has watched fail is only a guess that it works.
if ! node scripts/check-names.mjs; then
  fail "a person name appears in sample metadata (see above) — use a role title"
fi

# Close the self-exclusion blind spot: scan THIS file's comments too, skipping
# only the lines that carry the detection patterns themselves. A guard that
# cannot see one file is a guard with a hiding place, and something was already
# hiding in it once.
if grep -nE "SUGG(JUDGE|DEMO|COMP|CAP|OP)[0-9]" "$0" | grep -v "grep -rInE" | grep -v "^\s*[0-9]*:#.*naming scheme"; then
  fail "the leak guard itself names a live code above"
fi

echo "✅ leak-guard: no demo codes, credentials, addresses, or person names found"
