// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityRegistry } from "../../../../src/capability/registry.js";
import { JsonlCapabilityLifecycleLedger } from "../../../../src/evolution/capability-lifecycle/capability-lifecycle-ledger.js";
import { analyzeCapabilityLifecycle } from "../../../../src/evolution/capability-lifecycle/capability-lifecycle-analyzer.js";
import { buildCapabilityProposals } from "../../../../src/evolution/capability-lifecycle/capability-proposal-builder.js";
import { runCapabilityGovernance, toLedgerRecord } from "../../../../src/evolution/capability-lifecycle/capability-governance-bridge.js";
import { CapabilityLifecycleApplier } from "../../../../src/evolution/capability-lifecycle/capability-lifecycle-applier.js";
import { CapabilityLifecycleMeasurer } from "../../../../src/evolution/capability-lifecycle/capability-lifecycle-measurer.js";
import { rehydrateLifecycleOverlay } from "../../../../src/evolution/capability-lifecycle/capability-lifecycle-rehydration.js";
import { deriveCapabilityProjectionState } from "../../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";
import { CapabilityEvolutionStore } from "../../../../src/adaptation/capability-evolution-store.js";
import { canonicalStringify } from "../../../../src/security/audit/canonical-json.js";
import type { CapabilitySignalInputs } from "../../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";
import type { CapabilityHealth } from "../../../../src/adaptation/capability-evolution-types.js";
import type { Capability } from "../../../../src/capability/types.js";

function makeCapability(id: string): Capability {
  return { id, version: "1.0.0", kind: "core", title: id, description: id, tags: [], category: "core",
    risk: "low", requiredPermissions: ["operator"], execution: { strategy: "native" } };
}
function stagnantHealth(capability: string): CapabilityHealth {
  return { capability, agentCount: 0, resolutionCount: 2, resolutionCountRecent: 0, resolutionCountPrior: 1,
    proposalCountRecent: 0, proposalCountPrior: 2, demandScore: 0.1, keepRate: 0.2, revertRate: 0.4,
    proposalCount: 2, lifecycleState: "stagnant", rationale: "no recent use" };
}

