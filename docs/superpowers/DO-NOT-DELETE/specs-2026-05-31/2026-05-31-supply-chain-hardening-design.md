# Sub-Project #4: Supply-Chain Hardening

**Date:** 2026-05-31
**Status:** Completed (2026-05-31)
**Parent Project:** What ALiX Can Learn From Pi Agent
**Source:** [earendil-works/pi](https://github.com/earendil-works/pi) supply-chain hardening patterns

## Motivation

Pi Agent treats npm dependency changes as reviewed code changes. Their hardening includes:
- Direct external dependencies pinned to exact versions
- `.npmrc` with `save-exact=true` and `min-release-age=2`
- Lockfile (`package-lock.json`) as ground truth, with pre-commit check
- `npm run check` verifies pinned direct deps
- Published CLI package includes `npm-shrinkwrap.json`
- Release smoke tests with isolated installs
- `npm ci --ignore-scripts` in CI
- Scheduled `npm audit` workflow

ALiX currently has none of these:
- Dependencies use `^` (caret) ranges — accepts minor/patch updates automatically
- No `.npmrc` with `save-exact` or `min-release-age`
- No shrinkwrap for published CLI
- No supply-chain verification in `npm run check`

## Goals

1. **Pin direct dependencies to exact versions** (remove `^` and `~`)
2. **Create `.npmrc`** with `save-exact=true` and `min-release-age=2`
3. **Add a `verify:deps` script** to check that all direct deps are pinned
4. **Document the supply-chain policy** in a `SUPPLY-CHAIN.md` or in README
5. **No behavior change** — all tests must continue to pass

## Non-Goals

- Switching to a different package manager (pnpm, yarn)
- Adding `npm audit` to CI (Pi has this; we can defer if no CI exists)
- Generating `npm-shrinkwrap.json` (would require npm publish workflow)
- Changing dev vs prod dependency classification

## Architecture

### Changes

**1. Update `package.json` — pin direct dependencies**

Change all dependencies and devDependencies to use exact versions (no `^` or `~`):

```diff
- "@xenova/transformers": "^2.17.2",
+ "@xenova/transformers": "2.17.2",
- "better-sqlite3": "^12.10.0",
+ "better-sqlite3": "12.10.0",
... etc
```

**2. Create `.npmrc`**

```ini
# Save exact versions (no ^ or ~)
save-exact=true

# Require dependencies to be at least 2 days old
# (protects against typosquatting / supply-chain attacks on day-zero releases)
min-release-age=2

# Use lockfile as source of truth
package-lock=true
```

**3. Add `verify:deps` script to `package.json`**

```json
"verify:deps": "node scripts/verify-deps.mjs"
```

**4. Create `scripts/verify-deps.mjs`**

A small script that reads `package.json`, checks every `dependencies` and `devDependencies` entry, and fails if any version range uses `^`, `~`, `>`, `<`, or `*` (anything but exact pins).

**5. Add to `npm run check`**

```json
"check": "npm run build && npm run test:node && npm run verify:deps"
```

**6. Document in README**

Add a "Supply-Chain Policy" section explaining the choices.

## Files Affected

| Action | File | Reason |
|--------|------|--------|
| ✏️ Modify | `package.json` | Pin all direct deps to exact versions |
| ➕ New | `.npmrc` | npm config (save-exact, min-release-age) |
| ➕ New | `scripts/verify-deps.mjs` | Verification script |
| ✏️ Modify | `package.json` | Add `verify:deps` script, extend `check` |
| ✏️ Modify | `README.md` | Document supply-chain policy |

## Migration Strategy

1. **Run `npm install` first** to ensure lockfile is up to date
2. **Edit `package.json` to pin versions** (remove all `^` and `~`)
3. **Create `.npmrc`**
4. **Create `scripts/verify-deps.mjs`**
5. **Add `verify:deps` to `package.json` scripts**
6. **Add to `check` script**
7. **Run `npm test`** to verify nothing broke
8. **Document in README**

## Success Criteria

- [ ] All direct dependencies in `package.json` use exact versions
- [ ] `.npmrc` exists with `save-exact=true` and `min-release-age=2`
- [ ] `npm run verify:deps` passes
- [ ] `npm run check` includes `verify:deps`
- [ ] `npm test` passes (1175+ pass, 0 fail)
- [ ] README has "Supply-Chain Policy" section

## Out of Scope (Other Sub-Projects)

- Sub-project #5: Self-extensibility improvements
- Sub-project #6: Public session sharing
