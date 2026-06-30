# P10.9.2b — Remediation Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `needs_specification` proposals into concrete applyable child proposals via a remediation wizard (Gate 2 in the approve → specify → apply lifecycle).

**Architecture:** Provider/registry pattern (`RemediationProvider` + `RemediatorRegistry`) with a pure builder core (`buildRemediationChildDraft`) and an effectful CLI shell (`handleRemediateCommand`). Child proposals preserve immutable lineage. No new persistence, no ADR-0004 changes.

**Tech Stack:** TypeScript, existing `ProposalStore`, `nextProposalId`, `computeProposalReadiness`, `isExecutiveBridgeProposal`, executive purity sentinel.

**Spec:** `docs/architecture/specs/2026-06-30-p10-9-2b-remediation-wizard-design.md`

## Global Constraints

- **No ADR-0004 protected type changes.** Do not modify `adaptation-types.ts`, `proposal-store.ts`, `approval-gate.ts`, or any file that triggers snapshot-equal verification.
- **No new persistence layer.** Child proposals use existing `ProposalStore`. No new store, no new JSONL file, no new database table.
- **Pure builder contract.** `buildRemediationChildDraft()` must never read the filesystem, generate ids/timestamps, mutate the parent, or save proposals.
- **Exactly-one provider contract.** The registry must fail if zero or more than one provider matches.
- **Dry-run parity.** `--dry-run` must execute the identical validation and build pipeline; only `save` is skipped.
- **Parent immutability.** The parent proposal must never be modified.
- **R6 — No recursive remediation.** Child proposals must never themselves produce `needs_specification` readiness. Child target kinds must always be applyable (`ready_to_apply`) or manual (`manual_action`).
- **Registry factory, not singleton.** Export `createDefaultRegistry()` instead of a global `registry` instance. Tests create their own registries.
- **Follow existing patterns.** Dynamic import + handler function in `executive.ts` switch (same as `bridge`, `learn`, `recommend`). CLI test fixtures use temp directories + `ProposalStore` (same pattern as `executive-bridge-status.vitest.ts`).

---

### Task 1: Pure types, interfaces, registry, and ExecutiveBridgeRemediator

**Files:**
- Create: `src/executive/executive-remediate.ts`

**Interfaces:**
- Produces: Exports for `ActionSpec`, `RemediationSpec`, `RemediationContext`, `ValidationErrorCode`, `ValidationResult`, `ChildProposalDraft`, `RemediationProvider`, `RemediatorRegistry`, `ExecutiveBridgeRemediator`, `validateRemediationParent`, `validateSpecification`, `validatePayload`, `mergeLineagePayload`, `buildRemediationChildDraft`, `RESERVED_PAYLOAD_KEYS`

- [ ] **Step 1: Write the failing unit test file**

Create `tests/executive/executive-remediate.vitest.ts` with these test groups:

```typescript
import { describe, it, expect } from "vitest";
import {
  ExecutiveBridgeRemediator,
  RemediatorRegistry,
  validateRemediationParent,
  validateSpecification,
  validatePayload,
  mergeLineagePayload,
  buildRemediationChildDraft,
} from "../../src/executive/executive-remediate.js";
// ... types import
```

**Test groups (15+ tests total):**

1. **validateRemediationParent** — undefined, wrong status, non-executive, wrong readiness, valid
2. **validateSpecification** — unsupported action, empty targetId, short reason (< 10 chars), valid
3. **validatePayload** — reserved key rejected (`parentProposalId`, `planId`, `orchestrationState`, etc.), empty payload ok, unknown keys ok
4. **mergeLineagePayload** — additional only, lineage only, conflict (lineage wins), empty additional
5. **buildRemediationChildDraft** — governance, agent_card, skill, issue actions; lineage fields present; context passed; idempotence (same in = same out)
6. **Registry** — register + find, zero matches throws, multiple matches throws, list returns all
7. **ExecutiveBridgeRemediator.supportedActions** — returns 4 actions with correct mappings

