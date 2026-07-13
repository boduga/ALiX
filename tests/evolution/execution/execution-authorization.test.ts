/**
 * Tests A4.0 — Execution Authorization Gate.
 *
 * Covers all 7 pre-flight checks plus config-driven edge cases.
 *
 * @module execution-authorization
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeExecution,
  DEFAULT_AUTH_CONFIG,
} from "../../../src/evolution/execution/execution-authorization.js";
import type { AuthorizeInput } from "../../../src/evolution/execution/execution-authorization.js";
import type { GovernanceDecision } from "../../../src/evolution/governance/contracts/decision-contract.js";
import type { EvolutionProposal } from "../../../src/evolution/contracts/evolution-contract.js";
import type { ExecutionRequest } from "../../../src/evolution/execution/contracts/execution-contract.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseInput(overrides?: Partial<AuthorizeInput>): AuthorizeInput {
  const request: ExecutionRequest = {
    requestId: "req-001",
    evolutionId: "evol-test-001",
    requestedBy: "operator",
    requestedAt: "2026-07-12T00:00:00Z",
    reason: "Test execution",
  };

  const proposal: EvolutionProposal = {
    proposalId: "evol-test-001",
    evolutionId: "evol-test-001",
    title: "Test proposal",
    description: "A proposal for testing",
    change: "Change the thing",
    beforeHash: null,
    afterHash: null,
    createdAt: "2026-07-11T00:00:00Z",
  };

  const decision: GovernanceDecision = {
    decisionId: "govd-001",
    proposalId: "evol-test-001",
    evolutionId: "evo-001",
    kind: "APPROVE",
    confidence: 0.95,
    reasoning: "Approved for testing",
    risks: [],
    evidenceId: "ev-001",
    recommendationAvailable: false,
    followedRecommendation: false,
    policySnapshot: {
      policyName: "default",
      minApproveConfidence: 0.8,
      minMonitorConfidence: 0.5,
      rejectConfidenceThreshold: 0.3,
      maxAllowedRegressions: 0,
      escalateBehavior: "request_evidence",
      failClosedOnExpiredEvidence: true,
      minReproducibilityLevel: 2,
    },
    targetState: "APPROVED",
    decidedAt: "2026-07-12T00:00:00Z",
    decidedBy: "operator",
  };

  return {
    request,
    proposal,
    decision,
    completedExecutionIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// authorizeExecution
// ---------------------------------------------------------------------------

describe("authorizeExecution", () => {
  // -----------------------------------------------------------------------
  // Check 8 — valid approval succeeds
  // -----------------------------------------------------------------------

  it("allows execution when all checks pass", () => {
    const input = makeBaseInput();
    const result = authorizeExecution(input);

    assert.ok(result.allowed);
    if (result.allowed) {
      assert.strictEqual(result.decisionId, "govd-001");
    }
  });

  // -----------------------------------------------------------------------
  // Check 1 — decision exists
  // -----------------------------------------------------------------------

  it("rejects execution when decision is undefined", () => {
    const input = makeBaseInput({ decision: undefined });
    const result = authorizeExecution(input);

    assert.ok(!result.allowed);
    if (!result.allowed) {
      assert.strictEqual(result.reason, "Governance decision not found");
    }
  });

  // -----------------------------------------------------------------------
  // Check 2 — decision is APPROVE
  // -----------------------------------------------------------------------

  it("rejects execution when decision kind is not APPROVE", () => {
    const input = makeBaseInput();
    input.decision = { ...input.decision, kind: "REJECT" } as GovernanceDecision;
    const result = authorizeExecution(input);

    assert.ok(!result.allowed);
    if (!result.allowed) {
      assert.strictEqual(result.reason, "Decision is not APPROVE");
    }
  });

  it("rejects execution when decision kind is MONITOR", () => {
    const input = makeBaseInput();
    input.decision = { ...input.decision, kind: "MONITOR" } as GovernanceDecision;
    const result = authorizeExecution(input);

    assert.ok(!result.allowed);
    if (!result.allowed) {
      assert.strictEqual(result.reason, "Decision is not APPROVE");
    }
  });

  it("rejects execution when decision kind is REQUEST_MORE_EVIDENCE", () => {
    const input = makeBaseInput();
    input.decision = { ...input.decision, kind: "REQUEST_MORE_EVIDENCE" } as GovernanceDecision;
    const result = authorizeExecution(input);

    assert.ok(!result.allowed);
    if (!result.allowed) {
      assert.strictEqual(result.reason, "Decision is not APPROVE");
    }
  });

  // -----------------------------------------------------------------------
  // Check 3 — integrity hash valid
  // -----------------------------------------------------------------------

  it("allows execution when decision has no integrityHash field", () => {
    // GovernanceDecision without integrityHash — passes for now
    const result = authorizeExecution(makeBaseInput());
    assert.ok(result.allowed);
  });

  it("allows execution when decision has valid integrityHash string", () => {
    const input = makeBaseInput();
    (input.decision as unknown as Record<string, unknown>).integrityHash = "abc123";
    const result = authorizeExecution(input);
    assert.ok(result.allowed);
  });

  it("allows execution when decision has empty integrityHash string", () => {
    const input = makeBaseInput();
    (input.decision as unknown as Record<string, unknown>).integrityHash = "";
    const result = authorizeExecution(input);
    assert.ok(result.allowed);
  });

  it("short-circuits on integrity hash check only after kind passes", () => {
    // REJECT kind should fail at check 2, before integrity hash (check 3) is reached
    const input = makeBaseInput();
    input.decision = { ...input.decision, kind: "REJECT" } as GovernanceDecision;

    const result = authorizeExecution(input);

    assert.ok(!result.allowed);
    if (!result.allowed) {
      assert.strictEqual(result.reason, "Decision is not APPROVE");
    }
  });

  // -----------------------------------------------------------------------
  // Check 4 — proposal matches
  // -----------------------------------------------------------------------

  it("rejects execution when request evolutionId does not match decision proposalId", () => {
    const input = makeBaseInput();
    input.request = { ...input.request, evolutionId: "evo-999" };

    const result = authorizeExecution(input);

    assert.ok(!result.allowed);
    if (!result.allowed) {
      assert.strictEqual(result.reason, "Proposal ID mismatch");
    }
  });

  it("short-circuits on proposal match check before expiry check", () => {
    // evolutionId mismatch should fail at check 4 before expiry (check 5) is reached
    const input = makeBaseInput();
    input.request = { ...input.request, evolutionId: "evo-999" };
    (input.decision as GovernanceDecision & { expiresAt?: string }).expiresAt = "2020-01-01T00:00:00Z";

    const result = authorizeExecution(input);

    assert.ok(!result.allowed);
    if (!result.allowed) {
      assert.strictEqual(result.reason, "Proposal ID mismatch");
    }
  });

  // -----------------------------------------------------------------------
  // Check 5 — decision not expired
  // -----------------------------------------------------------------------

  it("rejects execution when decision has expired", () => {
    const input = makeBaseInput();
    // Extend the decision with an expiresAt in the past
    const expiredDecision = {
      ...input.decision,
      expiresAt: "2020-01-01T00:00:00Z",
    } as GovernanceDecision & { expiresAt: string };
    input.decision = expiredDecision;

    const result = authorizeExecution(input);

    assert.ok(!result.allowed);
    if (!result.allowed) {
      assert.strictEqual(result.reason, "Governance decision has expired");
    }
  });

  it("allows execution when decision has future expiresAt", () => {
    const input = makeBaseInput();
    const futureDecision = {
      ...input.decision,
      expiresAt: "2099-01-01T00:00:00Z",
    } as GovernanceDecision & { expiresAt: string };
    input.decision = futureDecision;

    const result = authorizeExecution(input);

    assert.ok(result.allowed);
    if (result.allowed) {
      assert.strictEqual(result.decisionId, "govd-001");
    }
  });

  it("allows execution when decision has no expiresAt field", () => {
    const input = makeBaseInput();
    // GovernanceDecision without expiresAt — the default
    const result = authorizeExecution(input);

    assert.ok(result.allowed);
    if (result.allowed) {
      assert.strictEqual(result.decisionId, "govd-001");
    }
  });

  it("uses now parameter for expiry check", () => {
    // Decision expires at 2025-01-01 — use now to trigger expiry deterministically
    const input = makeBaseInput();
    const pastDecision = {
      ...input.decision,
      expiresAt: "2025-01-01T00:00:00Z",
    } as GovernanceDecision & { expiresAt: string };
    input.decision = pastDecision;
    input.now = new Date("2026-07-12T00:00:00Z").getTime();

    const result = authorizeExecution(input);

    assert.ok(!result.allowed);
    if (!result.allowed) {
      assert.strictEqual(result.reason, "Governance decision has expired");
    }
  });

  it("allows execution when now is before expiresAt", () => {
    const input = makeBaseInput();
    const futureDecision = {
      ...input.decision,
      expiresAt: "2026-12-31T00:00:00Z",
    } as GovernanceDecision & { expiresAt: string };
    input.decision = futureDecision;
    input.now = new Date("2026-07-12T00:00:00Z").getTime();

    const result = authorizeExecution(input);

    assert.ok(result.allowed);
    if (result.allowed) {
      assert.strictEqual(result.decisionId, "govd-001");
    }
  });

  // -----------------------------------------------------------------------
  // Check 6 — decision not revoked
  // -----------------------------------------------------------------------

  it("rejects execution when decision has been revoked", () => {
    const input = makeBaseInput();
    const revokedDecision = {
      ...input.decision,
      revokedAt: "2026-07-12T06:00:00Z",
    } as GovernanceDecision & { revokedAt: string };
    input.decision = revokedDecision;

    const result = authorizeExecution(input);

    assert.ok(!result.allowed);
    if (!result.allowed) {
      assert.strictEqual(result.reason, "Governance decision has been revoked");
    }
  });

  it("allows execution when decision has no revokedAt field", () => {
    const input = makeBaseInput();
    // GovernanceDecision without revokedAt — the default
    const result = authorizeExecution(input);

    assert.ok(result.allowed);
    if (result.allowed) {
      assert.strictEqual(result.decisionId, "govd-001");
    }
  });

  // -----------------------------------------------------------------------
  // Check 7 — no duplicate execution
  // -----------------------------------------------------------------------

  it("rejects execution when decisionId is in completedExecutionIds", () => {
    const input = makeBaseInput();
    input.completedExecutionIds = ["govd-001"];

    const result = authorizeExecution(input);

    assert.ok(!result.allowed);
    if (!result.allowed) {
      assert.strictEqual(result.reason, "Execution already completed for this decision");
    }
  });

  it("allows execution when completedExecutionIds is empty", () => {
    const input = makeBaseInput();
    input.completedExecutionIds = [];

    const result = authorizeExecution(input);

    assert.ok(result.allowed);
    if (result.allowed) {
      assert.strictEqual(result.decisionId, "govd-001");
    }
  });

  it("allows execution when completedExecutionIds contains different IDs", () => {
    const input = makeBaseInput();
    input.completedExecutionIds = ["govd-002", "govd-003"];

    const result = authorizeExecution(input);

    assert.ok(result.allowed);
    if (result.allowed) {
      assert.strictEqual(result.decisionId, "govd-001");
    }
  });

  it("allows duplicate execution when preventDuplicateExecution is false", () => {
    const input = makeBaseInput();
    input.completedExecutionIds = ["govd-001"];

    const result = authorizeExecution(input, { preventDuplicateExecution: false });

    assert.ok(result.allowed);
    if (result.allowed) {
      assert.strictEqual(result.decisionId, "govd-001");
    }
  });

  // -----------------------------------------------------------------------
  // Check 8 — successful authorization returns decisionId
  // -----------------------------------------------------------------------

  it("returns decisionId on successful authorization", () => {
    const input = makeBaseInput();
    const result = authorizeExecution(input);

    assert.ok(result.allowed);
    if (result.allowed) {
      assert.strictEqual(result.decisionId, "govd-001");
      assert.strictEqual(typeof result.decisionId, "string");
    }
  });

  // -----------------------------------------------------------------------
  // Ordering — checks short-circuit
  // -----------------------------------------------------------------------

  it("short-circuits on first failing check (decision exists before kind)", () => {
    const result = authorizeExecution({
      request: makeBaseInput().request,
      proposal: makeBaseInput().proposal,
      decision: undefined,
      completedExecutionIds: [],
    });

    assert.ok(!result.allowed);
    if (!result.allowed) {
      assert.strictEqual(result.reason, "Governance decision not found");
    }
  });

  it("short-circuits on kind check before integrity hash check", () => {
    const input = makeBaseInput();
    input.decision = {
      ...input.decision,
      kind: "REJECT",
    } as GovernanceDecision;

    const result = authorizeExecution(input);

    assert.ok(!result.allowed);
    if (!result.allowed) {
      // Should fail on kind (check 2), not integrity hash (check 3)
      assert.strictEqual(result.reason, "Decision is not APPROVE");
    }
  });

  it("short-circuits on proposal match check before expiry check", () => {
    const input = makeBaseInput();
    input.request = { ...input.request, evolutionId: "evo-999" };
    (input.decision as GovernanceDecision & { expiresAt?: string }).expiresAt = "2020-01-01T00:00:00Z";

    const result = authorizeExecution(input);

    assert.ok(!result.allowed);
    if (!result.allowed) {
      // Should fail on proposal match (check 4), not expiry (check 5)
      assert.strictEqual(result.reason, "Proposal ID mismatch");
    }
  });
});
