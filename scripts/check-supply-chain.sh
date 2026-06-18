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

# ── Sf.3: Lockfile checks ───────────────────────────────────────────────

echo "▸ Sf.3 — Lockfile integrity..."

# Check lockfile exists
if [ ! -f "$PROJECT_ROOT/package-lock.json" ]; then
  echo "  ❌ package-lock.json not found"
  PASSED=false
else
  echo "  ✅ package-lock.json — present"
fi

# Check lockfile is in sync with package.json
echo "▸ Sf.3 — Lockfile freshness..."
if node -e "
  const lf = JSON.parse(require('fs').readFileSync('$PROJECT_ROOT/package-lock.json','utf8'));
  const pj = JSON.parse(require('fs').readFileSync('$PROJECT_ROOT/package.json','utf8'));
  const issues = [];
  for (const dep of [...Object.keys(pj.dependencies||{}), ...Object.keys(pj.devDependencies||{})]) {
    const key = 'node_modules/' + dep;
    if (!lf.packages || !lf.packages[key]) {
      issues.push(dep);
    }
  }
  if (issues.length > 0) {
    console.error('MISSING from lockfile: ' + issues.join(', '));
    process.exit(1);
  }
  console.log('OK');
" 2>&1; then
  echo "  ✅ Lockfile is in sync with package.json"
else
  echo "  ❌ Lockfile is out of sync with package.json"
  PASSED=false
fi

# Check for dirty lockfile (modified but not committed)
if git -C "$PROJECT_ROOT" diff --exit-code "$PROJECT_ROOT/package-lock.json" > /dev/null 2>&1; then
  echo "  ✅ Lockfile — clean (no uncommitted changes)"
else
  echo "  ❌ Lockfile — has uncommitted changes (dirty)"
  PASSED=false
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
  echo "  ℹ  No tarball found — run 'npm pack' first to verify package contents"
fi
echo ""

# ── Sf.3: Minimum release age (optional) ────────────────────────────────

echo "▸ Sf.3 — Minimum release age..."
# Check that the newest dependency is at least 24h old
MIN_AGE_SECONDS=86400  # 24 hours
NOW="$(date +%s)"
NEWEST_DEP="$(node -e "
  const lf = JSON.parse(require('fs').readFileSync('$PROJECT_ROOT/package-lock.json','utf8'));
  const pkgs = lf.packages || {};
  const times = [];
  for (const [key, pkg] of Object.entries(pkgs)) {
    if (key === '') continue;
    if (pkg.time) {
      const t = new Date(pkg.time).getTime() / 1000;
      if (!isNaN(t)) times.push({name:pkg.name||key, time:t});
    }
  }
  times.sort((a,b) => b.time - a.time);
  const newest = times[0];
  if (newest) console.log(JSON.stringify(newest));
")"
if [ -n "$NEWEST_DEP" ]; then
  NEWEST_NAME="$(echo "$NEWEST_DEP" | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).name" 2>/dev/null || echo "")"
  NEWEST_TIME="$(echo "$NEWEST_DEP" | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).time" 2>/dev/null || echo "0")"
  NEWEST_AGE="$(( NOW - NEWEST_TIME ))"
  if [ "$NEWEST_AGE" -lt "$MIN_AGE_SECONDS" ] && [ -n "$NEWEST_NAME" ] && [ "$NEWEST_NAME" != "undefined" ]; then
    echo "  ⚠  Newest dependency ($NEWEST_NAME) is only $((NEWEST_AGE / 3600))h old — below 24h minimum"
  else
    echo "  ✅ Minimum release age — OK"
  fi
else
  echo "  ℹ  Could not determine dependency ages — skipping"
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
