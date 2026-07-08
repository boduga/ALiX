#!/usr/bin/env bash
set -euo pipefail

# ─── Release Gate — P4.3-Sf.7: pack-once, test-once, publish exact artifact ───
# Verifies tarball contents, checks SBOM, verifies checksum, installs tarball
# in a temp dir and runs smoke tests.
# Exits 0 on success, non-zero on any failure.
# Can be run locally or in CI.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
GATE_PASSED=true
TMP_DIR=""
TARBALL=""
CHECKSUM_FILE=""
SBOM_FILE=""
ARTIFACT_DIR=""

cleanup() {
  # Sf.7: Retain tarball, checksum, SBOM — do NOT delete them
  if [ -n "${TMP_DIR:-}" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
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
echo "  ALiX Release Gate — P4.3-Sf.7"
echo "  Pack-Once, Test-Once, Publish Exact Artifact"
echo "═══════════════════════════════════════════════════════"
echo ""

# ─── Phase 1: Build and test ────────────────────────────────────────────

run_step "Typecheck" pnpm typecheck
run_step "Build" pnpm build
run_step "Supply-chain check" bash "$SCRIPT_DIR/check-supply-chain.sh"
run_step "Node unit tests" pnpm test:unit:node
run_step "Vitest" pnpm test:vitest
run_step "Integration tests" pnpm test:integration
run_step "Soak Tier 1 (corruption + store load)" pnpm test:soak:quick
run_step "TUI smoke" pnpm test:manual:tui
run_step "Doctor" node dist/src/cli.js doctor

# Performance budget check
run_step "Benchmark (quick suite)" node dist/src/cli.js benchmark run --suite quick
run_step "Performance budgets" node dist/src/cli.js doctor --performance

# ─── Phase 2: Pack (Sf.7 step 3) ────────────────────────────────────────

echo "▸ pnpm pack --json..."
PACK_JSON="$(pnpm pack --json --pack-destination "$PROJECT_ROOT" 2>/dev/null)"
TARBALL="$(echo "$PACK_JSON" | node -p "const parsed = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); (Array.isArray(parsed) ? parsed[0] : parsed).filename" 2>/dev/null)"

if [ -z "$TARBALL" ] || [ ! -f "$PROJECT_ROOT/$TARBALL" ]; then
  echo "  ❌ pnpm pack failed — no tarball produced"
  GATE_PASSED=false
fi

if [ -n "$TARBALL" ] && [ -f "$PROJECT_ROOT/$TARBALL" ]; then
  echo "  ✅ Tarball: $TARBALL"
else
  echo "  ❌ pnpm pack produced no tarball — FAILED"
  GATE_PASSED=false
fi
echo ""

# ─── Phase 3: Verify package contents (Sf.7 step 4) ─────────────────────

if [ -n "$TARBALL" ] && [ -f "$PROJECT_ROOT/$TARBALL" ]; then
  echo "▸ Tarball content verification..."
  if node dist/src/cli.js security supply-chain verify-tarball "$PROJECT_ROOT/$TARBALL" > /dev/null 2>&1; then
    echo "  ✅ Tarball contents — verified"
  else
    echo "  ❌ Tarball contents — denied files found"
    node dist/src/cli.js security supply-chain verify-tarball "$PROJECT_ROOT/$TARBALL"
    GATE_PASSED=false
  fi
else
  echo "  ❌ Skipping tarball verification — no tarball"
fi
echo ""

# ─── Phase 4: Packaged-artifact smoke test (Sf.7 steps 5-6) ─────────────

if [ -n "$TARBALL" ] && [ -f "$PROJECT_ROOT/$TARBALL" ]; then
  echo "▸ Pack-once smoke test (install tarball in clean temp dir)..."
  TMP_DIR="$(mktemp -d)"

  if pnpm install --config.dangerously-allow-all-builds=true --prefix "$TMP_DIR" "$PROJECT_ROOT/$TARBALL" > /dev/null 2>&1; then
    if (cd "$TMP_DIR" && ./node_modules/.bin/alix init > /dev/null 2>&1 && \
        ./node_modules/.bin/alix doctor > /dev/null 2>&1 && \
        ./node_modules/.bin/alix models doctor --json > /dev/null 2>&1); then
      echo "  ✅ Pack-once smoke test — alix init, doctor, models doctor all pass"
    else
      echo "  ❌ Pack-once smoke test — alix commands failed"
      GATE_PASSED=false
    fi
  else
    echo "  ❌ Pack-once smoke test — tarball install failed"
    GATE_PASSED=false
  fi
else
  echo "  ❌ Skipping smoke test — no tarball"
fi
echo ""

# ─── Phase 5: Generate SBOM (Sf.7 step 7) ───────────────────────────────

if [ -n "$TARBALL" ] && [ -f "$PROJECT_ROOT/$TARBALL" ]; then
  echo "▸ SBOM generation..."
  SBOM_FILE="${TARBALL%.tgz}.sbom.json"
  # npm sbom is retained — pnpm has no equivalent SBOM command
  if npm sbom -- --json > "$PROJECT_ROOT/$SBOM_FILE" 2>/dev/null; then
    echo "  ✅ SBOM: $SBOM_FILE"
  else
    echo "  ⚠  SBOM generation failed — continuing (non-blocking)"
  fi
else
  echo "  ⚠  Skipping SBOM — no tarball"
fi
echo ""

# ─── Phase 6: Compute checksum (Sf.7 step 8) ────────────────────────────

if [ -n "$TARBALL" ] && [ -f "$PROJECT_ROOT/$TARBALL" ]; then
  echo "▸ Checksum computation..."
  CHECKSUM_FILE="${TARBALL%.tgz}.sha256"
  if command -v sha256sum &> /dev/null; then
    sha256sum "$PROJECT_ROOT/$TARBALL" | cut -d' ' -f1 > "$PROJECT_ROOT/$CHECKSUM_FILE"
    echo "  ✅ Checksum: $CHECKSUM_FILE"
    echo "    $(cat "$PROJECT_ROOT/$CHECKSUM_FILE")"
  elif command -v shasum &> /dev/null; then
    shasum -a 256 "$PROJECT_ROOT/$TARBALL" | cut -d' ' -f1 > "$PROJECT_ROOT/$CHECKSUM_FILE"
    echo "  ✅ Checksum: $CHECKSUM_FILE"
    echo "    $(cat "$PROJECT_ROOT/$CHECKSUM_FILE")"
  else
    echo "  ⚠  No sha256sum or shasum found — skipping checksum"
  fi
else
  echo "  ⚠  Skipping checksum — no tarball"
fi
echo ""

# ─── Phase 7: Store artifacts (Sf.7 step 9) ─────────────────────────────

if [ -n "$TARBALL" ] && [ -f "$PROJECT_ROOT/$TARBALL" ]; then
  ARTIFACT_DIR="$PROJECT_ROOT/.artifacts"
  mkdir -p "$ARTIFACT_DIR"

  cp "$PROJECT_ROOT/$TARBALL" "$ARTIFACT_DIR/"
  [ -f "$PROJECT_ROOT/$CHECKSUM_FILE" ] && cp "$PROJECT_ROOT/$CHECKSUM_FILE" "$ARTIFACT_DIR/"
  [ -f "$PROJECT_ROOT/$SBOM_FILE" ] && cp "$PROJECT_ROOT/$SBOM_FILE" "$ARTIFACT_DIR/"

  echo "▸ Artifact directory: $ARTIFACT_DIR"
  ls -la "$ARTIFACT_DIR/"
  echo "  ✅ Artifacts stored"
else
  echo "  ⚠  Skipping artifact storage — no tarball"
fi
echo ""

# ─── Phase 8: Output structured result ───────────────────────────────────
echo "═══════════════════════════════════════════════════════"
if [ "$GATE_PASSED" = true ]; then
  echo "  ✅ Release gate PASSED — ready to publish."

  # Output structured JSON for CI consumption
  echo ""
  echo "  Artifacts:"
  [ -n "$TARBALL" ] && echo "    tarball: $TARBALL"
  [ -n "$CHECKSUM_FILE" ] && [ -f "$PROJECT_ROOT/$CHECKSUM_FILE" ] && echo "    checksum: $CHECKSUM_FILE ($(cat "$PROJECT_ROOT/$CHECKSUM_FILE"))"
  [ -n "$SBOM_FILE" ] && [ -f "$PROJECT_ROOT/$SBOM_FILE" ] && echo "    sbom: $SBOM_FILE"
  echo ""

  # Print machine-readable JSON result
  cat <<EOF
{
  "gate": "passed",
  "tarball": "${TARBALL:-null}",
  "checksum": "$([ -f "$PROJECT_ROOT/${CHECKSUM_FILE:-}" ] && cat "$PROJECT_ROOT/$CHECKSUM_FILE" || echo "null")",
  "sbom": "${SBOM_FILE:-null}",
  "artifact_dir": "${ARTIFACT_DIR:-null}"
}
EOF
  exit 0
else
  echo "  ❌ Release gate FAILED — review issues above."
  cat <<EOF
{
  "gate": "failed"
}
EOF
  exit 1
fi