let dir: string;
let ledger: JsonlCapabilityLifecycleLedger;
let registry: CapabilityRegistry;
let store: CapabilityEvolutionStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "a7-1-int-"));
  ledger = new JsonlCapabilityLifecycleLedger(join(dir, "lifecycle.jsonl"));
  store = new CapabilityEvolutionStore(join(dir, "evolution"));
  registry = new CapabilityRegistry();
  registry.register(makeCapability("core.session.list"));
  registry.register(makeCapability("core.old"));
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("A7.1 end-to-end capability application", () => {
  it("full deprecate: analyze → govern → decide → apply → measure walks every projection", async () => {
    const inputs: CapabilitySignalInputs = { health: [stagnantHealth("core.old")], gaps: [], overlap: [], drift: [],
      adoption: {}, outcome: [], patterns: [] };
    const candidates = analyzeCapabilityLifecycle(inputs);
    assert.equal(candidates.length, 1);
    // Attach the pre-application baseline evidence (P5.5 report) to the candidate so
    // the decided/applied records carry it — the measurer's baselineEvidenceRefs
    // must reference it (spec §9).
    candidates[0].evidenceRefs.push("a7-p55-report");
    const [artifacts] = buildCapabilityProposals(candidates, [{ evidenceId: "a7-p55-report", source: "p55" }]);
    const outcome = runCapabilityGovernance(artifacts.candidate, artifacts.proposal.proposalId);
    assert.equal(outcome.decision.kind, "APPROVE");
    await ledger.append(toLedgerRecord("intent", artifacts.candidate));
    await ledger.append(toLedgerRecord("proposed", artifacts.candidate, { proposalId: artifacts.proposal.proposalId }));
    await ledger.append(toLedgerRecord("decided", artifacts.candidate, { proposalId: artifacts.proposal.proposalId, outcome }));

    // Decided → APPROVED_PENDING_APPLICATION
    assert.equal(deriveCapabilityProjectionState(await ledger.listLatestForCapability("core.old")), "APPROVED_PENDING_APPLICATION");

    const applier = new CapabilityLifecycleApplier({ ledger, registry });
    const applied = await applier.apply("core.old");
    assert.equal(applied.status, "applied");
    assert.equal(deriveCapabilityProjectionState(await ledger.listLatestForCapability("core.old")), "APPLIED");
    assert.equal(registry.getLifecycleState("core.old"), "deprecated");

    // Post-apply P5.5 health reflects the new state
    await store.save({ generatedAt: new Date().toISOString(), totalCapabilities: 2,
      healthAnalysis: [{ ...stagnantHealth("core.old"), lifecycleState: "deprecated" },
        { ...stagnantHealth("core.session.list"), lifecycleState: "active" }],
      gapAnalysis: [], overlapAnalysis: [], driftAnalysis: [],
      lifecycleDistribution: { emerging: 0, active: 0, mature: 0, stagnant: 0, declining: 0, deprecated: 1 },
      executiveSummary: "s" });

    const measurer = new CapabilityLifecycleMeasurer({ ledger, store });
    const measured = await measurer.measure("core.old");
    assert.equal(measured.status, "measured");
    assert.equal(deriveCapabilityProjectionState(await ledger.listLatestForCapability("core.old")), "MEASURED");
    const latest = await ledger.listLatestForCapability("core.old");
    assert.ok(latest?.baselineEvidenceRefs?.length);
    assert.ok(latest?.postObservationRefs?.length);

    // Final record chain
    const chain = (await ledger.listByCapability("core.old")).map((r) => r.eventType);
    assert.deepEqual(chain, ["intent", "proposed", "decided", "applied", "measured"]);
  });

  it("atomicity: ledger append failure after runtime completed → registry byte-identical", async () => {
    const inputs: CapabilitySignalInputs = { health: [stagnantHealth("core.old")], gaps: [], overlap: [], drift: [],
      adoption: {}, outcome: [], patterns: [] };
    const candidates = analyzeCapabilityLifecycle(inputs);
    const [artifacts] = buildCapabilityProposals(candidates, [{ evidenceId: "a7-p55-report", source: "p55" }]);
    const outcome = runCapabilityGovernance(artifacts.candidate, artifacts.proposal.proposalId);
    await ledger.append(toLedgerRecord("intent", artifacts.candidate));
    await ledger.append(toLedgerRecord("proposed", artifacts.candidate, { proposalId: artifacts.proposal.proposalId }));
    await ledger.append(toLedgerRecord("decided", artifacts.candidate, { proposalId: artifacts.proposal.proposalId, outcome }));

    registry.applyLifecycleTransition("core.old", "declining"); // pre-state
    // Byte-identity must cover the overlay too — apply mutates ONLY the overlay,
    // so a definitions-only stringify would pass trivially even if rollback failed.
    const before = canonicalStringify({ definitions: registry.list(), overlay: registry.listLifecycleStates() });
    // NOTE: `{ ...ledger }` would drop the class's prototype methods, so the
    // failing ledger is built via Object.create to keep read methods while
    // overriding only append (same pattern as Task 6's atomicity test).
    const failingLedger = Object.create(ledger) as JsonlCapabilityLifecycleLedger;
    failingLedger.append = async () => { throw new Error("disk full"); };
    const applier = new CapabilityLifecycleApplier({ ledger: failingLedger, registry });
    // The shipped applier THROWS on append failure after the compensating
    // rollback (spec §11 exit 1) — it does NOT return a blocked result.
    await assert.rejects(() => applier.apply("core.old"), /Ledger append failed/);
    assert.equal(canonicalStringify({ definitions: registry.list(), overlay: registry.listLifecycleStates() }), before); // byte-identical incl. overlay
    assert.equal(registry.getLifecycleState("core.old"), "declining"); // restored, not deprecated
  });

  it("rehydration: overlay rebuilt from the ledger after a simulated restart", async () => {
    // Seed a decided → applied via a first applier, then build a FRESH registry (restart)
    const inputs: CapabilitySignalInputs = { health: [stagnantHealth("core.old")], gaps: [], overlap: [], drift: [],
      adoption: {}, outcome: [], patterns: [] };
    const candidates = analyzeCapabilityLifecycle(inputs);
    const [artifacts] = buildCapabilityProposals(candidates, [{ evidenceId: "a7-p55-report", source: "p55" }]);
    const outcome = runCapabilityGovernance(artifacts.candidate, artifacts.proposal.proposalId);
    await ledger.append(toLedgerRecord("intent", artifacts.candidate));
    await ledger.append(toLedgerRecord("proposed", artifacts.candidate, { proposalId: artifacts.proposal.proposalId }));
    await ledger.append(toLedgerRecord("decided", artifacts.candidate, { proposalId: artifacts.proposal.proposalId, outcome }));
    await new CapabilityLifecycleApplier({ ledger, registry }).apply("core.old");

    const restarted = new CapabilityRegistry();
    restarted.register(makeCapability("core.session.list"));
    restarted.register(makeCapability("core.old"));
    // Production rehydration: rebuild the overlay from persisted applied records (spec §8).
    const replayed = await rehydrateLifecycleOverlay(restarted, ledger);
    assert.equal(replayed, 1);
    assert.equal(restarted.getLifecycleState("core.old"), "deprecated");
  });

  it("register is approved-but-not-executable: blocked, no mutation, stays APPROVED_PENDING_APPLICATION", async () => {
    const c = { intent: "register" as const, target: { capabilityId: "core.new" }, confidence: 0.9,
      rationale: ["gap"], evidenceRefs: [], observedLifecycleState: null, proposedLifecycleState: "emerging" as const };
    const outcome = runCapabilityGovernance(c, "prop-a7-reg");
    await ledger.append(toLedgerRecord("decided", c, { proposalId: "prop-a7-reg", outcome }));
    const applier = new CapabilityLifecycleApplier({ ledger, registry });
    const res = await applier.apply("core.new");
    assert.equal(res.status, "blocked");
    assert.match(res.reason, /not executable in A7\.1/);
    assert.equal(registry.getLifecycleState("core.new"), undefined);
    assert.equal(deriveCapabilityProjectionState(await ledger.listLatestForCapability("core.new")), "APPROVED_PENDING_APPLICATION");
  });
});
