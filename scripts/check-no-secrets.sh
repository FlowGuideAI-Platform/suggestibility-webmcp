#!/usr/bin/env bash
# ============================================================================
# LEAK GUARD — run before every commit and every deploy from this repository.
#
# This repo is PUBLIC and is linked from a hackathon gallery with thousands of
# participants. A demo token committed here is not a disclosure risk, it is a
# billing one: every redemption spends real frontier-model calls.
#
# This check has already caught one real leak. The token input carried
# placeholder="SUGGJUDGE…", which published the naming scheme and made the
# live codes (SUGGJUDGE3/5/7) guessable on sight. It looked like UI copy.
# That is exactly why this runs mechanically rather than living in a reviewer's
# head: the dangerous version of this mistake never looks like a secret.
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
if grep -rInE "SUGG(JUDGE|DEMO|COMP)" \
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

echo "✅ leak-guard: no demo codes, credentials, or addresses found"
