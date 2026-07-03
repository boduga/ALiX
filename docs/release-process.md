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
# Do NOT use pnpm version — it creates a commit we want to review
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
pnpm view alix versions --json
gh release view v0.2.1
```