```typescript
it("rejects reserved lineage key via validatePayload", () => {
  const err = validatePayload({ parentProposalId: "evil" });
  expect(err).toBe('"parentProposalId" is a reserved lineage field and cannot be set via --payload');
});

it("mergeLineagePayload lineage wins over additional", () => {
  const result = mergeLineagePayload(
    { parentProposalId: "evil", extra: "ok" },
    { parentProposalId: "real", source: "test" },
  );
  expect(result.parentProposalId).toBe("real");
  expect(result.extra).toBe("ok");
});

it("buildRemediationChildDraft is idempotent", () => {
  const parent = makeParent();
  const spec = makeSpec({ actionName: "update_skill" });
  const ctx = { actor: "test", mode: "noninteractive" as const };
  const a = buildRemediationChildDraft(parent, spec, ctx);
  const b = buildRemediationChildDraft(parent, spec, ctx);
  expect(a).toEqual(b);
});

it("registry throws on multiple matches", () => {
  const registry = new RemediatorRegistry();
  registry.register(new ExecutiveBridgeRemediator());
  registry.register(new ExecutiveBridgeRemediator()); // duplicate-support
  expect(() => registry.find(makeParent())).toThrow("Multiple remediators");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/executive/executive-remediate.vitest.ts --config vitest.config.mts 2>&1 | head -5
```
Expected: `FAIL` — all tests fail because `executive-remediate.ts` doesn't exist yet.

- [ ] **Step 3: Implement `src/executive/executive-remediate.ts`**

Contains in order:

1. **Imports** — `AdaptationProposal`, `ProposalAction`, `ProposalTarget` from `adaptation-types.js`; `computeProposalReadiness`, `isExecutiveBridgeProposal` from `../adaptation/proposal-readiness.js`

2. **Types** — `ActionSpec`, `RemediationSpec`, `RemediationContext`, `ValidationErrorCode`, `ValidationResult`, `ChildProposalDraft`

3. **RESERVED_PAYLOAD_KEYS** — `Set<string>` with all reserved lineage field names from the spec (Section 5, R2)

4. **RemediationProvider interface** — `id`, `description`, `supportedSources`, `priority`, `version`, `supportedActions()`, `supports()`, `buildDraft()`, optional `promptSpecification()`

5. **RemediatorRegistry class**:
   - `private providers: RemediationProvider[]`
   - `register(provider)` — pushes to array
   - `unregister(id)` — filters out
   - `find(proposal)` — filters via `supports()`, throws if length !== 1
   - `list()` — returns copy

6. **ExecutiveBridgeRemediator class** implementing `RemediationProvider`:
   - `supportedActions()` returns the 4 action specs
   - `supports()` delegates to `isExecutiveBridgeProposal()`
   - `buildDraft()` builds child with full lineage payload (parent version snapshot, graph-friendly fields, orchestration reservation)

7. **Registry factory function** — `export function createDefaultRegistry(): RemediatorRegistry` that creates a new registry and registers `ExecutiveBridgeRemediator`. The CLI handler calls this once; tests create their own registries (empty, with fakes, with duplicates).

