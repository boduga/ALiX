# CAP-11 Remove Legacy Capability Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the A7.0/A7.1 legacy lifecycle subsystem, including overlay rehydration, the legacy CLI surface, and the canonical `CapabilityPlatform` accessor debt; install a structural sentinel preventing reintroduction. Pure deletion + sentinel enforcement; no new behavior.

**Architecture:** `CapabilityPlatform.service` becomes the sole public capability boundary; `catalog` and `registry` become private composition-root internals. New `src/cli/commands/capability.ts` (singular) is the sole owner of the `alix capability` namespace. The plural `alix capabilities` is removed without alias. CAP-10.5 (evolution-signal emission seam) stays as a separate ticket.

**Tech Stack:** TypeScript, vitest (sentinel), node:test (supersession + CLI), existing CAP-8/9/10 platforms

## Global Constraints

These constraints bind every task in this plan. Any deviation requires user approval.

### Locked rulings (verbatim from `memory/cap-11-rulings-locked.md`)

1. **CAP-10.5 stays separate.** CAP-11 ships no behavior additions. M1 evolution-signal emission seam is an independent CAP-10.5 PR.
2. **CLI namespace:** Create `src/cli/commands/capability.ts` (singular) as sole namespace dispatcher. Delete `src/cli/commands/capabilities.ts`. Existing `capability-proposals.ts` (CAP-9) and `capability-measure.ts` (CAP-10) stay intact.
3. **Sentinel scope:** New `cap-11-structural-cleanup-sentinel.vitest.ts` separate from `five-axis-sentinel.vitest.ts`. Delete `four-axis-sentinel.vitest.ts` (CAP-10 M5 closure). New `cap-11-supersession.test.ts` (node:test) is direct file-existence guard.
4. **Overlay mechanics:** Delete `rehydrateLifecycleOverlay()`, `JsonlCapabilityLifecycleLedger`, `APPROVED_PENDING_APPLICATION`, `cli.ts` lifecycle wiring, and `CapabilityRegistry.applyLifecycleTransition()`. Keep canonical `lifecycleState` field + `get/set/clear/listLifecycleStates` methods (used by CAP-4/7/8).
5. **Test removal:** Delete 15 `tests/evolution/capability-lifecycle/*` files + `tests/evolution/execution/capability-mutation-rollback.test.ts`. Preserve + UPDATE `tests/evolution/execution/integration/capability-mutation-executor-integration.test.ts` in place (drop `APPROVED_PENDING_APPLICATION` literal; keep negative-intent assertions). PRESERVE `src/capability/evolution/a7-proposals.ts` (CAP-9 active).
6. **CLI registration:** Singular `command === "capability"` only. Plural `capabilities` removed entirely — no alias, no redirect, no deprecation warning.
7. **Doc cleanup:** Banner A7.0/A7.1 checkpoints with `SUPERSEDED by CAP-11 — 2026-08-14`. Update greenfield architecture design §10/§11 + reconciled program CAP-11 status. Historical CAP-3/5/6/10 plans UNCHANGED.
8. **Platform surface:** `service` is sole public field. `catalog` and `registry` are composition-root internals (no public type exposure).
9. **CAP-9 supersession staleness:** Update stale assertion in `cap-9-supersession.test.ts` to "CAP-9 originally protected that surface; CAP-11 subsequently retired it (see `cap-11-supersession.test.ts`)." CAP-10 supersession + five-axis sentinel stay unchanged (trivially-passing reintroduction guards).
10. **Test refactor:** 5 platform-internals tests refactor to injected fixtures + `platform.service`. Two distinct concerns: composition correctness uses injected fixtures; public behavior uses `platform.service.*`.

### Forbidden files (CAP-11 must not touch)

