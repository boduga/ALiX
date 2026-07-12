// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import test from "node:test";
import assert from "node:assert/strict";
import {
  ApprovalFrictionStrategy,
} from "../../../../src/evolution/pattern-discovery/strategies/approval-friction-strategy.js";
import type { DiscoveryContext } from "../../../../src/evolution/contracts/discovery-context.js";
import type { GovernanceAuditEvent } from "../../../../src/governance/audit-types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let evSeq = 0;

function makeGovernanceEvent(
  overrides: {
    eventType: GovernanceAuditEvent["eventType"];
    timestamp: string;
    decision?: GovernanceAuditEvent["decision"];
    eventId?: string;
    policyId?: string | null;
  },
): GovernanceAuditEvent {
  return {
    eventId: overrides.eventId ?? `ge-${++evSeq}`,
    timestamp: overrides.timestamp,
    eventType: overrides.eventType,
    decision: overrides.decision ?? "denied",
    actorType: "system",
    actorId: "test-actor",
    subjectType: "action",
    subjectId: "test-subject",
    action: "test-action",
    policyId: overrides.policyId ?? null,
    policyVersion: null,
    ruleId: null,
    reason: "test reason",
    evidenceRefs: [],
    requestId: null,
    traceId: null,
    sessionId: null,
    parentEventId: null,
    riskLevel: "medium",
    requiresHumanReview: false,
    metadata: {},
    previousHash: null,
    eventHash: "test-hash",
  };
}

function makeContext(
  governanceEvents: GovernanceAuditEvent[],
): DiscoveryContext {
  return { evidence: [], governanceEvents };
}

// ---------------------------------------------------------------------------
// ApprovalFrictionStrategy
// ---------------------------------------------------------------------------

test("high denial rate emits pattern (15 denied/20 total with threshold 0.5)", async () => {
  const strategy = new ApprovalFrictionStrategy({
    denialRateThreshold: 0.5,
    minimumEvents: 10,
  });
  const now = Date.now();

  const events: GovernanceAuditEvent[] = [];
  // 15 denied events
  for (let i = 0; i < 15; i++) {
    events.push(
      makeGovernanceEvent({
        eventType: "action_denied",
        timestamp: new Date(now - i * 3600_000).toISOString(),
        decision: "denied",
      }),
    );
  }
  // 5 approved events
  for (let i = 0; i < 5; i++) {
    events.push(
      makeGovernanceEvent({
        eventType: "action_allowed",
        timestamp: new Date(now - i * 3600_000).toISOString(),
        decision: "allowed",
      }),
    );
  }

  const patterns = await strategy.run(makeContext(events));

  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].category, "approval_friction");
  assert.equal(patterns[0].frequency, 15);
  assert.equal(patterns[0].evidenceIds.length, 15);
  assert.ok(patterns[0].confidence > 0.5, `confidence ${patterns[0].confidence} should be > 0.5`);
});

test("below threshold returns empty (3 denied/13 total with threshold 0.8)", async () => {
  const strategy = new ApprovalFrictionStrategy({
    denialRateThreshold: 0.8,
    minimumEvents: 5,
    lookbackWindowDays: 30,
  });
  const now = Date.now();

  const events: GovernanceAuditEvent[] = [];
  // 3 denied events
  for (let i = 0; i < 3; i++) {
    events.push(
      makeGovernanceEvent({
        eventType: "action_denied",
        timestamp: new Date(now - i * 3600_000).toISOString(),
        decision: "denied",
      }),
    );
  }
  // 10 approved events
  for (let i = 0; i < 10; i++) {
    events.push(
      makeGovernanceEvent({
        eventType: "action_allowed",
        timestamp: new Date(now - i * 3600_000).toISOString(),
        decision: "allowed",
      }),
    );
  }

  const patterns = await strategy.run(makeContext(events));

  assert.equal(patterns.length, 0);
});

test("insufficient events returns empty (3 events with minimumEvents=10)", async () => {
  const strategy = new ApprovalFrictionStrategy({
    minimumEvents: 10,
    lookbackWindowDays: 30,
  });
  const now = Date.now();

  const events = [
    makeGovernanceEvent({
      eventType: "action_denied",
      timestamp: new Date(now - 1000).toISOString(),
    }),
    makeGovernanceEvent({
      eventType: "action_allowed",
      timestamp: new Date(now - 2000).toISOString(),
      decision: "allowed",
    }),
    makeGovernanceEvent({
      eventType: "human_approval_denied",
      timestamp: new Date(now - 3000).toISOString(),
    }),
  ];

  const patterns = await strategy.run(makeContext(events));

  assert.equal(patterns.length, 0);
});

test("no governance events returns empty", async () => {
  const strategy = new ApprovalFrictionStrategy();

  const patterns = await strategy.run(makeContext([]));

  assert.equal(patterns.length, 0);
});

test("denominator uses approved + denied only (policy_evaluated events ignored)", async () => {
  const strategy = new ApprovalFrictionStrategy({
    denialRateThreshold: 0.5,
    minimumEvents: 5,
    lookbackWindowDays: 30,
  });
  const now = Date.now();

  const events: GovernanceAuditEvent[] = [];
  // 5 denied events
  for (let i = 0; i < 5; i++) {
    events.push(
      makeGovernanceEvent({
        eventType: "action_denied",
        timestamp: new Date(now - i * 3600_000).toISOString(),
        decision: "denied",
      }),
    );
  }
  // 5 approved events
  for (let i = 0; i < 5; i++) {
    events.push(
      makeGovernanceEvent({
        eventType: "action_allowed",
        timestamp: new Date(now - i * 3600_000).toISOString(),
        decision: "allowed",
      }),
    );
  }
  // 100 policy_evaluated events (must be ignored in denominator)
  for (let i = 0; i < 100; i++) {
    events.push(
      makeGovernanceEvent({
        eventType: "policy_evaluated",
        timestamp: new Date(now - i * 1000).toISOString(),
        decision: "allowed",
        policyId: `policy-${i}`,
      }),
    );
  }

  const patterns = await strategy.run(makeContext(events));

  // 5 denied / 10 total = 0.5 which equals threshold 0.5 => emits pattern
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].frequency, 5);
  // Evidence IDs should only be the denied event IDs (5 total)
  assert.equal(patterns[0].evidenceIds.length, 5);
});

test("confidence is always in [0, 1] range", async () => {
  const strategy = new ApprovalFrictionStrategy({
    denialRateThreshold: 0.5,
    minimumEvents: 10,
  });
  const now = Date.now();

  const events: GovernanceAuditEvent[] = [];
  // 15 denied events
  for (let i = 0; i < 15; i++) {
    events.push(
      makeGovernanceEvent({
        eventType: "action_denied",
        timestamp: new Date(now - i * 3600_000).toISOString(),
        decision: "denied",
      }),
    );
  }
  // 5 approved events
  for (let i = 0; i < 5; i++) {
    events.push(
      makeGovernanceEvent({
        eventType: "action_allowed",
        timestamp: new Date(now - i * 3600_000).toISOString(),
        decision: "allowed",
      }),
    );
  }

  const patterns = await strategy.run(makeContext(events));

  assert.equal(patterns.length, 1);
  assert.ok(
    patterns[0].confidence >= 0,
    `confidence ${patterns[0].confidence} must be >= 0`,
  );
  assert.ok(
    patterns[0].confidence <= 1,
    `confidence ${patterns[0].confidence} must be <= 1`,
  );
});
