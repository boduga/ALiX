// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toExecutionProposal } from "../../../src/evolution/capability-lifecycle/capability-execution-projection.js";
import type { CapabilityLifecycleRecord } from "../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";

function decidedRecord(over: Partial<CapabilityLifecycleRecord>): CapabilityLifecycleRecord {
  return {
    recordId: "clr-test", target: { capabilityId: "core.old" }, intent: "deprecate",
    eventType: "decided", timestamp: "2026-08-10T00:00:00.000Z",
    proposalId: "prop-a7-abc", decisionId: "govd-abc", decisionKind: "APPROVE",
    evidenceRefs: [], observedLifecycleState: "declining", proposedLifecycleState: "deprecated",
    ...over,
  };
}

describe("toExecutionProposal", () => {
  it("promote → single capability.transition step", () => {
    const r = decidedRecord({ intent: "promote", proposedLifecycleState: "active" });
    const p = toExecutionProposal(r);
    assert.equal(p.proposalId, r.proposalId);
    assert.equal(p.evolutionId, r.proposalId);
    assert.equal(p.change, "promote: core.old → active");
    assert.equal(p.beforeHash, null);
    assert.equal(p.afterHash, null);
    assert.equal(p.changes.length, 1);
    assert.equal(p.changes[0].operation, "capability.transition");
    assert.deepEqual(p.changes[0].parameters, { capabilityId: "core.old", to: "active" });
    assert.equal(p.changes[0].idempotent, true);
  });

  it("deprecate → single step to deprecated", () => {
    const p = toExecutionProposal(decidedRecord({}));
    assert.equal(p.changes.length, 1);
    assert.deepEqual(p.changes[0].parameters, { capabilityId: "core.old", to: "deprecated" });
  });

  it("consolidate → deprecate each related capability, preserve primary", () => {
    const r = decidedRecord({
      intent: "consolidate",
      target: { capabilityId: "core.session", relatedCapabilityIds: ["core.session.a", "core.session.b"] },
    });
    const p = toExecutionProposal(r);
    assert.deepEqual(p.changes.map((c) => c.parameters), [
      { capabilityId: "core.session.a", to: "deprecated" },
      { capabilityId: "core.session.b", to: "deprecated" },
    ]);
  });

  it("register → throws not-executable", () => {
    const r = decidedRecord({ intent: "register", target: { capabilityId: "core.new" }, proposedLifecycleState: "emerging" });
    assert.throws(() => toExecutionProposal(r), /not executable in A7\.1/);
  });

  it("modify → throws not-executable", () => {
    const r = decidedRecord({ intent: "modify", proposedLifecycleState: "mature" });
    assert.throws(() => toExecutionProposal(r), /not executable in A7\.1/);
  });
});
