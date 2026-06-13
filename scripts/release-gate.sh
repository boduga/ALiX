#!/usr/bin/env bash
set -euo pipefail

# ─── Release Gate — pre-release validation for ALiX ─────────────────────
# Exits 0 on success, non-zero on any failure.
# Can be run locally or in CI.

GATE_PASSED=true
TMP_DIR=""

cleanup() {
  [[ -n "${TMP_DIR:-}" ]] && rm -rf "$TMP_DIR"
}
trap cleanup EXIT

run_step() {
  local name="$1"
  shift
  local log
  log="$(mktemp)"

  echo "▸ $name..."
  if "$@" >"$log" 2>&1; then
    tail -3 "$log"
    echo "  ✅ $name"
  else
    cat "$log"
    echo "  ❌ $name — FAILED"
    GATE_PASSED=false
  fi

  rm -f "$log"
  echo
}

echo "═══════════════════════════════════════════════════════"
echo "  ALiX Release Gate"
echo "═══════════════════════════════════════════════════════"
echo ""

run_step "Typecheck" npm run typecheck
run_step "Build" npm run build
run_step "Node unit tests" npm run test:unit:node
run_step "Vitest" npm run test:vitest
run_step "Integration tests" npm run test:integration
run_step "Soak Tier 1 (corruption + store load)" npm run test:soak:quick
run_step "TUI smoke" npm run test:manual:tui
run_step "Doctor" node dist/src/cli.js doctor

# Performance budget check — run fresh quick benchmarks, then check budgets
run_step "Benchmark (quick suite)" node dist/src/cli.js benchmark run --suite quick
run_step "Performance budgets" node dist/src/cli.js doctor --performance

# Packaged-artifact smoke test
echo "▸ Packed-artifact smoke..."
TMP_DIR="$(mktemp -d)"

# Pack the current build
TARBALL="$(npm pack --json 2>/dev/null | node -p "require('/dev/stdin')[0].filename" 2>/dev/null || echo "")"
if [ -n "$TARBALL" ] && [ -f "$TARBALL" ]; then
  if npm install --prefix "$TMP_DIR" "$PWD/$TARBALL" > /dev/null 2>&1; then
    if "$TMP_DIR/node_modules/.bin/alix" init > /dev/null 2>&1 && \
       "$TMP_DIR/node_modules/.bin/alix" doctor > /dev/null 2>&1 && \
       "$TMP_DIR/node_modules/.bin/alix" models doctor --json > /dev/null 2>&1; then
      echo "  ✅ Packed-artifact smoke"
    else
      echo "  ❌ Packed-artifact smoke — FAILED"
      GATE_PASSED=false
    fi
  else
    echo "  ❌ Packed-artifact smoke (install failed) — FAILED"
    GATE_PASSED=false
  fi
  rm -f "$TARBALL"
else
  echo "  ⚠ npm pack produced no tarball — skipping artifact smoke"
fi
echo ""

# ─── Result ─────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════"
if [ "$GATE_PASSED" = true ]; then
  echo "  ✅ Release gate PASSED — ready to publish."
  exit 0
else
  echo "  ❌ Release gate FAILED — review issues above."
  exit 1
fi
