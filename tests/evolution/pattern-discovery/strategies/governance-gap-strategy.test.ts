/**
 * Tests A1.3 — GovernanceGapStrategy
 *
 * Covers escalation detection, unresolved escalation counting,
 * threshold filtering, empty data, and confidence scoring.
 *
 * @module governance-gap-strategy
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GovernanceGapStrategy } from "../../../../src/evolution/pattern-discovery/strategies/governance-gap-strategy.js";
import type { DiscoveryContext } from "../../../../src/evolution/contracts/discovery-context.js";
import type { GovernanceAuditEvent } from "../../../../src/governance/audit-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let eventCounter = 0;

function makeGovernanceEvent(
  overrides: Partial<GovernanceAuditEvent> & { timestamp: string },
): GovernanceAuditEvent {
  eventCounter++;
  return {
    eventId: `gov-${String(eventCounter).padStart(3, "0")}`,
    eventType: "action_escalated",
    actorType: "agent",
    actorId: "alix-agent",
    subjectType: "action",
    subjectId: `action-${eventCounter}`,
    action: "execute_workflow",
    decision: "escalated",
    policyId: null,
    policyVersion: null,
    ruleId: null,
    reason: "Escalated for human review",
    evidenceRefs: [],
    requestId: null,
    traceId: `trace-${eventCounter}`,
    sessionId: null,
    parentEventId: null,
    riskLevel: "medium",
    requiresHumanReview: true,
    metadata: {},
    previousHash: null,
    eventHash: `hash-${eventCounter}`,
    ...overrides,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (d: number): string => new Date(Date.now() - d * DAY_MS).toISOString();

// ---------------------------------------------------------------------------
// GovernanceGapStrategy
// ---------------------------------------------------------------------------

describe("GovernanceGapStrategy", () => {
  it("emits pattern when unresolved escalations meet threshold", async () => {
    // 5 escalation events with no resolutions
    const governanceEvents: GovernanceAuditEvent[] = [
      makeGovernanceEvent({ timestamp: daysAgo(5), subjectId: "action-001" }),
      makeGovernanceEvent({ timestamp: daysAgo(4), subjectId: "action-002" }),
      makeGovernanceEvent({ timestamp: daysAgo(3), subjectId: "action-003" }),
      makeGovernanceEvent({ timestamp: daysAgo(2), subjectId: "action-004" }),
      makeGovernanceEvent({ timestamp: daysAgo(1), subjectId: "action-005" }),
    ];

    const strategy = new GovernanceGapStrategy({
      minimumUnresolved: 3,
      baselineCount: 10,
    });

    const context: DiscoveryContext = { evidence: [], governanceEvents };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 1, "should emit 1 pattern for unresolved escalations");
    assert.strictEqual(patterns[0].category, "governance_gap");
    assert.ok(patterns[0].description.includes("unresolved governance escalation"));
    assert.strictEqual(patterns[0].frequency, 5);
    assert.strictEqual(patterns[0].evidenceIds.length, 5);
  });

  it("returns empty when unresolved escalations are below threshold", async () => {
    // Only 1 escalation below threshold of 3
    const governanceEvents: GovernanceAuditEvent[] = [
      makeGovernanceEvent({ timestamp: daysAgo(1), subjectId: "action-001" }),
    ];

    const strategy = new GovernanceGapStrategy({
      minimumUnresolved: 3,
      baselineCount: 10,
    });

    const context: DiscoveryContext = { evidence: [], governanceEvents };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 0, "should not emit pattern below threshold");
  });

  it("does not count resolved escalations", async () => {
    // 3 escalations where 2 have matching resolutions
    const ts1 = daysAgo(5);
    const ts2 = daysAgo(4);
    const ts3 = daysAgo(3);
    const tsResolution = daysAgo(2);

    const governanceEvents: GovernanceAuditEvent[] = [
      // Escalation for action-001 (unresolved)
      makeGovernanceEvent({ timestamp: ts1, subjectId: "action-001" }),
      // Escalation for action-002 (resolved)
      makeGovernanceEvent({ timestamp: ts2, subjectId: "action-002" }),
      // Escalation for action-003 (resolved)
      makeGovernanceEvent({ timestamp: ts3, subjectId: "action-003" }),
      // Resolutions for action-002 and action-003
      makeGovernanceEvent({
        timestamp: tsResolution,
        subjectId: "action-002",
        eventType: "action_allowed",
        decision: "allowed",
      }),
      makeGovernanceEvent({
        timestamp: tsResolution,
        subjectId: "action-003",
        eventType: "action_allowed",
        decision: "allowed",
      }),
    ];

    const strategy = new GovernanceGapStrategy({
      minimumUnresolved: 2,
      baselineCount: 10,
    });

    const context: DiscoveryContext = { evidence: [], governanceEvents };
    const patterns = await strategy.run(context);

    // 1 unresolved (action-001), below threshold of 2
    assert.strictEqual(patterns.length, 0, "should not count resolved escalations");
  });

  it("returns empty when no escalation events exist", async () => {
    const governanceEvents: GovernanceAuditEvent[] = [
      makeGovernanceEvent({
        timestamp: daysAgo(1),
        eventType: "action_allowed",
        decision: "allowed",
        subjectId: "action-001",
      }),
    ];

    const strategy = new GovernanceGapStrategy({
      minimumUnresolved: 3,
      baselineCount: 10,
    });

    const context: DiscoveryContext = { evidence: [], governanceEvents };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 0);
  });

  it("events outside lookback window are filtered out", async () => {
    // Events from 60 days ago (window is 30)
    const governanceEvents: GovernanceAuditEvent[] = [
      makeGovernanceEvent({ timestamp: daysAgo(60), subjectId: "action-001" }),
      makeGovernanceEvent({ timestamp: daysAgo(55), subjectId: "action-002" }),
      makeGovernanceEvent({ timestamp: daysAgo(50), subjectId: "action-003" }),
    ];

    const strategy = new GovernanceGapStrategy({
      minimumUnresolved: 2,
      lookbackWindowDays: 30,
      baselineCount: 10,
    });

    const context: DiscoveryContext = { evidence: [], governanceEvents };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 0, "should filter out events outside window");
  });

  it("confidence score is always in [0, 1] range", async () => {
    const governanceEvents: GovernanceAuditEvent[] = [
      makeGovernanceEvent({ timestamp: daysAgo(5), subjectId: "action-001" }),
      makeGovernanceEvent({ timestamp: daysAgo(4), subjectId: "action-002" }),
      makeGovernanceEvent({ timestamp: daysAgo(3), subjectId: "action-003" }),
      makeGovernanceEvent({ timestamp: daysAgo(2), subjectId: "action-004" }),
    ];

    const strategy = new GovernanceGapStrategy({
      minimumUnresolved: 3,
      baselineCount: 5,
    });

    const context: DiscoveryContext = { evidence: [], governanceEvents };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 1);
    assert.ok(
      patterns[0].confidence >= 0 && patterns[0].confidence <= 1,
      `confidence ${patterns[0].confidence} should be in [0, 1]`,
    );
  });

  it("empty governance events returns empty", async () => {
    const strategy = new GovernanceGapStrategy();
    const context: DiscoveryContext = { evidence: [], governanceEvents: [] };
    const patterns = await strategy.run(context);

    assert.deepStrictEqual(patterns, []);
  });

  it("firstObserved <= lastObserved", async () => {
    const governanceEvents: GovernanceAuditEvent[] = [
      makeGovernanceEvent({ timestamp: daysAgo(10), subjectId: "action-001" }),
      makeGovernanceEvent({ timestamp: daysAgo(5), subjectId: "action-002" }),
      makeGovernanceEvent({ timestamp: daysAgo(1), subjectId: "action-003" }),
    ];

    const strategy = new GovernanceGapStrategy({
      minimumUnresolved: 2,
      baselineCount: 10,
    });

    const context: DiscoveryContext = { evidence: [], governanceEvents };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 1);
    assert.ok(
      patterns[0].firstObserved <= patterns[0].lastObserved,
      `firstObserved (${patterns[0].firstObserved}) should be <= lastObserved (${patterns[0].lastObserved})`,
    );
  });

  it("handles eventType-base escalations (not just decision-based)", async () => {
    // Use decision: "denied" but eventType: "action_escalated" should still count
    const governanceEvents: GovernanceAuditEvent[] = [
      makeGovernanceEvent({
        timestamp: daysAgo(3),
        subjectId: "action-001",
        eventType: "action_escalated",
        decision: "denied",
      }),
      makeGovernanceEvent({
        timestamp: daysAgo(2),
        subjectId: "action-002",
        eventType: "action_escalated",
        decision: "denied",
      }),
      makeGovernanceEvent({
        timestamp: daysAgo(1),
        subjectId: "action-003",
        eventType: "action_escalated",
        decision: "denied",
      }),
    ];

    const strategy = new GovernanceGapStrategy({
      minimumUnresolved: 2,
      baselineCount: 10,
    });

    const context: DiscoveryContext = { evidence: [], governanceEvents };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 1, "should detect action_escalated type events");
  });

  it("override events counted when treatOverrideAsUnresolved=true", async () => {
    const governanceEvents: GovernanceAuditEvent[] = [
      makeGovernanceEvent({
        timestamp: daysAgo(3),
        subjectId: "action-001",
        eventType: "override_applied",
        decision: "overridden",
      }),
      makeGovernanceEvent({
        timestamp: daysAgo(2),
        subjectId: "action-002",
        eventType: "override_applied",
        decision: "overridden",
      }),
      makeGovernanceEvent({
        timestamp: daysAgo(1),
        subjectId: "action-003",
        eventType: "override_applied",
        decision: "overridden",
      }),
    ];

    const strategy = new GovernanceGapStrategy({
      minimumUnresolved: 2,
      baselineCount: 10,
      treatOverrideAsUnresolved: true,
    });

    const context: DiscoveryContext = { evidence: [], governanceEvents };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 1, "should count overrides when enabled");
  });

  it("override events not counted when treatOverrideAsUnresolved=false", async () => {
    const governanceEvents: GovernanceAuditEvent[] = [
      makeGovernanceEvent({
        timestamp: daysAgo(3),
        subjectId: "action-001",
        eventType: "override_applied",
        decision: "overridden",
      }),
    ];

    const strategy = new GovernanceGapStrategy({
      minimumUnresolved: 1,
      baselineCount: 10,
      treatOverrideAsUnresolved: false,
    });

    const context: DiscoveryContext = { evidence: [], governanceEvents };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 0, "should not count overrides when disabled");
  });
});
