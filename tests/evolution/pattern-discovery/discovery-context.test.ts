/**
 * Tests for A1.1 — DiscoveryContext Contract.
 *
 * Covers empty context acceptance and compile-time readonly enforcement.
 *
 * @module
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DiscoveryContext } from "../../../src/evolution/contracts/discovery-context.js";

// ---------------------------------------------------------------------------
// DiscoveryContext
// ---------------------------------------------------------------------------

describe("DiscoveryContext", () => {
  it("accepts empty context", () => {
    const context: DiscoveryContext = {
      evidence: [],
      governanceEvents: [],
    };
    assert.equal(context.evidence.length, 0);
    assert.equal(context.governanceEvents.length, 0);
  });

  it("accepts context with non-empty arrays", () => {
    const context: DiscoveryContext = {
      evidence: [
        {
          evidenceId: "ev-001",
          intentId: "intent-001",
          startedAt: "2026-07-11T10:00:00.000Z",
          completedAt: "2026-07-11T11:00:00.000Z",
          outcome: "SUCCESS",
          summary: "Test execution",
          artifacts: [],
          verificationPassed: true,
          evidenceHash: "abc123",
        },
      ],
      governanceEvents: [],
    };
    assert.equal(context.evidence.length, 1);
    assert.equal(context.governanceEvents.length, 0);
  });

  it("readonly prevents reassignment of evidence array", () => {
    const context: DiscoveryContext = {
      evidence: [],
      governanceEvents: [],
    };
    // @ts-expect-error - evidence is readonly
    context.evidence = [];
  });

  it("readonly prevents reassignment of governanceEvents array", () => {
    const context: DiscoveryContext = {
      evidence: [],
      governanceEvents: [],
    };
    // @ts-expect-error - governanceEvents is readonly
    context.governanceEvents = [];
  });

  it("readonly prevents mutation of evidence array elements", () => {
    const context: DiscoveryContext = {
      evidence: [
        {
          evidenceId: "ev-001",
          intentId: "intent-001",
          startedAt: "2026-07-11T10:00:00.000Z",
          completedAt: "2026-07-11T11:00:00.000Z",
          outcome: "SUCCESS",
          summary: "Test execution",
          artifacts: [],
          verificationPassed: true,
          evidenceHash: "abc123",
        },
      ],
      governanceEvents: [],
    };
    // @ts-expect-error - readonly array prevents push
    context.evidence.push({
      evidenceId: "ev-002",
      intentId: "intent-002",
      startedAt: "2026-07-11T12:00:00.000Z",
      completedAt: "2026-07-11T13:00:00.000Z",
      outcome: "SUCCESS",
      summary: "Another execution",
      artifacts: [],
      verificationPassed: true,
      evidenceHash: "def456",
    });
  });

  it("Readonly prevents mutation of governanceEvents array elements", () => {
    const context: DiscoveryContext = {
      evidence: [],
      governanceEvents: [
        {
          eventId: "gov-001",
          timestamp: "2026-07-11T10:00:00.000Z",
          eventType: "policy_evaluated",
          actorType: "system",
          actorId: "policy-engine-1",
          subjectType: "policy",
          subjectId: "pol-001",
          action: "evaluate",
          decision: "allowed",
          policyId: "pol-001",
          policyVersion: "1.0",
          ruleId: null,
          reason: "Policy evaluation passed",
          evidenceRefs: [],
          requestId: null,
          traceId: null,
          sessionId: null,
          parentEventId: null,
          riskLevel: "low",
          requiresHumanReview: false,
          metadata: {},
          previousHash: null,
          eventHash: "abc123",
        },
      ],
    };
    // @ts-expect-error - readonly array prevents push
    context.governanceEvents.push({
      eventId: "gov-002",
      timestamp: "2026-07-11T11:00:00.000Z",
      eventType: "action_allowed",
      actorType: "system",
      actorId: "policy-engine-1",
      subjectType: "action",
      subjectId: "act-001",
      action: "execute",
      decision: "allowed",
      policyId: "pol-001",
      policyVersion: "1.0",
      ruleId: null,
      reason: "Action allowed",
      evidenceRefs: [],
      requestId: null,
      traceId: null,
      sessionId: null,
      parentEventId: null,
      riskLevel: "low",
      requiresHumanReview: false,
      metadata: {},
      previousHash: null,
      eventHash: "def456",
    });
  });
});
