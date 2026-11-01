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
  # alix may not be built; fall back to an independent audit. The fallback
  # cannot evaluate the exceptions file, so it must fail closed (#691) on
  # either a finding OR an unusable audit result.
  #
  # Previously this branch reported a pass whenever the parsed count was 0 —
  # including when `npm audit` itself errored. This is a pnpm repository with no
  # package-lock.json, so `npm audit` always fails and always produced
  # `{"error": ...}`, which parsed to 0 advisories. The result was an
  # unconditional "✅ No npm audit advisories" that also masked a failing
  # primary check: an expired-exception failure was swallowed here.
  echo "  ⚠  Primary exceptions check did not pass; running fail-closed fallback..."
  AUDIT_JSON="$(npm audit --json 2>/dev/null || true)"
  AUDIT_COUNT="$(
    printf '%s' "$AUDIT_JSON" |
      node -e "
        let d = '';
        process.stdin.on('data', (c) => (d += c)).on('end', () => {
          try {
            const a = JSON.parse(d);
            if (!a || typeof a !== 'object' || a.error) return console.log('ERR');
            console.log(String(Object.keys(a.vulnerabilities || {}).length));
          } catch {
            console.log('ERR');
          }
        });
      " 2>/dev/null || echo "ERR"
  )"
  # Never let stray output become an arithmetic comparison.
  case "$AUDIT_COUNT" in
    ''|*[!0-9]*) AUDIT_COUNT="ERR" ;;
  esac

  if [ "$AUDIT_COUNT" = "ERR" ]; then
    # An audit that could not run is not evidence of a clean graph.
    echo "  ❌ npm audit could not produce a usable report — failing closed (run 'alix security supply-chain exceptions check' for exception-aware analysis)"
    PASSED=false
  elif [ "$AUDIT_COUNT" -gt 0 ]; then
    echo "  ❌ $AUDIT_COUNT npm audit advisories found — failing closed (run 'alix security supply-chain exceptions check' for exception-aware analysis)"
    PASSED=false
  else
    echo "  ✅ No npm audit advisories (fallback evaluated a usable report)"
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
    # Fail closed (#691): a present-but-unverifiable tarball fails the gate.
    echo "  ❌ Tarball verification failed for $TARBALL"
    PASSED=false
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
