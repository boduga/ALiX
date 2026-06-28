# M0.51 IFÁ-MAS Passive Diagnostic Pipeline Implementation Plan

**Status:** ✅ Completed (M0.51)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a thin passive orchestrator that chains all 8 IFÁ-MAS modules (M0.43–M0.50) into a single end-to-end diagnostic pipeline, proving they compose without touching tool execution, PolicyGate, or runtime routing.

**Architecture:** A single async function that takes a `SignalFrame`, runs it through `prescribeOffering` → `buildBridgeEnvelope` → `BridgeGateway.validateEnvelope` → `routeViaNexus` → `GuildSelector.select`, and returns a structured diagnostic with every artifact. No new logic — only existing module chaining.

**Tech Stack:** TypeScript, `node:test`, no new dependencies.

---

## File Structure

### Create
- `src/runtime/ifamas-pipeline.ts` — `IfamasDiagnostic` type + `runIfamasDiagnostic()` function
- `tests/runtime/ifamas-pipeline.test.ts` — 10 tests covering all pipeline paths

---

### Task 1: Implement `src/runtime/ifamas-pipeline.ts`

**Files:**
- Create: `src/runtime/ifamas-pipeline.ts`

- [ ] **Step 1: Write the module with imports and types**

```typescript
import { prescribeOffering, type OfferingPlan } from "./offering-planner.js";
import { buildBridgeEnvelope, type BridgeEnvelope } from "./bridge-envelope.js";
import { BridgeGateway, type BridgeValidationResult } from "./bridge-gateway.js";
import { routeViaNexus, type NexusRouteDecision } from "./nexus-router.js";
import { GuildSelector, type GuildCandidate } from "../agents/guild-selector.js";
import type { SignalFrame } from "./signal-frame.js";
import type { EssenceProfile } from "../agents/essence-profile.js";
import type { ChronicleStore } from "../chronicle/chronicle-store.js";

export type IfamasDiagnostic = {
  signal: SignalFrame;
  offering: OfferingPlan;
  envelope: BridgeEnvelope;
  routeDecision: NexusRouteDecision;
  gatewayValidation: BridgeValidationResult;
  guildCandidates: GuildCandidate[];
};

export async function runIfamasDiagnostic(input: {
  task?: string;
  signal: SignalFrame;
  candidates?: EssenceProfile[];
  chronicleStore?: ChronicleStore;
}): Promise<IfamasDiagnostic> {
  // Step 1: Receive signal as-is (no modification)
  // Step 2: Prescribe offering
  const offering = prescribeOffering(input.signal);

  // Step 3: Build envelope
  const envelope = buildBridgeEnvelope({
    signal: input.signal,
    offering,
  });

  // Step 4: Validate through BridgeGateway
  const gateway = new BridgeGateway();
  const gatewayValidation = gateway.validateEnvelope(envelope);

  // Step 5: Route through NexusRouter (with optional chronicle store)
  const routeDecision = await routeViaNexus({
    envelope,
    chronicleStore: input.chronicleStore,
  });

  // Step 6: Select guild candidates (only if candidates provided)
  const guildCandidates: GuildCandidate[] = input.candidates && input.candidates.length > 0
    ? new GuildSelector().select({ envelope, candidates: input.candidates })
    : [];

  return {
    signal: input.signal,
    offering,
    envelope,
    routeDecision,
    gatewayValidation,
    guildCandidates,
  };
}
```

Verify: `npx tsc --noEmit`

- [ ] **Step 2: Verify no forbidden imports**

Run: `grep -n 'ToolExecutor\|PolicyGate\|ApprovalStore' src/runtime/ifamas-pipeline.ts`
Expected: no output (none of those strings should appear in the file)

---

### Task 2: Write the test file

