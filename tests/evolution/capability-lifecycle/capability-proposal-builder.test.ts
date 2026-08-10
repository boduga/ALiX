// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCapabilityProposals } from "../../../src/evolution/capability-lifecycle/capability-proposal-builder.js";
import { validateEvolutionIntent, validateEvolutionProposal } from "../../../src/evolution/contracts/evolution-contract.js";
import type { CapabilityLifecycleCandidate } from "../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";

function makeCandidate(overrides: Partial<CapabilityLifecycleCandidate> = {}): CapabilityLifecycleCandidate {
  return {
    intent: "deprecate",
    target: { capabilityId: "core.old" },
    confidence: 0.8,
    rationale: ["no recent use"],
    evidenceRefs: ["ev-1"],
    observedLifecycleState: "stagnant",
    proposedLifecycleState: "deprecated",
    ...overrides,
  };
}

describe("buildCapabilityProposals", () => {
  it("produces one EvolutionIntent + EvolutionProposal per candidate", () => {
    const artifacts = buildCapabilityProposals([makeCandidate()]);
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].intent.target.kind, "capability");
    assert.equal(artifacts[0].intent.target.id, "core.old");
    assert.equal(artifacts[0].proposal.evolutionId, artifacts[0].intent.evolutionId);
  });

  it("intents validate against the A0 validator (target kind capability)", () => {
    const [a] = buildCapabilityProposals([makeCandidate()]);
    assert.deepEqual(validateEvolutionIntent(a.intent), { valid: true, errors: [] });
  });

  it("proposals validate against the A0 validator", () => {
    const [a] = buildCapabilityProposals([makeCandidate()]);
    assert.deepEqual(validateEvolutionProposal(a.proposal), { valid: true, errors: [] });
  });

  it("is deterministic: identical ids for identical inputs, across calls", () => {
    const [a] = buildCapabilityProposals([makeCandidate()]);
    const [b] = buildCapabilityProposals([makeCandidate()]);
    assert.equal(a.intent.evolutionId, b.intent.evolutionId);
    assert.equal(a.proposal.proposalId, b.proposal.proposalId);
    assert.equal(a.intent.target.id, "core.old");
  });

  it("returns an empty array for zero candidates (zero-candidate invariant)", () => {
    assert.deepEqual(buildCapabilityProposals([]), []);
  });

  it("prepends the signal evidence reference so rationale is non-empty", () => {
    const [a] = buildCapabilityProposals(
      [makeCandidate({ evidenceRefs: [] })],
      [{ evidenceId: "a7-p55-report", source: "p55" }],
    );
    assert.equal(a.intent.rationale.length, 1);
    assert.equal(a.intent.rationale[0].evidenceId, "a7-p55-report");
  });

  it("sets a low risk class for A7.0 proposals (which mutate nothing)", () => {
    const [a] = buildCapabilityProposals([makeCandidate()]);
    assert.equal(a.intent.riskClass, "low");
  });
});
