# M0.78g.0 — Repository Hygiene and Baseline Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove committed runtime artifacts, add `.gitignore` guards, verify test/CI/packaging integrity, and tag the M0.78g baseline.

**Architecture:** This is a one-branch cleanup pass — no new features, no refactoring, no config changes beyond `.gitignore`. The work splits into three tasks: (1) untrack artifacts and guard against re-committing, (2) run the full verification suite, (3) verify CI and tag.

**Tech Stack:** git, npm, GitHub Actions

## Global Constraints

- No source code modifications (`.ts`, `.js`, `.json` under `src/` or `tests/`)
- Only files that change: `.gitignore` (the single source file modified)
- Every deletion uses `git rm --cached` (keep local copies intact)
- Tag must be annotated (`-a`), not lightweight
- Full suite must pass before tagging

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `.gitignore` | MODIFY | Add guard patterns for runtime artifacts |
| `.alix/coordination/coord_*.json` | `git rm --cached` | 9 demo coordination run records |
| `.alix/coordination/results/*.json` | `git rm --cached` | 8 worker result and run artifacts |
| `.alix/graphs/graph_*.json` | `git rm --cached` | 5 knowledge graph exports |
| `.alix/ownership/ownership.json` | `git rm --cached` | 1 ownership registry snapshot |
| `.serena/` | `git rm --cached -r` | 2 files of external tool metadata |

Total: ~25 tracked files removed from git history view (all runtime data, zero source).

---

### Task 1: Untrack runtime artifacts and add .gitignore guards

**Files:**
- Modify: `.gitignore`
- Files to untrack (via `git rm --cached`):
  - `.alix/coordination/coord_*.json` (9 files)
  - `.alix/coordination/results/*.json` (8 files)
  - `.alix/graphs/graph_*.json` (5 files)
  - `.alix/ownership/ownership.json` (1 file)
  - `.serena/` (2 files)

**Interfaces:**
- Consumes: none
- Produces: clean git status, updated `.gitignore`

- [ ] **Step 1: Verify tracked artifact inventory**

```bash
echo "=== coordination ==="
git ls-files .alix/coordination/ | wc -l
echo "=== graphs ==="
git ls-files .alix/graphs/ | wc -l
echo "=== ownership ==="
git ls-files .alix/ownership/ | wc -l
echo "=== serena ==="
git ls-files .serena/ | wc -l
```

Expected: counts match above (9, 5, 1, 2). If the working tree has dirty files in these paths, commit or stash first so `git rm --cached` has a clean baseline.

- [ ] **Step 2: Add .gitignore guards** — append under the existing "ALiX runtime state" section:

```gitignore
# Coordination runtime state
.alix/coordination/
.alix/graphs/
.alix/ownership/

# External tool metadata
.serena/
```

These are directory-level patterns, so they block future runtime data regardless of UUID-based filenames.

- [ ] **Step 3: Untrack runtime artifacts**

```bash
git rm --cached .alix/coordination/coord_*.json
git rm --cached .alix/coordination/results/*.json
git rm --cached .alix/graphs/graph_*.json
git rm --cached .alix/ownership/ownership.json
git rm -r --cached .serena/
```

Each line is independent — run one at a time. Any errors indicate a file not tracked (possible if a previous attempt cleaned partial state).

- [ ] **Step 4: Check for other tracked runtime data**

```bash
git ls-files .alix/ | grep -v ".gitignore"
```

Expected: empty (no other tracked files under `.alix/` besides `.gitkeep` or similar).

- [ ] **Step 5: Verify the working set is clean**

```bash
git status
```

Expected output shows only `.gitignore` as modified and the runtime artifacts as deleted. No untracked files leaked.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(hygiene): untrack runtime artifacts and add .gitignore guards

Removes 25 tracked runtime artifact files and adds directory-level
.gitignore patterns to prevent re-committing:

- .alix/coordination/coord_*.json — demo coordination run records
- .alix/coordination/results/*.json — worker result artifacts
- .alix/graphs/graph_*.json — knowledge graph exports
- .alix/ownership/ownership.json — ownership registry snapshot
- .serena/ — external tool metadata

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Full verification suite

**Files:** None. All verification is commands only.

- [ ] **Step 1: Rebuild**

```bash
npm run build
```

Expected: exits 0, no errors.

- [ ] **Step 2: Run node unit tests**

```bash
npm run test:unit:node
```

Expected: all tests pass (0 failures). Last known baseline: 2902 tests, 0 failures.

- [ ] **Step 3: Run vitest**

```bash
npm run test:vitest
```

Expected: both vitest test files pass (scope tracker, user preference store).

- [ ] **Step 4: Run complete CI-equivalent suite**

```bash
npm run test:ci
```

Expected: both node:ci and vitest pass.

- [ ] **Step 5: Verify npm package contents**

```bash
npm pack --dry-run 2>&1 | grep -i "coord\|\.alix\|serena"
```

Expected: grep returns nothing — no runtime artifacts leak into the published package.

- [ ] **Step 6: Run `npx gitnexus detect_changes`**

```bash
npx gitnexus detect_changes
```

Expected: output confirms only `.gitignore` and deleted artifact files changed. No source code symbols affected.

---

### Task 3: CI verification and baseline tag

- [ ] **Step 1: Push the cleanup commit**

```bash
git push
```

- [ ] **Step 2: Check CI workflow run**

```bash
gh run list --repo boduga/ALiX --branch main --limit 5 --json conclusion,workflowName,headBranch,headSha
```

Wait for the CI run to complete (takes ~2-3 minutes). Expected: all workflow lanes (typecheck, unit, integration, tui-smoke) show `"success"` conclusion.

**If CI fails:** Fix the failure before proceeding. Do not tag a broken baseline.

**If CI never runs:** Check workflow trigger config in `.github/workflows/ci.yml` — the `push: branches: [main]` trigger should fire on every push to main.

- [ ] **Step 3: Tag the baseline**

```bash
git tag -a m0.78g -m "M0.78g — Collaborative Planning and Replanning (baseline)"
git push origin m0.78g
```

- [ ] **Step 4: Verify tag**

```bash
git tag -l "m0.78g"
git show m0.78g --stat
```

Expected: annotated tag points at the cleanup commit, which is a direct descendant of the M0.78g merge commit (2dc1a1fe). No previous commit was missed.

---

## Verification

1. **`npm run build`** — clean build
2. **`npm run test:ci`** — all tests pass (2902+ node tests + vitest)
3. **`npm pack --dry-run`** — no `.alix/` or `.serena/` artifacts in tarball
4. **`git status`** — clean working tree
5. **GitHub CI** — all workflow lanes green
6. **`git tag -l m0.78g`** — annotated tag exists and points at cleanup commit
