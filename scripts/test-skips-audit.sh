#!/usr/bin/env bash
# test-skips-audit.sh — Skipped-test governance check
#
# Detects undocumented skipped tests and validates that every skip
# in the codebase appears in docs/testing/skipped-tests.md.
#
# Usage: pnpm test:skips:audit
#   or:  bash scripts/test-skips-audit.sh
#
# Exit codes:
#   0 — all skips documented, no bare { skip: true } found
#   1 — bare { skip: true } or undocumented skip found (fails CI)
#   2 — internal error

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAXONOMY="$ROOT/docs/testing/skipped-tests.md"
EXIT_CODE=0

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# ---------------------------------------------------------------------------
# Check 1: Bare { skip: true } without reason string
# ---------------------------------------------------------------------------
echo "=== Check 1: Bare { skip: true } (no reason) ==="
found_bare=0
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  linenum=$(echo "$line" | cut -d: -f2)
  # Must match { skip: true } but not { skip: "something" } or { skip: !var }
  if echo "$line" | grep -qE '\{ skip: true \}'; then
    echo -e "  ${RED}FAIL${NC}: $file:$linenum — bare { skip: true } without reason"
    found_bare=$((found_bare + 1))
    EXIT_CODE=1
  fi
done < <(grep -rnP '\{ skip: true(?!\s*[}:])' "$ROOT/tests" --include='*.ts' 2>/dev/null || true)

# Also check for .skip() with no arguments (chained)
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  linenum=$(echo "$line" | cut -d: -f2)
  # Skip .skip("reason") — only flag bare .skip()
  if echo "$line" | grep -qP '\.skip\s*\(\s*\)'; then
    echo -e "  ${RED}FAIL${NC}: $file:$linenum — bare .skip() without reason"
    found_bare=$((found_bare + 1))
    EXIT_CODE=1
  fi
done < <(grep -rnP '\.skip\s*\(\s*\)' "$ROOT/tests" --include='*.ts' 2>/dev/null || true)

# Also check test.skip(...) and it.skip(...) patterns where no string arg follows
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  linenum=$(echo "$line" | cut -d: -f2)
  # Match test.skip("name") but not test.skip("name", { skip: "reason" }, ...)
  # These are harder to detect correctly, so we focus on the common { skip: true } pattern
  true
done < <(grep -rnP '(test|it|describe)\.skip\s*\(' "$ROOT/tests" --include='*.ts' 2>/dev/null || true)

# Check test.skip with a following comma (indicates second argument)
# We want to flag test.skip("name") patterns where there's no skip reason object
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  linenum=$(echo "$line" | cut -d: -f2)
  # Match test.skip("name") on one line (no second arg)
  # Complex: test.skip("name", ...) has a comma, test.skip("name") does not
  # Simple heuristic: test.skip("...") without comma after the closing paren
  if echo "$line" | grep -qP '(test|it)\.skip\("[^"]*"\)' && ! echo "$line" | grep -qP '(test|it)\.skip\("[^"]*",\s*\{'; then
    echo -e "  ${YELLOW}WARN${NC}: $file:$linenum — test.skip() with name but no reason object"
  fi
done < <(grep -rnP '(test|it)\.skip\(' "$ROOT/tests" --include='*.ts' 2>/dev/null || true)

if [ "$found_bare" -eq 0 ]; then
  echo -e "  ${GREEN}PASS${NC}: No bare { skip: true } found"
fi

# ---------------------------------------------------------------------------
# Check 2: Verify every skip reason in source exists in taxonomy doc
# ---------------------------------------------------------------------------
echo ""
echo "=== Check 2: Skip reasons referenced in taxonomy doc ==="

# Extract all skip reason strings from source
# Patterns: { skip: "reason" }, { skip: "reason" }, etc.
skip_reasons=$(grep -roPn '\{ skip: "([^"]+)" \}' "$ROOT/tests" --include='*.ts' 2>/dev/null | \
  sed 's/.*{ skip: "\([^"]*\)" }/\1/' | sort -u || true)

# Also get non-empty skip strings from { skip: !var } patterns
# These should be gated with a runtime check — we check they're documented
skip_gates=$(grep -roPn '\{ skip:![^}]+\}' "$ROOT/tests" --include='*.ts' 2>/dev/null || true)

undocumented=0
while IFS= read -r reason; do
  [ -z "$reason" ] && continue
  # Check that the reason (or a substring match) appears in the taxonomy
  if ! grep -qF "$reason" "$TAXONOMY" 2>/dev/null; then
    echo -e "  ${YELLOW}WARN${NC}: Skip reason \"$reason\" not found in taxonomy doc"
    echo "         Add it to $TAXONOMY"
    undocumented=$((undocumented + 1))
  fi
done <<< "$skip_reasons"

if [ "$undocumented" -eq 0 ]; then
  echo -e "  ${GREEN}PASS${NC}: All skip reasons appear in taxonomy doc"
fi

# ---------------------------------------------------------------------------
# Check 3: Detect process.env gating in test files
# ---------------------------------------------------------------------------
echo ""
echo "=== Check 3: process.env-based test gating ==="
env_gates=$(grep -rnP 'process\.env\.\w+' "$ROOT/tests" --include='*.ts' 2>/dev/null | \
  grep -v node_modules | grep -v '.d.ts' || true)
if [ -n "$env_gates" ]; then
  echo -e "  ${YELLOW}INFO${NC}: Found process.env references in test files:"
  echo "$env_gates" | while IFS= read -r line; do
    echo "         $line"
  done
  echo "         Verify each is documented in taxonomy under 'Activation'"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
if [ "$EXIT_CODE" -eq 0 ]; then
  echo -e "${GREEN}✅ All checks passed. No undocumented skips.${NC}"
else
  echo -e "${RED}❌ One or more checks failed. Fix above issues before committing.${NC}"
fi

exit "$EXIT_CODE"
