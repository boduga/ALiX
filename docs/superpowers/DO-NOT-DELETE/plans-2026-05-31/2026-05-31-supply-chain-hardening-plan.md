**Status:** ✅ COMPLETED (2026-05-31) — all tasks implemented and merged to main

# Supply-Chain Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin ALiX's direct dependencies to exact versions, add `.npmrc` with `save-exact` and `min-release-age`, and add a `verify:deps` script — matching Pi Agent's supply-chain hardening patterns.

**Architecture:** No new code architecture. This is a configuration + verification script change. The verification script is a small Node.js program that reads `package.json` and confirms all dep versions are exact pins.

**Tech Stack:** Node.js, npm, `package.json` config, simple `.mjs` script.

---

## File Structure

**New files:**
- `.npmrc` — npm config (save-exact, min-release-age)
- `scripts/verify-deps.mjs` — Verification script
- `tests/scripts/verify-deps.test.mjs` — Tests for the verification script

**Modified files:**
- `package.json` — Pin all direct deps; add `verify:deps` script; extend `check`
- `README.md` — Document supply-chain policy

**Unchanged:**
- All source code, all tests, all other configs.

---

## Task 1: Create `.npmrc`

**Files:**
- Create: `.npmrc`

- [ ] **Step 1: Create the file**

```ini
# Save exact versions (no ^ or ~)
save-exact=true

# Require dependencies to be at least 2 days old
# (protects against typosquatting / supply-chain attacks on day-zero releases)
min-release-age=2

# Use lockfile as source of truth
package-lock=true
```

- [ ] **Step 2: Commit**

```bash
git add .npmrc
git commit -m "build: add .npmrc with save-exact and min-release-age"
```

---

## Task 2: Pin direct dependencies in `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update devDependencies to exact versions**

In `package.json`, change:

```diff
- "@types/better-sqlite3": "^7.6.13",
+ "@types/better-sqlite3": "7.6.13",
- "@types/node": "^24.0.0",
+ "@types/node": "24.0.0",
- "c8": "^11.0.0",
+ "c8": "11.0.0",
- "minimatch": "^10.2.5",
+ "minimatch": "10.2.5",
- "typescript": "^5.9.3",
+ "typescript": "5.9.3",
- "vitest": "^4.1.6",
+ "vitest": "4.1.6"
```

- [ ] **Step 2: Update dependencies to exact versions**

```diff
- "@xenova/transformers": "^2.17.2",
+ "@xenova/transformers": "2.17.2",
- "better-sqlite3": "^12.10.0",
+ "better-sqlite3": "12.10.0",
- "cli-spinners": "^3.4.0",
+ "cli-spinners": "3.4.0",
- "tiktoken": "^1.0.22",
+ "tiktoken": "1.0.22",
- "tree-sitter": "^0.21.1",
+ "tree-sitter": "0.21.1",
- "tree-sitter-typescript": "^0.23.2",
+ "tree-sitter-typescript": "0.23.2",
- "yaml": "^2.9.0",
+ "yaml": "2.9.0"
```

- [ ] **Step 3: Verify build still works**

```bash
npm run build 2>&1 | tail -3
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build: pin all direct dependencies to exact versions"
```

---

## Task 3: Create `verify-deps.mjs` script (TDD)

**Files:**
- Create: `tests/scripts/verify-deps.test.mjs`
- Create: `scripts/verify-deps.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// tests/scripts/verify-deps.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

function loadPackageJson() {
  const path = join(ROOT, "package.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("verify-deps: real package.json", () => {
  it("has no ^ ranges in dependencies", () => {
    const pkg = loadPackageJson();
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(deps)) {
      assert.ok(
        !String(version).startsWith("^"),
        `${name} uses caret range: ${version}`
      );
    }
  });

  it("has no ~ ranges in dependencies", () => {
    const pkg = loadPackageJson();
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(deps)) {
      assert.ok(
        !String(version).startsWith("~"),
        `${name} uses tilde range: ${version}`
      );
    }
  });

  it("all dependencies use exact version pins", () => {
    const pkg = loadPackageJson();
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(deps)) {
      // Must be a version like "1.2.3" — no ranges, no wildcards
      assert.ok(
        /^\d+\.\d+\.\d+/.test(String(version)),
        `${name} not pinned: ${version}`
      );
    }
  });
});
```

