# M0.78g.0 — Repository Hygiene and Baseline Gate

**Status:** Draft

**Scope:** Remove committed runtime artifacts, add `.gitignore` guards, verify test/CI/packaging integrity, and tag the M0.78g baseline.

**Non-goals:** No feature work, no refactoring, no config changes beyond `.gitignore`. The `dist/tests/tests/` mirror tree fix is already merged in M0.78g (commit ba5bfa13) — covered.

---

## 1. Remove Runtime Artifacts from Git

Delete these generated files from the repository (tracked file removal, not `.gitignore` yet):

| Path Pattern | Contents | Why Not Source-Controlled |
|---|---|---|
| `.alix/coordination/coord_*.json` | Demo coordination run records | Generated per-session runtime state |
| `.alix/coordination/results/*.json` | Worker result artifacts | Transient execution output |
| `.alix/graphs/graph_*.json` | Knowledge graph exports | Build artifact, different per environment |
| `.alix/ownership/ownership.json` | Ownership registry runtime state | Session-specific runtime data |
| `.serena/` | Project metadata for Serena MCP | External tool config, not part of source |

Approach:

```bash
git rm --cached .alix/coordination/coord_*.json
git rm --cached .alix/coordination/results/*.json
git rm --cached .alix/graphs/graph_*.json
git rm --cached .alix/ownership/ownership.json
git rm -r --cached .serena/
```

> **Note:** `.alix/sessions/` and `.alix/memory/` should be kept as `.gitignore` entries but ARE NOT tracked files — they're listed in `.gitignore` already per project convention. Verify.

---

## 2. Add `.gitignore` Guards

Update `.gitignore` to prevent re-committing these classes of files:

```
# Coordination runtime artifacts
.alix/coordination/coord_*.json
.alix/coordination/results/
.alix/graphs/graph_*.json
.alix/ownership/*.json

# External tool metadata
.serena/

# Build output (if not already present)
dist/tests/tests/
```

Check the existing `.gitignore` to avoid duplicates — merge rather than append.

---

## 3. Retain Sanitized Fixtures (If Needed)

Review the deleted artifacts for test value. If any contain meaningful coordination data models or conflict scenarios that don't exist in `tests/fixtures/`, move a sanitized copy. Likely outcome: none needed — the test suite already covers these with explicit fixtures in tests.

---

## 4. Verify Full Test Suite

Run and confirm green:

```bash
npm run build
npm run test:node:ci
npm run test:vitest
```

Expected: 2900+ tests, 0 failures.

---

## 5. Verify Package Contents

Use `npm pack --dry-run` to confirm no runtime artifacts leak into the published package. The output should show only `dist/`, `src/`, `tests/`, and standard package files (README, LICENSE, package.json, etc.).

---

## 6. Run `gitnexus detect_changes`

Verify the scope of this change is limited to `.gitignore` updates and removals — no source code impacted.

---

## 7. Verify CI

Check GitHub Actions via `gh run list --repo boduga/ALiX --branch main --limit 5` for a clean workflow run on the cleanup commit (status = "success"). If none appears (as with M0.78g), inspect the workflow trigger configuration and fix before tagging — silent CI means future PRs won't get automated checks.

Also verify `npm run test:ci` (`npm run test:node:ci && npm run test:vitest`) passes end-to-end, not just the node test runner alone.

---

## 8. Tag the Baseline

```bash
git tag -a m0.78g -m "M0.78g — Collaborative Planning and Replanning (baseline)"
git push origin m0.78g
```

This creates a named reference point so the next milestone can reference its predecessor.

---

## Files Modified

| File | Action |
|------|--------|
| `.gitignore` | MODIFY — add guard patterns |
| `.alix/coordination/coord_*.json` | DELETE from git (untrack) |
| `.alix/coordination/results/*.json` | DELETE from git (untrack) |
| `.alix/graphs/graph_*.json` | DELETE from git (untrack) |
| `.alix/ownership/ownership.json` | DELETE from git (untrack) |
| `.serena/` | DELETE from git (untrack) |