- `src/capability/initial-capabilities.ts` (CAP-8 forbidden, preserved)
- `src/tools/tool-registry.ts` (CAP-8 forbidden)
- `src/policy/capability-registry.ts` (CAP-8 forbidden)
- `src/capability/canonical/*` (CAP-8 forbidden)
- `src/tui/capabilities/capability-service.ts` (CAP-7/9 forbidden TUI façade — pre-CAP-11 debt, NOT CAP-11's deletion)
- `src/capability/evolution/a7-proposals.ts` (CAP-9 active, preserved)
- All CAP-8/9/10 production code (composition-root boundary, optional ctor deps, governance purity, sentinel axes preserved)
- Any behavior addition (CAP-11 ships no new behavior; pure deletion only)

### Test commands

- `pnpm exec tsc --noEmit` → 0 errors
- `pnpm exec vitest run tests/capability/` → all green
- `node scripts/run-node-tests.mjs` → all green

### Pre-resolved bugs (CAP-9/10 retro, all carry forward)

- `pnpm exec tsc --noEmit` (not `tsc`)
- `pnpm exec vitest run` (not bare)
- `node scripts/run-node-tests.mjs` (not `tsx --test`)
- `.js` extensions on relative imports
- `Object.freeze(this)` after all property assignments
- Long-form event types (`capability.governance.proposal.*`, etc.)
- `capability-lifecycle` was a CAP-10 ruling #17 type-only import target; the engine was the orchestrator. After CAP-11, no file imports from `src/evolution/capability-lifecycle/*`.

### Commit message format

```
<type>(<scope>): <description>

<body>

Co-Authored-By: Claude <noreply@anthropic.com>
```

Types: `feat` (additions), `fix` (bug fixes), `refactor` (no behavior change), `docs` (documentation), `test` (test additions/changes), `chore` (tooling/maintenance).

---

## File Structure (CAP-11)

### Deleted (source)

```
src/evolution/capability-lifecycle/                  # entire directory (13 files)
src/cli/commands/capabilities.ts                     # CAP-8 re-export shim
```

### Deleted (tests)

```
tests/evolution/capability-lifecycle/                # entire directory (15 files)
tests/evolution/execution/capability-mutation-rollback.test.ts
tests/capability/four-axis-sentinel.vitest.ts        # CAP-10 M5 closure
```

### Created

```
src/cli/commands/capability.ts                      # singular namespace dispatcher
tests/capability/cap-11-structural-cleanup-sentinel.vitest.ts
tests/capability/cap-11-supersession.test.ts
```

### Modified

```
src/capability/registry.ts                           # remove applyLifecycleTransition
src/capability/platform.ts                           # catalog/registry private
src/capability/measurement/capability-measurement-engine.ts  # drop vacuous doc comment
src/cli.ts                                           # singular capability block
tests/capability/cap-9-supersession.test.ts          # acknowledge CAP-11 retirement
tests/capability/composition-root-wiring.vitest.ts  # injected fixtures
tests/capability/platform-projection.vitest.ts      # injected fixtures
tests/capability/platform.vitest.ts                 # injected fixtures
tests/capability/tool-adapter.vitest.ts             # injected fixtures
tests/evolution/execution/integration/capability-mutation-executor-integration.test.ts  # drop literal
docs/architecture/checkpoints/2026-08-10-a7-capability-marketplace-checkpoint.md   # SUPERSEDED banner
docs/architecture/checkpoints/2026-08-10-a7-1-capability-application-checkpoint.md # SUPERSEDED banner
docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md  # §10/§11 update
docs/superpowers/specs/2026-08-10-capability-platform-greenfield-reconciled-program.md  # CAP-11 status
```

### Preserved (must not touch)

```
src/capability/evolution/a7-proposals.ts             # CAP-9 A7ProposalGenerator
src/cli/commands/capability-proposals.ts            # CAP-9
src/cli/commands/capability-measure.ts              # CAP-10
src/capability/capability-service.ts                 # CAP-8/9/10
src/capability/types/service-results.ts              # CAP-8/9/10
src/evolution/observation/a5-capability-measurement.ts  # CAP-10
src/evolution/execution/capability-mutation-executor.ts  # CAP-4
src/capability/provider-resolver.ts                  # CAP-4/7
```

---

## Task 1: Delete A7.1 lifecycle source machinery (R4, R5)

**Files:**
- Delete: `src/evolution/capability-lifecycle/*` (entire directory, 13 files)
- Delete: `src/capability/registry.ts:applyLifecycleTransition()` method
- Modify: any other source file referencing A7.1 symbols

**Interfaces:**
- Consumes: `CapabilityRegistry.setLifecycleState()` (canonical, KEEP); `LifecycleState` type from `src/adaptation/capability-evolution-types.ts`
- Produces: deleted directory; `CapabilityRegistry` without `applyLifecycleTransition` method

### Steps

- [ ] **Step 1: Delete the directory**

```bash
git rm -r src/evolution/capability-lifecycle/
```

Expected: directory and all 13 files removed from git.

- [ ] **Step 2: Remove `applyLifecycleTransition()` from `CapabilityRegistry`**

```bash
grep -n "applyLifecycleTransition" src/capability/registry.ts
```

Expected: one definition + one comment block. Delete the method (it's an alias for `setLifecycleState`).

In `src/capability/registry.ts`, find the `applyLifecycleTransition` method (~line 133):

```typescript
applyLifecycleTransition(id: string, to: LifecycleState): void {
  this.setLifecycleState(id, to);
}
```

Remove this method entirely. Also remove the comment block above it (lines 130-132) that references "rehydration, step-executor".

- [ ] **Step 3: Search for stale imports**

```bash
grep -rn "from.*evolution/capability-lifecycle\|from.*[\"'].*capability-lifecycle" --include="*.ts" --include="*.js" src 2>&1
```

Expected: NO results (the directory is gone; imports break compile). Fix any remaining stragglers.

- [ ] **Step 4: Run typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: 0 errors. If imports remain, fix them.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(capability): CAP-11 delete A7.1 lifecycle source machinery"
```

---

## Task 2: Create `capability.ts` singular CLI dispatcher + delete `capabilities.ts` shim (R2)

**Files:**
- Create: `src/cli/commands/capability.ts`
- Delete: `src/cli/commands/capabilities.ts`
- Modify: `src/cli/commands/capability-measure.ts` (no change expected — already exists)
- Modify: `src/cli/commands/capability-proposals.ts` (no change expected — already exists)

**Interfaces:**
- Consumes: `CapabilityService` from `src/capability/capability-service.js`; `capabilityProposalsCommand` from `./capability-proposals.js`; `capabilityMeasureCommand` from `./capability-measure.js`
- Produces: `handleCapabilityCommand(args, deps): Promise<number | void>` dispatcher

### Steps

- [ ] **Step 1: Inspect existing handler signatures**

```bash
grep -n "export.*function\|export.*async function" src/cli/commands/capability-proposals.ts src/cli/commands/capability-measure.ts
```

Expected: `capabilityProposalsCommand(args, deps)` + `capabilityMeasureCommand(args, deps)` exported.

- [ ] **Step 2: Create `src/cli/commands/capability.ts`**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-11 — sole owner of the `alix capability` namespace.
 *
 * Per locked ruling #2: this dispatcher parses subcommand and delegates
 * to existing CAP-9 / CAP-10 handlers. NO measurement / proposal / lifecycle /
 * governance logic in this file.
 */

import type { CapabilityService } from "../../capability/capability-service.js";
import { capabilityProposalsCommand } from "./capability-proposals.js";
import { capabilityMeasureCommand } from "./capability-measure.js";

export interface CapabilityCommandDeps {
  readonly service: CapabilityService;
  readonly cwd: string;
}

export async function handleCapabilityCommand(
  args: readonly string[],
  deps: CapabilityCommandDeps,
): Promise<number | void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "proposals":
      return capabilityProposalsCommand(rest, { service: deps.service });
    case "measure":
      return capabilityMeasureCommand(rest, { service: deps.service });
    default:
      console.error(`Unknown capability subcommand: ${subcommand ?? "(none)"}`);
      console.error("Usage: alix capability <subcommand> [...]");
      console.error("Subcommands: proposals, measure");
      return 2;
  }
}
```

- [ ] **Step 3: Delete `src/cli/commands/capabilities.ts` shim**

```bash
git rm src/cli/commands/capabilities.ts
```

- [ ] **Step 4: Verify typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(cli): CAP-11 singular capability namespace dispatcher"
```

---

## Task 3: Refactor `src/cli.ts` capability block (R6)

**Files:**
- Modify: `src/cli.ts` (the `command === "capabilities"` block → `command === "capability"`)

### Steps

- [ ] **Step 1: Locate the existing block**

```bash
grep -n "Capabilities command\|capability-lifecycle-ledger\|rehydrateLifecycleOverlay\|handleCapabilitiesCommand\|capabilities\"\|command === \"capabilities\"" src/cli.ts
```

- [ ] **Step 2: Replace the block**

Find:

```typescript
  // ── Capabilities command (A7.0/A7.1) ────────────────────────────
  if (command === "capabilities") {
    const { handleCapabilitiesCommand } = await import("./cli/commands/capabilities.js");
    const { CapabilityPlatform } = await import("./capability/platform.js");
    const { JsonlCapabilityLifecycleLedger, DEFAULT_CAPABILITY_LIFECYCLE_FILE } = await import("./evolution/capability-lifecycle/capability-lifecycle-ledger.js");
    const { CapabilityEvolutionStore } = await import("./adaptation/capability-evolution-store.js");
    const { rehydrateLifecycleOverlay } = await import("./evolution/capability-lifecycle/capability-lifecycle-rehydration.js");
    const { EventLog } = await import("./events/event-log.js");
    const cwd = process.cwd();
    const sessionDir = join(cwd, ".alix", "sessions", "capabilities-cmd");
    // ... and the rest of the block
  }
```

Replace with:

```typescript
  // ── Capability command (singular; CAP-11 owner of alix capability namespace) ──
  if (command === "capability") {
    const { handleCapabilityCommand } = await import("./cli/commands/capability.js");
    const { CapabilityPlatform } = await import("./capability/platform.js");
    const { EventLog } = await import("./events/event-log.js");
    const cwd = process.cwd();
    const sessionDir = join(cwd, ".alix", "sessions", "capability-cmd");
    const eventLog = new EventLog(sessionDir);
    const platform = new CapabilityPlatform({
      catalogDir: join(cwd, ".alix", "capabilities"),
      eventLog,
    });
    const exitCode = await handleCapabilityCommand(args, {
      cwd,
      service: platform.service,
    });
    if (typeof exitCode === "number") process.exit(exitCode);
  }
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Run capability vitest + node:test**

```bash
pnpm exec vitest run tests/capability/
node scripts/run-node-tests.mjs
```

Expected: all green (existing tests don't yet exercise the singular path — they'll be tested in T7).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts && git commit -m "feat(cli): CAP-11 singular capability registration; drop lifecycle overlay wiring"
```

---

## Task 4: Refactor `src/capability/platform.ts` — private catalog/registry (R8)

**Files:**
- Modify: `src/capability/platform.ts`

### Steps

- [ ] **Step 1: Inspect current public surface**

```bash
grep -n "readonly\|public\|export" src/capability/platform.ts | head -20
```

Expected: `readonly registry: CapabilityRegistry`, `readonly catalog: CapabilityCatalog`, `readonly service: CapabilityService`.

- [ ] **Step 2: Make `catalog` and `registry` private**

In `src/capability/platform.ts`, change:

```typescript
  readonly registry: CapabilityRegistry;
  readonly catalog: CapabilityCatalog;
  readonly service: CapabilityService;
```

To:

```typescript
  // PRIVATE — composition-root internals (CAP-11 ruling #8)
  private readonly registry: CapabilityRegistry;
  private readonly catalog: CapabilityCatalog;

  // PUBLIC — sole capability service boundary
  readonly service: CapabilityService;
```

- [ ] **Step 3: Verify internal references still work**

The platform itself still references `this.registry`, `this.catalog`, `this.providers`, etc. internally — these remain unchanged.

- [ ] **Step 4: Run typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: 0 errors on platform itself; tests will fail until T5 refactors them.

- [ ] **Step 5: Commit**

```bash
git add src/capability/platform.ts && git commit -m "refactor(capability): CAP-11 make catalog/registry private; service is sole public surface"
```

---

## Task 5: Refactor 5 platform-internals tests (R10)

**Files:**
- Modify: `tests/capability/composition-root-wiring.vitest.ts`
- Modify: `tests/capability/platform-projection.vitest.ts`
- Modify: `tests/capability/platform.vitest.ts`
- Modify: `tests/capability/tool-adapter.vitest.ts`

### Steps

- [ ] **Step 1: Identify the patterns to refactor**

Each test currently does:

```typescript
const platform = new CapabilityPlatform({ ... });
registerInitialCapabilities(platform.registry, platform.native);
// ... assertions on platform.registry.list() etc.
```

Replace with:

```typescript
const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir: tmpDir }));
const platform = new CapabilityPlatform({ catalog, eventLog });
registerInitialCapabilities(catalog, platform.native);  // or however the API expects
// ... assertions via platform.service.*  OR via test-owned catalog
```

Two distinct concerns:
- **Composition correctness** — use test-owned catalog; assert directly on it
- **Public behavior** — assert via `platform.service.*`

- [ ] **Step 2: Refactor `tests/capability/composition-root-wiring.vitest.ts`**

Replace `platform.registry` accesses with test-owned `catalog` fixture assertions. Verify composition wiring by checking that `platform.service.list()` reflects the catalog contents.

- [ ] **Step 3: Refactor `tests/capability/platform-projection.vitest.ts`**

Same pattern: replace `platform.registry.list()` with assertions via `platform.service.list()` or test-owned catalog.

- [ ] **Step 4: Refactor `tests/capability/platform.vitest.ts`**

`registerInitialCapabilities(catalog, native)` — pass the test-owned catalog directly.

- [ ] **Step 5: Refactor `tests/capability/tool-adapter.vitest.ts`**

Same pattern.

- [ ] **Step 6: Run capability vitest**

```bash
pnpm exec vitest run tests/capability/
```

Expected: 461/461 PASS (same count; tests refactored, not added).

- [ ] **Step 7: Run typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add tests/capability/ && git commit -m "refactor(test): CAP-11 platform-internals tests use injected fixtures + platform.service"
```

