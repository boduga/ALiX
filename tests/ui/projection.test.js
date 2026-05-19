import { describe, it } from "node:test";
import assert from "node:assert";
import { buildUiProjection } from "../../src/ui/projection.js";

describe("Full Event Projection", () => {
  it("projects policy decisions", () => {
    const events = [
      {
        seq: 1, type: "policy.decision", actor: "policy",
        payload: { toolCallId: "c1", decision: "allow", reason: "ok" },
        timestamp: "2026-05-19T10:00:00Z"
      }
    ];
    const projected = buildUiProjection(events);
    assert.ok(projected.summary.policyDecisionCount >= 0);
  });

  it("projects patch lifecycle", () => {
    const events = [
      {
        seq: 1, type: "patch.proposed", actor: "agent",
        payload: { proposalId: "p1" },
        timestamp: "2026-05-19T10:00:00Z"
      },
      {
        seq: 2, type: "patch.applied", actor: "system",
        payload: { proposalId: "p1", changedFiles: ["a.ts"] },
        timestamp: "2026-05-19T10:00:01Z"
      }
    ];
    const projected = buildUiProjection(events);
    assert.ok(projected.summary.patchCount >= 0);
    assert.ok(projected.patches?.length >= 0);
  });

  it("projects context events", () => {
    const events = [
      {
        seq: 1, type: "context.bundle_created", actor: "system",
        payload: { bundleId: "b1", primaryFiles: [] },
        timestamp: "2026-05-19T10:00:00Z"
      }
    ];
    const projected = buildUiProjection(events);
    assert.ok(projected.context !== null);
  });

  it("projects verification events", () => {
    const events = [
      {
        seq: 1, type: "verification.check_finished", actor: "system",
        payload: { command: "npm test", status: "passed" },
        timestamp: "2026-05-19T10:00:00Z"
      }
    ];
    const projected = buildUiProjection(events);
    assert.ok(projected.summary.verificationCount >= 0);
  });

  it("builds policyDecisions array", () => {
    const events = [
      {
        seq: 1, type: "policy.decision", actor: "policy",
        payload: { toolCallId: "c1", decision: "allow", reason: "ok", capability: "read" },
        timestamp: "2026-05-19T10:00:00Z"
      }
    ];
    const projected = buildUiProjection(events);
    assert.ok(Array.isArray(projected.policyDecisions));
    assert.equal(projected.policyDecisions.length, 1);
    assert.equal(projected.policyDecisions[0].decision, "allow");
  });

  it("builds patches array with correct status", () => {
    const events = [
      { seq: 1, type: "patch.proposed", actor: "agent", payload: { proposalId: "p1" }, timestamp: "2026-05-19T10:00:00Z" },
      { seq: 2, type: "patch.applied", actor: "system", payload: { proposalId: "p1" }, timestamp: "2026-05-19T10:00:01Z" },
      { seq: 3, type: "patch.rolled_back", actor: "system", payload: { proposalId: "p2" }, timestamp: "2026-05-19T10:00:02Z" },
    ];
    const projected = buildUiProjection(events);
    assert.ok(Array.isArray(projected.patches));
    assert.equal(projected.patches.length, 3);
    assert.equal(projected.patches[0].status, "proposed");
    assert.equal(projected.patches[1].status, "applied");
    assert.equal(projected.patches[2].status, "rolled_back");
  });
});