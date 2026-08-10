// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityRegistry } from "../../../../src/capability/registry.js";
import type { Capability } from "../../../../src/capability/types.js";
import { JsonlCapabilityLifecycleLedger } from "../../../../src/evolution/capability-lifecycle/capability-lifecycle-ledger.js";
import { analyzeCapabilityLifecycle } from "../../../../src/evolution/capability-lifecycle/capability-lifecycle-analyzer.js";
import { buildCapabilityProposals } from "../../../../src/evolution/capability-lifecycle/capability-proposal-builder.js";
import { runCapabilityGovernance, toLedgerRecord } from "../../../../src/evolution/capability-lifecycle/capability-governance-bridge.js";
import { deriveCapabilityProjectionState } from "../../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";
import type { CapabilitySignalInputs } from "../../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";
import type { CapabilityHealth } from "../../../../src/adaptation/capability-evolution-types.js";

function makeCapability(id: string): Capability {
  return {
    id, version: "1.0.0", kind: "core", title: id, description: id,
    tags: [], category: "core", risk: "low", requiredPermissions: ["operator"],
    execution: { strategy: "native" },
  };
}

function stagnantHealth(capability: string): CapabilityHealth {
  return {
    capability, agentCount: 0, resolutionCount: 2, resolutionCountRecent: 0,
    resolutionCountPrior: 1, proposalCountRecent: 0, proposalCountPrior: 2,
    demandScore: 0.1, keepRate: 0.2, revertRate: 0.4, proposalCount: 2,
    lifecycleState: "stagnant", rationale: "no recent use",
  };
}

let dir: string;
let ledger: JsonlCapabilityLifecycleLedger;
let registry: CapabilityRegistry;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "a7-int-"));
  ledger = new JsonlCapabilityLifecycleLedger(join(dir, "lifecycle.jsonl"));
  registry = new CapabilityRegistry();
  registry.register(makeCapability("core.session.list"));
  registry.register(makeCapability("core.old"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("A7 end-to-end lifecycle governance", () => {
  it("governs a deprecate proposal end-to-end WITHOUT mutating the registry", async () => {
    const registrySnapshotBefore = JSON.stringify(registry.list());

    const inputs: CapabilitySignalInputs = {
      health: [stagnantHealth("core.old")],
      gaps: [], overlap: [], drift: [],
      adoption: {}, outcome: [], patterns: [],
    };

    // Analyze → candidates
    const candidates = analyzeCapabilityLifecycle(inputs);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].intent, "deprecate");
    assert.equal(candidates[0].target.capabilityId, "core.old");

    // Build A0 artifacts
    const [artifacts] = buildCapabilityProposals(candidates, [{ evidenceId: "a7-p55-report", source: "p55" }]);
    assert.equal(artifacts.intent.target.kind, "capability");
    assert.equal(artifacts.proposal.change, "deprecate: core.old → deprecated");

    // Governance
    const outcome = runCapabilityGovernance(artifacts.candidate, artifacts.proposal.proposalId);
    assert.equal(outcome.decision.kind, "APPROVE");
    assert.equal(outcome.decision.proposalId, artifacts.proposal.proposalId);

    // Record intent → proposed → decided
    await ledger.append(toLedgerRecord("intent", artifacts.candidate));
    await ledger.append(toLedgerRecord("proposed", artifacts.candidate, { proposalId: artifacts.proposal.proposalId }));
    await ledger.append(toLedgerRecord("decided", artifacts.candidate, { proposalId: artifacts.proposal.proposalId, outcome }));

    const records = await ledger.list();
    assert.equal(records.length, 3);
    assert.deepEqual(records.map((r) => r.eventType), ["intent", "proposed", "decided"]);

    // Invariant: approval never mutates the registry.
    assert.equal(JSON.stringify(registry.list()), registrySnapshotBefore);

    // Invariant: no applied/measured events and no execution/measurement ids.
    // (Cast through string: the A7.0 eventType union excludes applied/measured by
    //  construction, so a direct comparison is a TS2367 "no overlap" error; the
    //  guard still fires at runtime if A7.1 widens the type.)
    for (const r of records) {
      const eventType = r.eventType as string;
      assert.ok(!("executionId" in r));
      assert.ok(!("measurementId" in r));
      assert.ok(eventType !== "applied" && eventType !== "measured");
    }

    // Invariant: APPROVE_PENDING_APPLICATION is a projection, never in the record.
    const latest = await ledger.listLatestForCapability("core.old");
    assert.equal(latest?.decisionKind, "APPROVE");
    assert.equal(latest?.observedLifecycleState, "stagnant"); // registry-reported observation
    assert.equal(latest?.proposedLifecycleState, "deprecated"); // requested, not applied
    assert.equal(deriveCapabilityProjectionState(latest), "APPROVED_PENDING_APPLICATION");
  });

  it("zero candidates → no proposal, no A3 call, no ledger write", async () => {
    const empty: CapabilitySignalInputs = { health: [], gaps: [], overlap: [], drift: [], adoption: {}, outcome: [], patterns: [] };
    const candidates = analyzeCapabilityLifecycle(empty);
    assert.deepEqual(candidates, []);
    assert.deepEqual(buildCapabilityProposals(candidates), []);
    assert.equal((await ledger.list()).length, 0);
  });

  it("a rejected proposal still does not mutate the registry and projects REJECTED", async () => {
    const snapshot = JSON.stringify(registry.list());
    const inputs: CapabilitySignalInputs = {
      health: [stagnantHealth("core.old")],
      gaps: [], overlap: [], drift: [],
      adoption: {}, outcome: [], patterns: [],
    };
    const candidates = analyzeCapabilityLifecycle(inputs);
    const [artifacts] = buildCapabilityProposals(candidates, [{ evidenceId: "a7-p55-report", source: "p55" }]);
    // Force a reject via a low-confidence candidate.
    const lowConfidence = { ...artifacts.candidate, confidence: 0.2 };
    const outcome = runCapabilityGovernance(lowConfidence, artifacts.proposal.proposalId);
    assert.equal(outcome.decision.kind, "REJECT");
    await ledger.append(toLedgerRecord("decided", lowConfidence, { proposalId: artifacts.proposal.proposalId, outcome }));
    assert.equal(JSON.stringify(registry.list()), snapshot);
    const latest = await ledger.listLatestForCapability("core.old");
    assert.equal(deriveCapabilityProjectionState(latest), "REJECTED");
  });
});