- [ ] **Step 2: Run test to verify current state**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
node --test dist/tests/scripts/verify-deps.test.mjs 2>&1 | tail -5
```

Expected: PASS (since we already pinned in Task 2).

- [ ] **Step 3: Create `scripts/verify-deps.mjs`**

```javascript
#!/usr/bin/env node
// scripts/verify-deps.mjs
// Verify all direct dependencies are pinned to exact versions.
// Fails with non-zero exit if any dep uses ^, ~, >, <, *, or x-range.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function main() {
  const pkgPath = join(ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const issues = [];

  for (const [name, version] of Object.entries(deps)) {
    const v = String(version);
    if (v.startsWith("^") || v.startsWith("~")) {
      issues.push(`  - ${name}: ${v} (caret/tilde range)`);
    } else if (/[><]/.test(v) || v.includes("*") || v.includes("x")) {
      issues.push(`  - ${name}: ${v} (range/wildcard)`);
    } else if (!/^\d+\.\d+\.\d+/.test(v)) {
      issues.push(`  - ${name}: ${v} (not a version pin)`);
    }
  }

  if (issues.length > 0) {
    console.error("❌ Supply-chain check FAILED:");
    console.error("   The following dependencies are not pinned to exact versions:\n");
    issues.forEach((i) => console.error(i));
    console.error("\n   All direct dependencies must be pinned (e.g., \"1.2.3\").");
    console.error("   This protects against supply-chain attacks via automatic minor/patch updates.");
    process.exit(1);
  }

  console.log(`✓ All ${Object.keys(deps).length} direct dependencies are pinned to exact versions.`);
}

main();
```

- [ ] **Step 4: Make the script executable**

```bash
chmod +x scripts/verify-deps.mjs
```

- [ ] **Step 5: Run the script to verify**

```bash
node scripts/verify-deps.mjs
```

Expected: "✓ All N direct dependencies are pinned to exact versions."

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-deps.mjs tests/scripts/verify-deps.test.mjs
git commit -m "build: add verify-deps script with TDD"
```

---

## Task 4: Add `verify:deps` script and extend `check`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `verify:deps` to scripts**

In `package.json`, add to the `scripts` section:

```json
"verify:deps": "node scripts/verify-deps.mjs"
```

- [ ] **Step 2: Extend the `check` script**

Change:
```json
"check": "npm run build && npm run test:node"
```
to:
```json
"check": "npm run build && npm run test:node && npm run verify:deps"
```

- [ ] **Step 3: Run `npm run check`**

```bash
npm run check 2>&1 | tail -10
```

Expected: build passes, tests pass, verify:deps passes.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build: add verify:deps script and extend check"
```

---

## Task 5: Document supply-chain policy in README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read current README**

```bash
head -50 README.md
```

- [ ] **Step 2: Add "Supply-Chain Policy" section**

Append to `README.md`:

```markdown
## Supply-Chain Policy

ALiX follows a strict supply-chain hardening policy to protect against dependency attacks:

- **All direct dependencies are pinned to exact versions** — no `^` or `~` ranges
- **`.npmrc` enforces `save-exact=true`** — future installs will also pin
- **`.npmrc` enforces `min-release-age=2`** — new versions must be 2+ days old before install
- **`npm run verify:deps`** — checks all direct deps are pinned (run via `npm run check`)
- **`package-lock.json` is the source of truth** — exact versions for transitive deps

This matches the supply-chain hardening patterns from [earendil-works/pi](https://github.com/earendil-works/pi).

To verify your local install meets the policy:
```bash
npm run verify:deps
```
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document supply-chain policy in README"
```

---

## Task 6: Final verification

- [ ] **Step 1: Run `npm run check` (full pipeline)**

```bash
npm run check 2>&1 | tail -15
```

Expected: build OK, tests pass, verify:deps passes.

- [ ] **Step 2: Run full test suite**

```bash
npm test 2>&1 | grep -E "pass|fail" | tail -3
```

Expected: pass >= 1175, fail 0

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: sub-project #4 supply-chain hardening complete

- All direct deps pinned to exact versions
- .npmrc with save-exact=true and min-release-age=2
- verify:deps script with TDD
- check command extended to include verify:deps
- README documents the policy"
```

---

## Self-Review

**1. Spec coverage:**
- [x] `.npmrc` with save-exact + min-release-age → Task 1
- [x] Pin all direct deps → Task 2
- [x] `verify-deps.mjs` script with TDD → Task 3
- [x] `verify:deps` script and `check` extension → Task 4
- [x] README documentation → Task 5
- [x] Final verification → Task 6
- [x] TDD per superpowers:test-driven-development ✓
- [x] No behavior change (tests must pass) ✓

**2. Placeholder scan:** No "TBD". All code complete.

**3. Type consistency:** Script reads `package.json` and checks against regex `^\d+\.\d+\.\d+` — same regex used in test.

**4. Plan length:** 6 tasks, each 2-5 minutes. TDD throughout. ✓