8. **Pure functions**:
   - `validateRemediationParent(proposal: AdaptationProposal | undefined): ValidationResult`
   - `validatePayload(payload: Record<string, unknown>): string | null`
   - `validateSpecification(spec: RemediationSpec, provider: RemediationProvider): string | null`
   - `mergeLineagePayload(additional, lineage): Record<string, unknown>`

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/executive/executive-remediate.vitest.ts --config vitest.config.mts
```
Expected: All 15+ tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/executive/executive-remediate.ts tests/executive/executive-remediate.vitest.ts
git commit -m "P10.9.2b-T1: pure types + RemediationProvider + RemediatorRegistry + builder

- Types: ActionSpec, RemediationSpec, RemediationContext, ChildProposalDraft
- Validation: validateRemediationParent with structured error codes
- Security: validatePayload rejects reserved lineage keys
- Registry: RemediatorRegistry with exactly-one provider contract
- Provider: ExecutiveBridgeRemediator with 4 action families
- Builder: buildRemediationChildDraft with full lineage payload
- Reusable: mergeLineagePayload helper
- Graph-ready: lineageType, lineageDepth, lineageSchemaVersion
- Future-ready: orchestrationState reserved field

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: CLI handler + executive.ts routing

**Files:**
- Create: `src/cli/commands/executive-remediate-handler.ts`
- Modify: `src/cli/commands/executive.ts`

**Interfaces:**
- Consumes: `createDefaultRegistry()` (factory from `executive-remediate.js`), `ProposalStore`, `nextProposalId` from `recommendation-to-proposal.js`
- Produces: `handleRemediateCommand(args)` export

- [ ] **Step 1: Write the failing CLI integration test file**

Create `tests/cli/commands/executive-remediate-cli.vitest.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ProposalStore } from "../../../src/adaptation/proposal-store.js";
import { handleRemediateCommand } from "../../../src/cli/commands/executive-remediate-handler.js";
import type { AdaptationProposal } from "../../../src/adaptation/adaptation-types.js";
```

**Test groups (10+ tests):**

1. **Not found** — non-existent proposalId → error message
2. **Not remediable** — pending status → `NOT_APPROVED` error
3. **Non-executive** — non-executive proposal → `NOT_EXECUTIVE` error
4. **Missing --action (flag mode)** → `"--action is required"`
5. **Invalid --action** → `"Invalid action. Supported: ..."`
6. **Reserved payload key** → `"is a reserved lineage field"`
7. **Successful non-interactive** — creates child, prints ID, readiness is needs_approval
8. **--dry-run** — no file written to store, prints preview
9. **--json output** — valid JSON with childProposalId
10. **Empty --reason** (too short) → validation error

Fixture helper pattern (same as `executive-bridge-status.vitest.ts`):

```typescript
function makeProposal(overrides: Partial<AdaptationProposal> & { id: string }): AdaptationProposal {
  const base: AdaptationProposal = {
    id: "",
    createdAt: "2026-06-30T00:00:00.000Z",
    status: "approved",
    action: "create_improvement_issue",
    target: { kind: "executive_remediation", id: "rec-1" },
    payload: { source: "executive_bridge", requiresHumanSpecification: true },
    sourceRecommendationType: "executive_remediation",
    sourceConfidence: 0.8,
    evidenceFingerprints: ["fp-test"],
    reason: "test executive proposal",
  };
  return { ...base, ...overrides };
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cli/commands/executive-remediate-cli.vitest.ts --config vitest.config.mts
```
Expected: FAIL

- [ ] **Step 3: Implement `src/cli/commands/executive-remediate-handler.ts`**

Pattern following `executive-bridge-handler.ts`:

```typescript
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { ProposalStore } from "../../adaptation/proposal-store.js";
import { nextProposalId } from "../../adaptation/recommendation-to-proposal.js";
import {
  createDefaultRegistry,
  validateRemediationParent,
  validateSpecification,
  validatePayload,
} from "../../executive/executive-remediate.js";
import type { RemediationSpec } from "../../executive/executive-remediate.js";

export async function handleRemediateCommand(args: string[]): Promise<void> {
  const proposalId = args[0];
  if (!proposalId || proposalId.startsWith("--")) {
    console.error("Usage: alix executive remediate <proposalId> [--action ...]");
    process.exit(1);
  }

  const useJson = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  const isFlagMode = args.includes("--action") || args.includes("--target") || args.includes("--reason");

  // Load proposal
  const cwd = process.cwd();
  const proposalStore = new ProposalStore(join(cwd, ".alix", "adaptation", "proposals"));
  let parent;
  try {
    parent = await proposalStore.load(proposalId);
  } catch { /* not found */ }

  // Validate
  const validation = validateRemediationParent(parent);
  if (!validation.valid) { /* error + exit */ }

  // Find provider
  const reg = createDefaultRegistry();
  let provider;
  try { provider = reg.find(parent!); }
  catch (e: any) { /* error + exit */ }

  // Collect specification
  let spec: RemediationSpec;
  if (isFlagMode) {
    const actionName = /* parse --action */;
    const targetId = /* parse --target */;
    const reason = /* parse --reason */;
    let additionalPayload: Record<string, unknown> | undefined;
    if (/* --payload present */) {
      const payloadPath = /* parse */;
      if (!existsSync(payloadPath)) { /* error */ }
      additionalPayload = JSON.parse(readFileSync(payloadPath, "utf-8"));
    }
    spec = { actionName, targetId, reason, additionalPayload };

    // Validate spec
    const specErr = validateSpecification(spec, provider);
    if (specErr) { /* error + exit */ }

    // Validate payload reserved keys
    if (additionalPayload) {
      const payloadErr = validatePayload(additionalPayload);
      if (payloadErr) { /* error + exit */ }
    }
  } else {
    // Interactive: call provider.promptSpecification(parent)
    const result = await provider.promptSpecification!(parent!);
    if (!result) { console.log("Cancelled."); return; }
    spec = result;
  }

  // Build draft
  const draft = provider.buildDraft(parent!, spec, {
    actor: process.env.USER ?? "operator",
    mode: isFlagMode ? "noninteractive" : "interactive",
  });

  // Assign identity
  const child: AdaptationProposal = {
    ...draft,
    id: nextProposalId(),
    createdAt: new Date().toISOString(),
    status: "pending",
    evidenceFingerprints: [],
  } as AdaptationProposal;

  // Dry-run: print and exit
  if (dryRun) {
    console.log("Child proposal");
    console.log("───────────────────────────────────────");
    console.log(`  Action:        ${child.action}`);
    console.log(`  Target:        ${child.target.kind}:${child.target.id}`);
    console.log(`  Status:        ${child.status}`);
    console.log(`  Readiness:     needs_approval`);
    console.log("");
    console.log("Nothing written.");
    return;
  }

  // Save
  await proposalStore.save(child);

  // Print result
  if (useJson) {
    console.log(JSON.stringify({
      ok: true,
      parentProposalId: proposalId,
      childProposalId: child.id,
      childAction: child.action,
      childReadiness: "needs_approval",
    }));
  } else {
    console.log(`✓ Created child proposal ${child.id}`);
    console.log(`  alix adaptation show ${child.id}`);
    console.log(`  alix adaptation approve ${child.id}`);
    console.log(`  alix adaptation apply ${child.id}`);
  }
}
```

- [ ] **Step 4: Add `"remediate"` case to `executive.ts`**

Add dynamic import in `executive.ts` following the existing pattern:

```typescript
case "remediate": {
  const { handleRemediateCommand } = await import(
    "./executive-remediate-handler.js"
  );
  return handleRemediateCommand(rest);
}
```

Update the `default` error message to include `"remediate"`:

```typescript
console.error("Available: dashboard, plan, evaluate, outcomes, learn, recommend, bridge, recommendation-effectiveness, subsystem-correlation, remediate");
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/cli/commands/executive-remediate-cli.vitest.ts --config vitest.config.mts
```
Expected: All 10+ tests pass.

```bash
npx vitest run --config vitest.config.mts 2>&1 | tail -5
```
Expected: Full suite green.

```bash
npx tsc --noEmit 2>&1
```
Expected: Clean (no output).

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/executive-remediate-handler.ts tests/cli/commands/executive-remediate-cli.vitest.ts src/cli/commands/executive.ts
git commit -m "P10.9.2b-T2: CLI handler + routing for alix executive remediate

- handleRemediateCommand with interactive and non-interactive modes
- Parse flags: --action, --target, --reason, --payload, --dry-run, --json
- Spec validation + reserved key payload protection
- Dry-run parity: identical pipeline, skip save
- Dynamic import in executive.ts dispatcher
- 10+ CLI integration tests

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Sentinel + full suite verification

**Files:**
- Modify: `tests/executive/executive-sentinels.vitest.ts`

- [ ] **Step 1: Add new files to EXECUTIVE_FILES allowlist**

In `tests/executive/executive-sentinels.vitest.ts`, add two entries to the `EXECUTIVE_FILES` array (around the P10.7c entries):

```typescript
  // P10.9.2b files
  "src/executive/executive-remediate.ts",
  "src/cli/commands/executive-remediate-handler.ts",
```

- [ ] **Step 2: Run sentinel tests**

```bash
npx vitest run tests/executive/executive-sentinels.vitest.ts --config vitest.config.mts
```
Expected: All sentinel tests pass.

- [ ] **Step 3: Run full suite**

```bash
npm run test:vitest
```
Expected: All tests green.

```bash
npx tsc --noEmit
```
Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add tests/executive/executive-sentinels.vitest.ts
git commit -m "P10.9.2b-T3: add executive-remediate files to purity sentinel

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Final verification + PR

- [ ] **Step 1: Run gitnexus detect_changes to verify blast radius**

```bash
npx gitnexus detect_changes
```
Expected: LOW risk, only expected files affected.

- [ ] **Step 2: Run full verification**

```bash
npm run test:vitest
npx tsc --noEmit
```

- [ ] **Step 3: Push branch and create PR**

```bash
git push -u origin feature/p10-9-2b-remediation-wizard
gh pr create --title "P10.9.2b — Remediation Wizard (Tasks 1-3: provider framework + CLI handler + sentinel)" --body "..." --base main
```
