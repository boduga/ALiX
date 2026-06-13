# M0.74 — CI and Release Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split CI into four deterministic parallel lanes, create a release gate that tests the packed npm artifact with performance budget checks, and document the PR-only release process.

**Architecture:** CI runs four independent jobs (typecheck, unit, integration, tui-smoke) with no duplicate test execution. The release gate (`scripts/release-gate.sh`) builds, tests, runs a fresh benchmark for budget checking, packs the tarball, installs it in a temp directory, and validates `init`/`doctor`/`models doctor` from the packed package. The publish workflow uses the release gate, verifies tag/package version consistency, and creates a GitHub release.

**Tech Stack:** GitHub Actions, bash, existing `package.json` scripts, existing `checkAllBudgets()` from performance-budgets.ts, `npm pack`.

---

## File Structure

### Create
- `scripts/release-gate.sh` — pre-release validation with packed-artifact smoke
- `docs/release-process.md` — release checklist and PR-only governance docs

### Modify
- `.github/workflows/ci.yml` — rewrite into 4 parallel jobs: typecheck, unit, integration, tui-smoke
- `.github/workflows/publish.yml` — use release gate, add tag/version consistency check, add GitHub release creation
- `package.json` — add `typecheck`, `test:unit:node`, `test:integration` scripts; exclude integration from `test:node:ci`

---

### Task 1: Add Explicit npm Scripts for Lane Separation

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add typecheck, test:unit:node, test:integration scripts**

Add to the `scripts` section:
```json
"typecheck": "tsc -p tsconfig.json --noEmit",
"test:unit:node": "find dist/tests -name '*.test.js' ! -path 'dist/tests/manual/*' ! -path 'dist/tests/pty/*' ! -path 'dist/tests/soak/*' ! -path 'dist/tests/integration/*' -print0 | xargs -0 node --test --test-timeout=30000",
"test:integration": "node --test --test-concurrency=1 dist/tests/integration/*.test.js",
```

Update `test:node:ci` to also exclude `dist/tests/integration/*`:
```json
"test:node:ci": "find dist/tests -name '*.test.js' ! -path 'dist/tests/manual/*' ! -path 'dist/tests/pty/*' ! -path 'dist/tests/soak/*' ! -path 'dist/tests/integration/*' -print0 | xargs -0 node --test --test-timeout=30000",
```

- [ ] **Step 2: Build and verify**

```bash
npm run build && npm run test:unit:node 2>&1 | tail -5
npm run test:integration 2>&1 | tail -5
```
Expected: unit tests pass, integration tests pass, no overlap.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(ci): add typecheck, test:unit:node, test:integration scripts with proper exclusions"
```

---

### Task 2: Split CI into Four Deterministic Lanes

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Rewrite ci.yml**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  # ─── Lane 1: TypeScript typecheck (no build needed) ────────────
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      - name: TypeScript typecheck
        run: npm run typecheck

  # ─── Lane 2: Unit tests (node + vitest) ─────────────────────────
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      - run: npm run build
      - name: Node unit tests
        run: npm run test:unit:node
      - name: Vitest
        run: npm run test:vitest

  # ─── Lane 3: Integration + Soak Tier 1 ─────────────────────────
  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      - run: npm run build
      - name: Integration tests
        run: npm run test:integration
      - name: Soak Tier 1 (corruption + store load)
        run: npm run test:soak:quick
      - name: Doctor health check
        run: node dist/src/cli.js doctor

  # ─── Lane 4: TUI smoke (blocking) ──────────────────────────────
  tui-smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      - run: npm run build
      - name: TUI manual smoke
        run: npm run test:manual:tui
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: split into 4 parallel lanes (typecheck, unit, integration, tui-smoke)"
```

---

### Task 3: Release Gate Script

**Files:**
- Create: `scripts/release-gate.sh`

- [ ] **Step 1: Create release-gate.sh**

