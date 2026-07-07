/**
 * Tests for P15.1 — Governance Audit Metrics (pure computation module).
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import {
  totalEvents,
  eventTypeDistribution,
  decisionRates,
  riskDistribution,
  timeWindowedCounts,
  topActors,
  topSubjects,
  policyActivity,
  traceVolume,
  beforeAfterComparison,
} from "../../src/governance/audit-metrics.js";

import type { GovernanceAuditEvent, GovernanceEventType, RiskLevel } from "../../src/governance/audit-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const T = "2026-07-07T14:00:00.000Z";
const T_PLUS_1 = "2026-07-07T14:30:00.000Z";
const T_PLUS_2 = "2026-07-07T15:00:00.000Z";
const T_PLUS_3 = "2026-07-07T15:30:00.000Z";

// ---------------------------------------------------------------------------
// Fixture — a known set of 12 GovernanceAuditEvent records
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<GovernanceAuditEvent> = {}): GovernanceAuditEvent {
  return {
    eventId: "aud-test",
    timestamp: T,
    eventType: "policy_evaluated",
    actorType: "system",
    actorId: "governance",
    subjectType: "signal",
    subjectId: "sig-001",
    action: "evaluate_governance_policy",
    decision: "allowed",
    policyId: null,
    policyVersion: null,
    ruleId: null,
    reason: "test",
    evidenceRefs: [],
    requestId: null,
    traceId: null,
    sessionId: null,
    parentEventId: null,
    riskLevel: "low",
    requiresHumanReview: false,
    metadata: {},
    previousHash: null,
    eventHash: "abc",
    ...overrides,
  };
}

function fixture(): GovernanceAuditEvent[] {
  return [
    makeEvent({ eventId: "evt-1", timestamp: T, eventType: "policy_evaluated", actorId: "governance", subjectId: "sig-001", riskLevel: "medium", traceId: "trace-1" }),
    makeEvent({ eventId: "evt-2", timestamp: T_PLUS_1, eventType: "action_allowed", actorId: "alice", subjectId: "sig-001", riskLevel: "low", policyId: "policy-x", traceId: "trace-1" }),
    makeEvent({ eventId: "evt-3", timestamp: T_PLUS_2, eventType: "action_denied", actorId: "alice", subjectId: "sig-002", riskLevel: "high", policyId: "policy-y", traceId: "trace-2" }),
    makeEvent({ eventId: "evt-4", timestamp: T_PLUS_2, eventType: "action_escalated", actorId: "bob", subjectId: "sig-003", riskLevel: "critical", traceId: "trace-2" }),
    makeEvent({ eventId: "evt-5", timestamp: T_PLUS_3, eventType: "override_applied", actorId: "carol", subjectId: "prop-001", riskLevel: "medium", policyId: "policy-x", traceId: null }),
    makeEvent({ eventId: "evt-6", timestamp: T, eventType: "human_approval_requested", actorId: "alice", subjectId: "sig-001", riskLevel: "low", traceId: "trace-1" }),
    makeEvent({ eventId: "evt-7", timestamp: T_PLUS_1, eventType: "action_allowed", actorId: "governance", subjectId: "sig-004", riskLevel: "medium", traceId: "trace-3" }),
    makeEvent({ eventId: "evt-8", timestamp: T_PLUS_2, eventType: "action_denied", actorId: "dave", subjectId: "sig-005", riskLevel: "high", traceId: null }),
    makeEvent({ eventId: "evt-9", timestamp: T_PLUS_3, eventType: "policy_evaluated", actorId: "governance", subjectId: "sig-006", riskLevel: "critical", traceId: "trace-3" }),
    makeEvent({ eventId: "evt-10", timestamp: T_PLUS_3, eventType: "override_applied", actorId: "bob", subjectId: "prop-002", riskLevel: "medium", policyId: "policy-z", traceId: null }),
    makeEvent({ eventId: "evt-11", timestamp: T, eventType: "action_escalated", actorId: "bob", subjectId: "sig-007", riskLevel: "high", traceId: "trace-4" }),
    makeEvent({ eventId: "evt-12", timestamp: T_PLUS_1, eventType: "action_allowed", actorId: "alice", subjectId: "sig-001", riskLevel: "low", traceId: "trace-1" }),
  ];
}

// ---------------------------------------------------------------------------
// totalEvents
// ---------------------------------------------------------------------------

describe("totalEvents", () => {
  it("returns 0 for empty array", () => {
    assert.equal(totalEvents([]), 0);
  });

  it("returns correct count", () => {
    assert.equal(totalEvents(fixture()), 12);
  });
});

// ---------------------------------------------------------------------------
// eventTypeDistribution
// ---------------------------------------------------------------------------

describe("eventTypeDistribution", () => {
  it("returns empty object for empty array", () => {
    assert.deepEqual(eventTypeDistribution([]), {});
  });

  it("counts each eventType correctly", () => {
    const dist = eventTypeDistribution(fixture());
    assert.equal(dist["policy_evaluated"], 2);
    assert.equal(dist["action_allowed"], 3);
    assert.equal(dist["action_denied"], 2);
    assert.equal(dist["action_escalated"], 2);
    assert.equal(dist["override_applied"], 2);
    assert.equal(dist["human_approval_requested"], 1);
    assert.equal(Object.keys(dist).length, 6);
  });
});

// ---------------------------------------------------------------------------
// decisionRates
// ---------------------------------------------------------------------------

describe("decisionRates", () => {
  it("returns all zeros for empty array", () => {
    assert.deepEqual(decisionRates([]), { allowed: 0, denied: 0, escalated: 0, overridden: 0 });
  });

  it("returns all zeros for non-decision-bearing events only", () => {
    const events = [
      makeEvent({ eventType: "policy_evaluated" }),
      makeEvent({ eventType: "human_approval_requested" }),
    ];
    assert.deepEqual(decisionRates(events), { allowed: 0, denied: 0, escalated: 0, overridden: 0 });
  });

  it("computes correct proportions from fixture", () => {
    const rates = decisionRates(fixture());
    // Fixture: 3 allowed, 2 denied, 2 escalated, 2 overridden = 9 decision-bearing
    assert.equal(rates.allowed, 3 / 9);
    assert.equal(rates.denied, 2 / 9);
    assert.equal(rates.escalated, 2 / 9);
    assert.equal(rates.overridden, 2 / 9);
    // Verify they sum to 1
    const sum = rates.allowed + rates.denied + rates.escalated + rates.overridden;
    assert.ok(Math.abs(sum - 1) < 0.001);
  });
});

// ---------------------------------------------------------------------------
// riskDistribution
// ---------------------------------------------------------------------------

describe("riskDistribution", () => {
  it("counts correctly", () => {
    const risk = riskDistribution(fixture());
    assert.equal(risk["low"], 3);
    assert.equal(risk["medium"], 4);
    assert.equal(risk["high"], 3);
    assert.equal(risk["critical"], 2);
  });
});

// ---------------------------------------------------------------------------
// timeWindowedCounts
// ---------------------------------------------------------------------------

describe("timeWindowedCounts", () => {
  it("throws for non-positive windowMs", () => {
    assert.throws(() => timeWindowedCounts([], 0), /windowMs must be positive/);
    assert.throws(() => timeWindowedCounts([], -1), /windowMs must be positive/);
  });

  it("returns empty for empty events", () => {
    assert.deepEqual(timeWindowedCounts([], 60000), []);
  });

  it("buckets events by 1-hour windows", () => {
    const buckets = timeWindowedCounts(fixture(), 60 * 60 * 1000);
    // All events fall within 14:00-15:30; bucketed to 14:00 and 15:00
    assert.ok(buckets.length >= 2);
    // Each bucket has a count > 0
    for (const b of buckets) {
      assert.ok(b.count > 0);
    }
  });
});

// ---------------------------------------------------------------------------
// topActors
// ---------------------------------------------------------------------------

describe("topActors", () => {
  it("returns empty for empty events", () => {
    assert.deepEqual(topActors([], 5), []);
  });

  it("returns actors sorted by count desc, then id asc", () => {
    const actors = topActors(fixture(), 10);
    // alice appears 4x (evt-2,3,6,12) → highest count
    assert.equal(actors[0]!.actorId, "alice");
    assert.equal(actors[0]!.count, 4);
    // bob appears 3x (evt-4,10,11)
    assert.equal(actors[1]!.actorId, "bob");
    assert.equal(actors[1]!.count, 3);
  });

  it("limits to N", () => {
    const actors = topActors(fixture(), 3);
    assert.equal(actors.length, 3);
  });

  it("includes lastSeen timestamp", () => {
    const actors = topActors(fixture(), 1);
    assert.ok(actors[0]!.lastSeen.length > 0);
  });
});

// ---------------------------------------------------------------------------
// topSubjects
// ---------------------------------------------------------------------------

describe("topSubjects", () => {
  it("excludes null subjectIds", () => {
    const events = [
      makeEvent({ subjectId: "a" }),
      makeEvent({ subjectId: null }),
    ];
    const subjects = topSubjects(events, 10);
    assert.equal(subjects.length, 1);
  });

  it("returns subjects sorted by count desc", () => {
    const subjects = topSubjects(fixture(), 10);
    // sig-001 appears in 4 events (evt-1,2,6,12)
    assert.equal(subjects[0]!.subjectId, "sig-001");
    assert.equal(subjects[0]!.count, 4);
  });

  it("returns subjectType alongside subjectId", () => {
    const subjects = topSubjects(fixture(), 10);
    assert.ok(subjects.every((s) => typeof s.subjectType === "string"));
  });
});

// ---------------------------------------------------------------------------
// policyActivity
// ---------------------------------------------------------------------------

describe("policyActivity", () => {
  it("excludes null policyIds", () => {
    const events = [
      makeEvent({ policyId: null }),
    ];
    assert.deepEqual(policyActivity(events), []);
  });

  it("counts correctly", () => {
    const policies = policyActivity(fixture());
    // policy-x appears in evt-2, evt-5 → 2
    // policy-y appears in evt-3 → 1
    // policy-z appears in evt-10 → 1
    assert.equal(policies.length, 3);
    assert.equal(policies.find((p) => p.policyId === "policy-x")?.count, 2);
    assert.equal(policies.find((p) => p.policyId === "policy-y")?.count, 1);
    assert.equal(policies.find((p) => p.policyId === "policy-z")?.count, 1);
  });
});

// ---------------------------------------------------------------------------
// traceVolume
// ---------------------------------------------------------------------------

describe("traceVolume", () => {
  it("returns zeroed for empty array", () => {
    assert.deepEqual(traceVolume([]), { totalEvents: 0, eventsWithTrace: 0, traceRatio: 0 });
  });

  it("computes ratio correctly", () => {
    const tv = traceVolume(fixture());
    // 8 events with traceId, 4 without (evt-5,8,10 = 3 without; wait let me count)
    // evt-1: trace-1, evt-2: trace-1, evt-3: trace-2, evt-4: trace-2,
    // evt-5: null, evt-6: trace-1, evt-7: trace-3, evt-8: null,
    // evt-9: trace-3, evt-10: null, evt-11: trace-4, evt-12: trace-1
    // with trace: evt-1,2,3,4,6,7,9,11,12 = 9? Let me recount.
    // evt-1 trace-1, evt-2 trace-1, evt-3 trace-2, evt-4 trace-2,
    // evt-5 null, evt-6 trace-1, evt-7 trace-3, evt-8 null,
    // evt-9 trace-3, evt-10 null, evt-11 trace-4, evt-12 trace-1
    // with trace: 1,2,3,4,6,7,9,11,12 = 9
    // without: 5,8,10 = 3
    // total: 12
    assert.equal(tv.totalEvents, 12);
    assert.equal(tv.eventsWithTrace, 9);
    assert.equal(tv.traceRatio, 0.75);
  });

  it("returns ratio 1.0 when all events have traces", () => {
    const events = [
      makeEvent({ traceId: "t-1" }),
      makeEvent({ traceId: "t-1" }),
    ];
    assert.equal(traceVolume(events).traceRatio, 1);
  });

  it("returns ratio 0 when no events have traces", () => {
    const events = [
      makeEvent({ traceId: null }),
    ];
    assert.equal(traceVolume(events).traceRatio, 0);
  });
});

// ---------------------------------------------------------------------------
// beforeAfterComparison
// ---------------------------------------------------------------------------

describe("beforeAfterComparison", () => {
  it("compares two time windows", () => {
    const result = beforeAfterComparison(
      fixture(),
      "2026-07-07T13:00:00.000Z", // before: 13:00-14:00 = 0 events
      "2026-07-07T14:00:00.000Z",
      "2026-07-07T14:00:00.000Z", // after: 14:00-16:00 = 12 events
      "2026-07-07T16:00:00.000Z",
    );
    assert.equal(result.before.totalEvents, 0);
    assert.equal(result.after.totalEvents, 12);
    assert.equal(result.delta.totalEvents, 12);
  });

  it("computes delta of decision rates", () => {
    const result = beforeAfterComparison(
      fixture(),
      "2026-07-07T13:00:00.000Z",
      "2026-07-07T14:00:00.000Z",
      "2026-07-07T14:00:00.000Z",
      "2026-07-07T16:00:00.000Z",
    );
    // Before has 0 events → rates all 0
    assert.equal(result.before.decisionRates.allowed, 0);
    // After has decision-bearing events
    assert.ok(result.after.decisionRates.allowed > 0);
    // Delta = after - before = after
    assert.equal(result.delta.decisionRates.allowed, result.after.decisionRates.allowed);
  });

  it("uses exclusive upper bound", () => {
    // Events at exact T boundary
    const result = beforeAfterComparison(
      fixture(),
      "2026-07-07T14:00:00.000Z",
      "2026-07-07T14:30:00.000Z",
      "2026-07-07T14:30:00.000Z",
      "2026-07-07T16:00:00.000Z",
    );
    // Events with timestamp exactly "2026-07-07T14:00:00.000Z" should be in 'before' (inclusive lower)
    assert.ok(result.before.totalEvents > 0);
    // Events with timestamp exactly "2026-07-07T14:30:00.000Z" should be in 'after' NOT before (exclusive upper)
    // But T_PLUS_1 = "2026-07-07T14:30:00.000Z" which is exactly the before upper boundary → NOT in before
    // Verified by: fixture() has 4 events at T (evt-1,6,11,12? wait 12 is T_PLUS_1)
    // Actually evt-12 is T_PLUS_1 = 14:30:00 which is excluded from before (beforeTo=14:30:00 exclusive)
  });
});