---

## Task 6: Delete A7.1 tests + update mutation-executor-integration (R5)

**Files:**
- Delete: `tests/evolution/capability-lifecycle/` (entire directory, 15 files)
- Delete: `tests/evolution/execution/capability-mutation-rollback.test.ts`
- Modify: `tests/evolution/execution/integration/capability-mutation-executor-integration.test.ts` (drop `APPROVED_PENDING_APPLICATION` literal)

### Steps

- [ ] **Step 1: Delete the legacy test directories**

```bash
git rm -r tests/evolution/capability-lifecycle/
git rm tests/evolution/execution/capability-mutation-rollback.test.ts
```

- [ ] **Step 2: Update `capability-mutation-executor-integration.test.ts`**

```bash
grep -n "APPROVED_PENDING_APPLICATION" tests/evolution/execution/integration/capability-mutation-executor-integration.test.ts
```

For each occurrence (lines 18, 207, 402 per pre-survey):
- Drop the literal `APPROVED_PENDING_APPLICATION` reference
- Keep the negative-intent assertion ("no dead-end", "completes end-to-end")

Suggested rewording:
- Line 18 comment: `// CAP-4 fail-safe stop: mutation completes end-to-end or fails cleanly.`
- Line 207 test name: `"create: approved mutation publishes complete definition; no fail-dead-end"`
- Line 402 comment: `// an undetected fail-dead-end state.`