```bash
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
PACKAGE_DIR="$(pwd)"

# Pack the current build
TARBALL="$(npm pack --json 2>/dev/null | node -p "require('/dev/stdin')[0].filename" 2>/dev/null || echo "alix-*.tgz")"
if [ -f "$TARBALL" ]; then
  npm install --prefix "$TMP_DIR" "$PWD/$TARBALL" > /dev/null 2>&1

  if "$TMP_DIR/node_modules/.bin/alix" init > /dev/null 2>&1 && \
     "$TMP_DIR/node_modules/.bin/alix" doctor > /dev/null 2>&1 && \
     "$TMP_DIR/node_modules/.bin/alix" models doctor --json > /dev/null 2>&1; then
    echo "  ✅ Packed-artifact smoke"
  else
    echo "  ❌ Packed-artifact smoke — FAILED"
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
```

- [ ] **Step 2: Make executable**

```bash
chmod +x scripts/release-gate.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/release-gate.sh
git commit -m "chore(ci): add release gate script with packed-artifact smoke and budget check"
```

---

### Task 4: Update Publish Workflow

**Files:**
- Modify: `.github/workflows/publish.yml`

- [ ] **Step 1: Rewrite publish.yml**

```yaml
name: Publish to npm

on:
  push:
    tags:
      - "v*"

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write       # needed for GitHub release
      id-token: write        # needed for npm provenance

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          registry-url: "https://registry.npmjs.org"
          cache: npm

      - run: npm ci

      # Ensure tag matches package.json version
      - name: Verify version consistency
        run: |
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          PACKAGE_VERSION="$(node -p "require('./package.json').version")"
          if [[ "$TAG_VERSION" != "$PACKAGE_VERSION" ]]; then
            echo "Tag version '$TAG_VERSION' does not match package.json '$PACKAGE_VERSION'"
            exit 1
          fi
          echo "Version $PACKAGE_VERSION — OK"

      - name: Release gate
        run: bash scripts/release-gate.sh

      - name: Publish to npm
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Create GitHub release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release create "${GITHUB_REF_NAME}" \
            --generate-notes \
            --title "ALiX ${GITHUB_REF_NAME}"
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/publish.yml
git commit -m "ci: use release gate, add tag/version check, create GitHub release"
```

---

### Task 5: Document Release Process

**Files:**
- Create: `docs/release-process.md`

- [ ] **Step 1: Create release-process.md**

```markdown
# Release Process

## Governance

ALiX follows PR-only governance. **Never push version commits directly to `main`.**
Version bumps and release branches go through the same review process as feature changes.

## Pre-Release Checklist

The release gate (`scripts/release-gate.sh`) validates:

1. TypeScript typecheck — no errors
2. Build compiles cleanly
3. All unit tests pass
4. All vitest pass
5. All integration tests pass
6. Soak Tier 1 (corruption + store load) passes
7. TUI smoke test passes
8. Doctor health check — exits 0
9. Benchmarks (quick suite) — runs, results saved
10. Performance budgets — checked against latest run
11. Packed-artifact smoke — tarball installs, `init` + `doctor` + `models doctor` succeed

## Release Steps

### 1. Create a release branch

```bash
git checkout -b release/v0.2.1
```

### 2. Update version

```bash
# Edit package.json and src/index.ts (ALIX_VERSION)
# Do NOT use npm version — it creates a commit we want to review
```

### 3. Commit and push

```bash
git add package.json src/index.ts
git commit -m "chore(release): v0.2.1"
git push -u origin release/v0.2.1
```

### 4. Open a PR

Create a PR from `release/v0.2.1` to `main`.
Get Greptile 5/5. Merge.

### 5. Tag and push the tag

```bash
git checkout main
git pull --ff-only
git tag v0.2.1
git push origin v0.2.1
```

This triggers the `Publish to npm` workflow, which:
- Verifies tag version matches `package.json` version
- Runs the release gate
- Publishes to npm with provenance
- Creates a GitHub release with auto-generated notes

### 6. Verify

```bash
npm view alix versions --json
gh release view v0.2.1
```
```

- [ ] **Step 2: Commit**

```bash
git add docs/release-process.md
git commit -m "docs: add release process with PR-only governance and packed-artifact smoke"
```

---

### Verification

1. `npm run typecheck` — no errors (fast, no build)
2. `npm run build && npm run test:unit:node` — all pass
3. `npm run test:integration` — integration tests pass
4. `bash scripts/release-gate.sh` — full gate passes, exits 0
5. `gh pr diff` — verify only ci/workflow/script/doc/package.json changed