**Files:**
- Create: `tests/runtime/ifamas-pipeline.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runIfamasDiagnostic } from "../../src/runtime/ifamas-pipeline.js";
import { createSignalFrame } from "../../src/runtime/signal-frame.js";
import type { SignalBits, SignalDomain } from "../../src/runtime/signal-frame.js";
import type { EssenceProfile } from "../../src/agents/essence-profile.js";
import type { EssenceAffinity } from "../../src/agents/essence-profile.js";

function makeSafeSignal() {
  const bits: SignalBits = {
    intentClear: true,
    policyRisk: false,
    toolRequired: false,
    memoryRequired: false,
    freshnessRequired: false,
    mutationPossible: false,
    approvalRequired: false,
    replayRollbackContext: false,
  };
  return createSignalFrame({ bits, domain: "task", intent: "diagnostic test" });
}

function makeCompatibleProfile(): EssenceProfile {
  return {
    agentId: "guild-agent-1",
    role: "guild",
    domains: ["task"],
    capabilities: ["execute", "inspect"],
    constraints: [],
    taboos: [],
    affinity: "general" as EssenceAffinity,
    riskTolerance: "medium" as "low" | "medium" | "high",
  };
}

describe("runIfamasDiagnostic", () => {

  it("returns all diagnostic artifacts", async () => {
    const signal = makeSafeSignal();
    const result = await runIfamasDiagnostic({ signal });

    assert.ok(result.signal);
    assert.ok(result.offering);
    assert.ok(result.envelope);
    assert.ok(result.routeDecision);
    assert.ok(result.gatewayValidation);
    assert.ok(result.guildCandidates);

    // Verify all 6 artifact keys exist
    const keys = Object.keys(result) as (keyof typeof result)[];
    const expected = ["signal", "offering", "envelope", "routeDecision", "gatewayValidation", "guildCandidates"];
    for (const k of expected) {
      assert.ok(keys.includes(k as any), `missing key: ${k}`);
    }
  });

  it("preserves the original signal", async () => {
    const signal = makeSafeSignal();
    const result = await runIfamasDiagnostic({ signal });
    assert.equal(result.signal.signalId, signal.signalId);
  });

  it("produces OfferingPlan from signal", async () => {
    const signal = makeSafeSignal();
    const result = await runIfamasDiagnostic({ signal });
    assert.ok(result.offering);
    assert.equal(typeof result.offering.action, "string");
    assert.ok(result.offering.action.length > 0);
    assert.ok(result.offering.offeringId);
  });

  it("builds BridgeEnvelope", async () => {
    const signal = makeSafeSignal();
    const result = await runIfamasDiagnostic({ signal });
    assert.ok(result.envelope.envelopeId);
    assert.ok(result.envelope.safety);
    assert.equal(typeof result.envelope.safety.requiresPolicyGate, "boolean");
    assert.equal(typeof result.envelope.safety.requiresApproval, "boolean");
    assert.equal(typeof result.envelope.safety.mutationPossible, "boolean");
    assert.ok(Array.isArray(result.envelope.safety.taboos));
  });

  it("validates through BridgeGateway", async () => {
    const signal = makeSafeSignal();
    const result = await runIfamasDiagnostic({ signal });
    assert.equal(result.gatewayValidation.valid, true);
    assert.deepEqual(result.gatewayValidation.errors, []);
  });

  it("routes through NexusRouter", async () => {
    const signal = makeSafeSignal();
    const result = await runIfamasDiagnostic({ signal });
    assert.ok(result.routeDecision.routeHint);
    assert.ok(result.routeDecision.routeHint.targetRole);
    assert.ok(result.routeDecision.routeHint.confidence >= 0);
    assert.equal(typeof result.routeDecision.routeHint.reason, "string");
  });

  it("skips guild selection when no candidates are provided", async () => {
    const signal = makeSafeSignal();
    const result = await runIfamasDiagnostic({ signal });
    assert.ok(Array.isArray(result.guildCandidates));
    assert.equal(result.guildCandidates.length, 0);
  });

  it("returns candidates when compatible candidates are provided", async () => {
    const signal = makeSafeSignal();
    const profile = makeCompatibleProfile();
    const result = await runIfamasDiagnostic({
      signal,
      candidates: [profile],
    });
    assert.ok(result.guildCandidates.length > 0);
    assert.equal(result.guildCandidates[0].profile.agentId, "guild-agent-1");
  });

  it("works without ChronicleStore", async () => {
    const signal = makeSafeSignal();
    // Should not throw
    const result = await runIfamasDiagnostic({ signal });
    assert.ok(result.routeDecision);
    assert.ok(Array.isArray(result.routeDecision.chronicleEntries));
  });

  it("does NOT import ToolExecutor or PolicyGate", async () => {
    // Read the source file and verify no forbidden identifiers
    const fs = await import("node:fs");
    const source = fs.readFileSync("src/runtime/ifamas-pipeline.ts", "utf-8");
    assert.ok(!source.includes("ToolExecutor"), "ToolExecutor must not appear in source");
    assert.ok(!source.includes("PolicyGate"), "PolicyGate must not appear in source");
    assert.ok(!source.includes("ApprovalStore"), "ApprovalStore must not appear in source");
  });

});
```

- [ ] **Step 2: Run the test file directly from source**

Run: `npx tsx --test tests/runtime/ifamas-pipeline.test.ts`
Expected: 10 tests pass

Note: If `npx tsx` is not available, build first and run from dist:
```bash
npm run build && node --test dist/tests/runtime/ifamas-pipeline.test.js
```

---

### Task 3: Build, full suite, and commit

- [ ] **Step 1: Build and run full test suite**

```bash
npm run build
node --test dist/tests/runtime/ifamas-pipeline.test.js
```

Expected: clean compile, 10/10 tests pass

- [ ] **Step 2: Verify no forbidden imports one more time**

```bash
grep -E 'ToolExecutor|PolicyGate|ApprovalStore' src/runtime/ifamas-pipeline.ts || echo "CLEAN"
```

Expected: `CLEAN`

- [ ] **Step 3: Run full runtime + agents + chronicle suite**

```bash
node --test dist/tests/runtime/*.test.js dist/tests/agents/*.test.js dist/tests/chronicle/*.test.js
```

Expected: all tests pass (no regressions)

- [ ] **Step 4: Commit**

```bash
git add src/runtime/ifamas-pipeline.ts tests/runtime/ifamas-pipeline.test.ts
git commit -m "feat(runtime): add IFÁ-MAS passive diagnostic pipeline"
```

- [ ] **Step 5: Push branch**

```bash
git push -u origin feat/m51-ifamas-pipeline
```

---

## Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/runtime/ifamas-pipeline.test.js` — 10/10 pass
3. `grep -E 'ToolExecutor|PolicyGate|ApprovalStore' src/runtime/ifamas-pipeline.ts` — no output
4. Full runtime suite — no regressions
5. Git diff shows only the 2 intended files
