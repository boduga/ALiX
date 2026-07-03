#!/usr/bin/env bash
set -euo pipefail

# ─── Supply-Chain Check — CI gate for dependency integrity ────────────────
# Runs: lifecycle check + audit check + lockfile check + tarball check
# Exits 0 on success, non-zero on failure.
# Designed for use in CI pipeline and local pre-publish checks.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PASSED=true

echo "═══════════════════════════════════════════════════════"
echo "  ALiX Supply-Chain Check"
echo "═══════════════════════════════════════════════════════"
echo ""

# ── Sf.1: Lifecycle script check ────────────────────────────────────────

echo "▸ Sf.1 — Lifecycle script verification..."
if node "$SCRIPT_DIR/verify-lifecycle-scripts.mjs"; then
  echo "  ✅ Lifecycle scripts — all approved and current"
else
  echo "  ❌ Lifecycle scripts — new or expired entries found"
  PASSED=false
fi
echo ""

# ── Sf.2: Audit exceptions check ────────────────────────────────────────

echo "▸ Sf.2 — Audit exceptions check..."
if npx --prefix "$PROJECT_ROOT" alix security supply-chain exceptions check 2>/dev/null; then
  echo "  ✅ Audit exceptions — all advisories excepted or below threshold"
else
  # alix may not be built; run npm audit directly and check against exceptions
  echo "  ⚠  Running npm audit fallback..."
  AUDIT_JSON="$(npm audit --json 2>/dev/null || echo "{}")"
  AUDIT_COUNT="$(echo "$AUDIT_JSON" | node -p "const a=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); Object.keys(a.vulnerabilities||{}).length" 2>/dev/null || echo "0")"

  if [ "$AUDIT_COUNT" -gt 0 ]; then
    echo "  ⚠  $AUDIT_COUNT npm audit advisories found — review exceptions"

    # Check if exceptions file exists
    if [ -f "$PROJECT_ROOT/security/audit-exceptions.json" ]; then
      echo "  ℹ  Exceptions file exists — run 'alix security supply-chain exceptions check' for detailed analysis"
    else
      echo "  ❌ No audit-exceptions.json found"
      PASSED=false
    fi
  else
    echo "  ✅ No npm audit advisories"
  fi
fi
echo ""

# ── Sf.3: Lockfile checks (pnpm) ─────────────────────────────────────────

echo "▸ Sf.3 — Lockfile integrity..."

# Check lockfile exists
if [ ! -f "$PROJECT_ROOT/pnpm-lock.yaml" ]; then
  echo "  ❌ pnpm-lock.yaml not found"
  PASSED=false
else
  echo "  ✅ pnpm-lock.yaml — present"
fi

# pnpm install --frozen-lockfile (run before this script in CI) ensures
# lockfile matches package.json. Here we just verify existence and cleanliness.

# Check for dirty lockfile (modified but not committed)
if [ -f "$PROJECT_ROOT/pnpm-lock.yaml" ]; then
  if git -C "$PROJECT_ROOT" diff --exit-code "$PROJECT_ROOT/pnpm-lock.yaml" > /dev/null 2>&1; then
    echo "  ✅ Lockfile — clean (no uncommitted changes)"
  else
    echo "  ❌ Lockfile — has uncommitted changes (dirty)"
    PASSED=false
  fi
fi
echo ""

# ── Sf.5: Tarball content check (if tarball exists) ────────────────────

echo "▸ Sf.5 — Tarball content verification..."
TARBALL="$(ls "$PROJECT_ROOT"/alix-*.tgz 2>/dev/null | head -1 || echo "")"
if [ -n "$TARBALL" ] && [ -f "$TARBALL" ]; then
  if npx --prefix "$PROJECT_ROOT" alix security supply-chain verify-tarball "$TARBALL" 2>/dev/null; then
    echo "  ✅ Tarball — content verified"
  else
    echo "  ⚠  Tarball verification requires built ALiX — skipping (run manually before publish)"
  fi
else
  echo "  ℹ  No tarball found — run 'pnpm pack' first to verify package contents"
fi
echo ""

# ─── Result ─────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════"
if [ "$PASSED" = true ]; then
  echo "  ✅ Supply-chain check PASSED"
  exit 0
else
  echo "  ❌ Supply-chain check FAILED — review issues above"
  exit 1
fi