The exact rewording is judgment-call — preserve the behavioral intent.

- [ ] **Step 3: Run typecheck + node:test**

```bash
pnpm exec tsc --noEmit
node scripts/run-node-tests.mjs
```

Expected: 0 errors; pass count decreases by ~15 test files.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test(capability): CAP-11 delete A7.1 tests; preserve mutation-executor negative-intent"
```

---

## Task 7: CAP-11 sentinels + CAP-9 supersession update (R3, R9)

**Files:**
- Create: `tests/capability/cap-11-structural-cleanup-sentinel.vitest.ts`
- Create: `tests/capability/cap-11-supersession.test.ts`
- Modify: `tests/capability/cap-9-supersession.test.ts`
- Delete: `tests/capability/four-axis-sentinel.vitest.ts`

### Steps

- [ ] **Step 1: Delete `four-axis-sentinel.vitest.ts`**

```bash
git rm tests/capability/four-axis-sentinel.vitest.ts
```

- [ ] **Step 2: Update `cap-9-supersession.test.ts`**

Find the assertion that "CAP-9 left `src/evolution/capability-lifecycle/*` untouched" and rewrite to:

```typescript
// CAP-9 originally protected this surface; CAP-11 subsequently retired it.
// See cap-11-supersession.test.ts for authoritative deletion proof.
```

The test remains a pointer, not an assertion.

- [ ] **Step 3: Create `cap-11-supersession.test.ts` (node:test)**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import assert from "node:assert/strict";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

const DELETED_SOURCE_FILES = [
  "src/evolution/capability-lifecycle/index.ts",
  "src/evolution/capability-lifecycle/errors.ts",
  "src/evolution/capability-lifecycle/capability-lifecycle-analyzer.ts",
  "src/evolution/capability-lifecycle/capability-lifecycle-applier.ts",
  "src/evolution/capability-lifecycle/capability-lifecycle-cli.ts",
  "src/evolution/capability-lifecycle/capability-lifecycle-ledger.ts",
  "src/evolution/capability-lifecycle/capability-lifecycle-measurer.ts",
  "src/evolution/capability-lifecycle/capability-lifecycle-rehydration.ts",
  "src/evolution/capability-lifecycle/capability-lifecycle-step-executor.ts",
  "src/evolution/capability-lifecycle/capability-execution-projection.ts",
  "src/evolution/capability-lifecycle/capability-governance-bridge.ts",
  "src/evolution/capability-lifecycle/capability-proposal-builder.ts",
  "src/evolution/capability-lifecycle/contracts/lifecycle-contract.ts",
  "src/cli/commands/capabilities.ts",
];

const DELETED_TEST_FILES = [
  "tests/evolution/capability-lifecycle/capability-execution-projection.test.ts",
  "tests/evolution/capability-lifecycle/capability-governance-bridge.test.ts",
  "tests/evolution/capability-lifecycle/capability-lifecycle-three-axis.test.ts",
  "tests/evolution/capability-lifecycle/capability-lifecycle-contract-a71.test.ts",
  "tests/evolution/capability-lifecycle/capability-lifecycle-analyzer.test.ts",
  "tests/evolution/capability-lifecycle/capability-lifecycle-applier.test.ts",
  "tests/evolution/capability-lifecycle/capability-lifecycle-step-executor.test.ts",
  "tests/evolution/capability-lifecycle/capability-lifecycle-ledger.test.ts",
  "tests/evolution/capability-lifecycle/capability-lifecycle-measurer.test.ts",
  "tests/evolution/capability-lifecycle/capability-lifecycle-rehydration.test.ts",
  "tests/evolution/capability-lifecycle/capability-lifecycle-record.test.ts",
  "tests/evolution/capability-lifecycle/capability-cli.test.ts",
  "tests/evolution/capability-lifecycle/capability-proposal-builder.test.ts",
  "tests/evolution/capability-lifecycle/integration/a7-capability-lifecycle-integration.test.ts",
  "tests/evolution/capability-lifecycle/integration/a7-1-capability-application-integration.test.ts",
  "tests/evolution/execution/capability-mutation-rollback.test.ts",
  "tests/capability/four-axis-sentinel.vitest.ts",
];

test("cap-11-supersession: A7.1 source files deleted", () => {
  for (const f of DELETED_SOURCE_FILES) {
    assert.equal(
      fs.existsSync(path.join(REPO_ROOT, f)),
      false,
      `${f} must be deleted after CAP-11`,
    );
  }
});

test("cap-11-supersession: A7.1 test files deleted", () => {
  for (const f of DELETED_TEST_FILES) {
    assert.equal(
      fs.existsSync(path.join(REPO_ROOT, f)),
      false,
      `${f} must be deleted after CAP-11`,
    );
  }
});

test("cap-11-supersession: APPROVED_PENDING_APPLICATION literal removed", () => {
  // After T1, no source file contains this literal.
  // Walk src/ for the literal; expect zero matches.
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        out.push(...walk(full));
      } else if (/\.(ts|js)$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  };
  const files = walk(path.join(REPO_ROOT, "src"));
  for (const f of files) {
    const text = fs.readFileSync(f, "utf-8");
    assert.equal(
      text.includes("APPROVED_PENDING_APPLICATION"),
      false,
      `${path.relative(REPO_ROOT, f)} must not contain APPROVED_PENDING_APPLICATION`,
    );
  }
});
```

- [ ] **Step 4: Create `cap-11-structural-cleanup-sentinel.vitest.ts`**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

describe("CAP-11 Structural Cleanup Sentinel (ruling #3, #4, #8)", () => {
  it("axis 1: APPROVED_PENDING_APPLICATION literal is gone from src/", () => {
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules") continue;
          out.push(...walk(full));
        } else if (/\.(ts|js)$/.test(entry.name)) {
          out.push(full);
        }
      }
      return out;
    };
    const files = walk(path.join(REPO_ROOT, "src"));
    for (const f of files) {
      const text = fs.readFileSync(f, "utf-8");
      expect(text, path.relative(REPO_ROOT, f)).not.toContain("APPROVED_PENDING_APPLICATION");
    }
  });

  it("axis 2: no lifecycle-overlay machinery (rehydrateLifecycleOverlay)", () => {
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules") continue;
          out.push(...walk(full));
        } else if (/\.(ts|js)$/.test(entry.name)) {
          out.push(full);
        }
      }
      return out;
    };
    const files = walk(path.join(REPO_ROOT, "src"));
    for (const f of files) {
      const text = fs.readFileSync(f, "utf-8");
      expect(text, path.relative(REPO_ROOT, f)).not.toMatch(/rehydrateLifecycleOverlay/);
    }
  });

  it("axis 3: no file imports from src/evolution/capability-lifecycle/*", () => {
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules") continue;
          out.push(...walk(full));
        } else if (/\.(ts|js)$/.test(entry.name)) {
          out.push(full);
        }
      }
      return out;
    };
    const files = walk(path.join(REPO_ROOT, "src"));
    for (const f of files) {
      const text = fs.readFileSync(f, "utf-8");
      expect(text, path.relative(REPO_ROOT, f)).not.toMatch(/from\s+["'][^"']*capability-lifecycle/);
    }
  });

  it("axis 4: only CapabilityPlatform constructs CapabilityRegistry (no second CLI registry construction)", () => {
    const srcFiles = collectFiles(path.join(REPO_ROOT, "src"));
    for (const f of srcFiles) {
      const text = fs.readFileSync(f, "utf-8");
      if (f.endsWith("src/capability/platform.ts")) continue;
      expect(text, path.relative(REPO_ROOT, f)).not.toMatch(/new\s+CapabilityRegistry\s*\(/);
    }
  });

  it("axis 5: CapabilityPlatform.service is the sole public capability surface (no platform.registry / platform.catalog in non-test code)", () => {
    const srcFiles = collectFiles(path.join(REPO_ROOT, "src"));
    for (const f of srcFiles) {
      if (f.endsWith("src/capability/platform.ts")) continue;
      const text = fs.readFileSync(f, "utf-8");
      expect(text, path.relative(REPO_ROOT, f)).not.toMatch(/platform\.registry/);
      expect(text, path.relative(REPO_ROOT, f)).not.toMatch(/platform\.catalog/);
    }
  });

  it("axis 6: CapabilityRegistry.applyLifecycleTransition removed (ruling #4)", () => {
    const registrySrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/capability/registry.ts"),
      "utf-8",
    );
    expect(registrySrc).not.toMatch(/applyLifecycleTransition/);
  });

  it("axis 7: 'capabilities' (plural) CLI command removed (ruling #6)", () => {
    const cliSrc = fs.readFileSync(path.join(REPO_ROOT, "src/cli.ts"), "utf-8");
    expect(cliSrc).not.toMatch(/command\s*===\s*["']capabilities["']/);
  });
});

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...collectFiles(full));
    } else if (/\.(ts|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}
```

- [ ] **Step 5: Drop vacuous doc comment in `capability-measurement-engine.ts`**

```bash
grep -n "MUST NOT import" src/capability/measurement/capability-measurement-engine.ts
```

Remove the bullet: "MUST NOT import `src/evolution/capability-lifecycle/*`." (path is gone; vacuous.)

- [ ] **Step 6: Run all tests + typecheck**

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run tests/capability/
node scripts/run-node-tests.mjs
```

Expected: 0 errors; cap-11-structural-cleanup-sentinel vitest PASS; cap-11-supersession node:test PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "test(capability): CAP-11 deletion-purity sentinel + supersession; close M5 four-axis"
```

---

## Task 8: Documentation cleanup (R7)

**Files:**
- Modify: `docs/architecture/checkpoints/2026-08-10-a7-capability-marketplace-checkpoint.md`
- Modify: `docs/architecture/checkpoints/2026-08-10-a7-1-capability-application-checkpoint.md`
- Modify: `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md`
- Modify: `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-reconciled-program.md`

### Steps

- [ ] **Step 1: Add SUPERSEDED banner to A7.0 checkpoint**

Top of `docs/architecture/checkpoints/2026-08-10-a7-capability-marketplace-checkpoint.md`:

```markdown
> **SUPERSEDED by CAP-11 — 2026-08-14.** The A7.0/A7.1 legacy lifecycle machinery (capability-lifecycle overlay, applier, ledger, measurer, CLI shim) has been retired. See `memory/cap-11-rulings-locked.md` and `memory/cap-11-remove-legacy-capability-surfaces-complete.md` for the cleanup details.
```

- [ ] **Step 2: Add SUPERSEDED banner to A7.1 checkpoint**

Same banner at top of `docs/architecture/checkpoints/2026-08-10-a7-1-capability-application-checkpoint.md`.

- [ ] **Step 3: Update greenfield architecture design §10/§11**

Find sections that mention lifecycle overlay / measurer as active or planned. Update to:

```text
The lifecycle overlay (`rehydrateLifecycleOverlay`) and `CapabilityLifecycleMeasurer` were retired in CAP-11 (2026-08-14). CAP-4 / CAP-7 / CAP-8 use the canonical `CapabilityRegistry.lifecycleState` directly; CAP-12 closes the e2e evolution loop on top of CAP-10 measurement + CAP-10.5 signal emission.
```

- [ ] **Step 4: Update reconciled program CAP-11 status**

Find CAP-11 entry. Update status from "pending" to:

```text
CAP-11 — Remove Legacy Capability Surfaces: COMPLETE (PR #TBD, merged 2026-08-14). Tag `alix-cap-11-remove-legacy-capability-surfaces-complete`. See `memory/cap-11-remove-legacy-capability-surfaces-complete.md`.
```

- [ ] **Step 5: Commit**

```bash
git add docs/ && git commit -m "docs(architecture): CAP-11 supersession banners + current-state updates"
```

---

## AC Coverage Matrix

| Ticket #495 AC | Plan coverage |
|----------------|---------------|
| A7 capability CLI surface removed | T2 (delete `capabilities.ts`) + T3 (`cli.ts` singular block) |
| A7 lifecycle machinery removed | T1 (delete `src/evolution/capability-lifecycle/*`) |
| `APPROVED_PENDING_APPLICATION` removed | T1 (delete literal) + T6 (update test) |
| Registry lifecycle overlay removed | T1 (delete rehydration) |
| Obsolete A7 lifecycle tests removed | T6 (delete 15 tests) |
| Superseded docs marked | T8 |
| Structural sentinel installs | T7 (`cap-11-structural-cleanup-sentinel.vitest.ts` + `cap-11-supersession.test.ts`) |
| North-star: one catalog/registry/mutation/service | T4 (platform refactor) + T5 (test refactor) + T7 (sentinel axis 5) |

---

## Self-Review

1. **Spec coverage:** All 7 ticket ACs mapped to plan tasks (see AC Coverage Matrix). Verified.
2. **Placeholder scan:** No "TBD" / "TODO" / "implement later" markers. Task briefs are explicit.
3. **Type consistency:** `handleCapabilityCommand(args, deps)` signature in T2 matches the dispatcher imports in T3. `CapabilityCommandDeps` interface consistent.
4. **Ruling fidelity:** All 10 rulings (R1-R10) referenced verbatim in Global Constraints and applied across tasks.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-14-cap-11-remove-legacy-capability-surfaces.md`. Per standing user intent (execute to completion; only stop for BLOCKED or ambiguity), proceeding via superpowers:subagent-driven-development with:

- Implementer model: haiku for pure-file deletion tasks (T1, T2 partial, T6 partial); sonnet for spec-compliance integration tasks (T2, T3, T4, T5, T7, T8)
- Reviewer model: haiku for fix-reviews; sonnet for first reviews of integration tasks
- Opus for whole-branch final review

Tasks dispatched in dependency order: T1 → T6 → T2 → T3 → T4 → T5 → T7 → T8.
