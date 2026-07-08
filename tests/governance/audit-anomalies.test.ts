/**
 * Tests for P15.2 — Governance Anomaly Detection.
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

import { detectAnomalies } from "../../src/governance/audit-anomalies.js";
import type { GovernanceAuditEvent, GovernanceEventType, RiskLevel } from "../../src/governance/audit-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const T = "2026-07-07T14:00:00.000Z";
const T1 = "2026-07-07T14:05:00.000Z";
const T2 = "2026-07-07T14:10:00.000Z";
const T3 = "2026-07-07T14:15:00.000Z";
const T4 = "2026-07-07T14:20:00.000Z";
const T5 = "2026-07-07T14:25:00.000Z";
const T6 = "2026-07-07T14:30:00.000Z";
const T_EARLY = "2026-07-07T13:00:00.000Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<GovernanceAuditEvent> = {}): GovernanceAuditEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: T,
    eventType: "policy_evaluated",
    actorType: "system",
    actorId: "governance",
    subjectType: "signal",
    subjectId: "sig-001",
    action: "evaluate",
    decision: "allowed",
    policyId: null,
    policyVersion: null,
    ruleId: null,
    reason: "test",
    evidenceRefs: [],
    requestId: null,
    traceId: "trace-test",
    sessionId: null,
    parentEventId: null,
    riskLevel: "low",
    requiresHumanReview: false,
    metadata: {},
    previousHash: null,
    eventHash: `hash-${Math.random().toString(36).slice(2, 8)}`,
    ...overrides,
  };
}

function defineEvents(events: Partial<GovernanceAuditEvent>[]): GovernanceAuditEvent[] {
  return events.map((o) => makeEvent(o));
}

// ---------------------------------------------------------------------------
// 1. Empty / normal / edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("empty events → zero anomalies", () => {
    assert.equal(detectAnomalies([]).length, 0);
  });

  it("single event → zero anomalies", () => {
    assert.equal(detectAnomalies([makeEvent()]).length, 0);
  });

  it("normal balanced events with baseline → zero anomalies", () => {
    // Every action_allowed has a human_approval_requested on the same trace.
    // Timestamps are monotonically increasing in append order (no regression).
    const events = defineEvents([
      { eventId: "e1", timestamp: T, eventType: "human_approval_requested", traceId: "t1", riskLevel: "low" },
      { eventId: "e2", timestamp: T1, eventType: "action_allowed", traceId: "t1", riskLevel: "low", metadata: { requiresHumanReview: true } },
      { eventId: "e3", timestamp: T2, eventType: "policy_evaluated", traceId: "t1", riskLevel: "low" },
    ]);
    // Normal baseline: same event types at similar ratios
    const baseline = defineEvents([
      { eventId: "b1", timestamp: T_EARLY, eventType: "human_approval_requested", traceId: "t0", riskLevel: "low" },
      { eventId: "b2", timestamp: T_EARLY, eventType: "action_allowed", traceId: "t0", riskLevel: "low" },
      { eventId: "b3", timestamp: T_EARLY, eventType: "policy_evaluated", traceId: "t0", riskLevel: "medium" },
    ]);
    assert.equal(detectAnomalies(events, baseline).length, 0);
  });
});

// ---------------------------------------------------------------------------
// 2. Volume anomalies
// ---------------------------------------------------------------------------

describe("volume anomalies", () => {
  it("no baseline → zero volume anomalies", () => {
    const events = defineEvents([
      { eventId: "v1", eventType: "action_denied" },
    ]);
    assert.equal(detectAnomalies(events).filter((a) => a.type.startsWith("volume_")).length, 0);
  });

  it("spike in action_denied at 3× baseline → warning", () => {
    const events = defineEvents([
      { eventId: "s1", eventType: "action_denied" },
      { eventId: "s2", eventType: "action_denied" },
      { eventId: "s3", eventType: "action_denied" },
      { eventId: "s4", eventType: "action_denied" },
      { eventId: "s5", eventType: "action_denied" },
      { eventId: "s6", eventType: "action_denied" },
    ]);
    const baseline = defineEvents([
      { eventId: "b1", eventType: "action_denied" },
      { eventId: "b2", eventType: "action_denied" },
    ]);
    const result = detectAnomalies(events, baseline);
    // 6 > 2*3=6? No, 6 > 6 is false. 6 > 2*2=4? Yes → warning
    assert.equal(result.filter((a) => a.type === "volume_spike").length, 1);
    assert.equal(result.filter((a) => a.type === "volume_spike")[0]!.severity, "warning");
  });

  it("zero baseline + current 2 events → no anomaly", () => {
    const events = defineEvents([
      { eventId: "z1", eventType: "action_denied" },
      { eventId: "z2", eventType: "action_denied" },
    ]);
    const baseline = defineEvents([
      { eventId: "b1", eventType: "policy_evaluated" },
    ]);
    // Baseline has 0 action_denied, current has 2 (< 3) → no anomaly
    const vol = detectAnomalies(events, baseline).filter((a) => a.type.startsWith("volume_"));
    assert.equal(vol.length, 0);
  });

  it("zero baseline + current 5 events → volume_spike critical", () => {
    const events = defineEvents([
      { eventId: "z1", eventType: "action_denied" },
      { eventId: "z2", eventType: "action_denied" },
      { eventId: "z3", eventType: "action_denied" },
      { eventId: "z4", eventType: "action_denied" },
      { eventId: "z5", eventType: "action_denied" },
    ]);
    const baseline = defineEvents([
      { eventId: "b1", eventType: "policy_evaluated" },
    ]);
    const vol = detectAnomalies(events, baseline).filter((a) => a.type === "volume_spike");
    assert.equal(vol.length, 1);
    assert.equal(vol[0]!.severity, "critical");
  });

  it("drop in human_approval_requested below 0.25× baseline → warning", () => {
    const events = defineEvents([
      { eventId: "d1", eventType: "human_approval_requested" },
    ]);
    const baseline = defineEvents([
      { eventId: "b1", eventType: "human_approval_requested" },
      { eventId: "b2", eventType: "human_approval_requested" },
      { eventId: "b3", eventType: "human_approval_requested" },
      { eventId: "b4", eventType: "human_approval_requested" },
      { eventId: "b5", eventType: "human_approval_requested" },
    ]);
    const drops = detectAnomalies(events, baseline).filter((a) => a.type === "volume_drop");
    assert.equal(drops.length, 1);
  });
});

// ---------------------------------------------------------------------------
// 3. Risk anomalies
// ---------------------------------------------------------------------------

describe("risk anomalies", () => {
  it("no baseline → zero risk anomalies", () => {
    const events = defineEvents([
      { eventId: "r1", eventType: "action_allowed", riskLevel: "critical" },
    ]);
    assert.equal(detectAnomalies(events).filter((a) => a.type.startsWith("risk_")).length, 0);
  });

  it("risk shift with <5 decision events → zero risk anomalies (minimum sample)", () => {
    const events = defineEvents([
      { eventId: "r1", eventType: "action_allowed", riskLevel: "critical" },
    ]);
    const baseline = defineEvents([
      { eventId: "b1", eventType: "action_allowed", riskLevel: "low" },
    ]);
    // Both windows have < 5 decision-bearing events
    assert.equal(detectAnomalies(events, baseline).filter((a) => a.type.startsWith("risk_")).length, 0);
  });

  it("high critical ratio with ≥5 decision events → risk_shift", () => {
    // 5 critical decision-bearing events vs baseline with 10% critical
    const events = defineEvents([
      { eventId: "c1", eventType: "action_allowed", riskLevel: "critical" },
      { eventId: "c2", eventType: "action_allowed", riskLevel: "critical" },
      { eventId: "c3", eventType: "action_denied", riskLevel: "critical" },
      { eventId: "c4", eventType: "action_escalated", riskLevel: "critical" },
      { eventId: "c5", eventType: "action_allowed", riskLevel: "low" },
    ]);
    const baseline = defineEvents([
      { eventId: "b1", eventType: "action_allowed", riskLevel: "low" },
      { eventId: "b2", eventType: "action_allowed", riskLevel: "low" },
      { eventId: "b3", eventType: "action_allowed", riskLevel: "low" },
      { eventId: "b4", eventType: "action_allowed", riskLevel: "low" },
      { eventId: "b5", eventType: "action_allowed", riskLevel: "medium" },
      { eventId: "b6", eventType: "action_allowed", riskLevel: "medium" },
      { eventId: "b7", eventType: "action_allowed", riskLevel: "medium" },
      { eventId: "b8", eventType: "action_allowed", riskLevel: "medium" },
      { eventId: "b9", eventType: "action_allowed", riskLevel: "critical" },
      { eventId: "b10", eventType: "action_allowed", riskLevel: "critical" },
    ]);
    // Baseline: 2/10 = 20% critical, Current: 4/5 = 80% critical → +60pp > 15pp threshold
    const shifts = detectAnomalies(events, baseline).filter((a) => a.type === "risk_shift");
    assert.equal(shifts.length, 1);
    assert.equal(shifts[0]!.metadata.riskLevel, "critical");
  });
});

// ---------------------------------------------------------------------------
// 4. Sequence anomalies
// ---------------------------------------------------------------------------

describe("sequence anomalies", () => {
  it("action_allowed without request on trace → approval_without_request", () => {
    const events = defineEvents([
      { eventId: "a1", eventType: "action_allowed", traceId: "t1", metadata: { requiresHumanReview: true } },
    ]);
    const seq = detectAnomalies(events).filter((a) => a.type === "approval_without_request");
    assert.equal(seq.length, 1);
  });

  it("action_allowed WITH preceding request on same trace → no anomaly", () => {
    const events = defineEvents([
      { eventId: "r1", eventType: "human_approval_requested", traceId: "t1" },
      { eventId: "a1", eventType: "action_allowed", traceId: "t1", metadata: { requiresHumanReview: true } },
    ]);
    assert.equal(detectAnomalies(events).filter((a) => a.type === "approval_without_request").length, 0);
  });

  it("action_escalated without review context → escalation_without_review", () => {
    const events = defineEvents([
      { eventId: "e1", eventType: "action_escalated", traceId: "t1" },
    ]);
    assert.equal(detectAnomalies(events).filter((a) => a.type === "escalation_without_review").length, 1);
  });

  it("action_escalated WITH policy_evaluated on same trace → no anomaly", () => {
    const events = defineEvents([
      { eventId: "p1", eventType: "policy_evaluated", traceId: "t1" },
      { eventId: "e1", eventType: "action_escalated", traceId: "t1" },
    ]);
    assert.equal(detectAnomalies(events).filter((a) => a.type === "escalation_without_review").length, 0);
  });

  it("terminal overridden + later allow on same trace+subject → terminal_mutation", () => {
    const events = defineEvents([
      { eventId: "t1", eventType: "override_applied", traceId: "t1", subjectId: "sig-001", timestamp: T },
      { eventId: "t2", eventType: "action_allowed", traceId: "t1", subjectId: "sig-001", timestamp: T1 },
    ]);
    assert.equal(detectAnomalies(events).filter((a) => a.type === "terminal_mutation").length, 1);
  });

  it("terminal mutation with different subjectId → no anomaly", () => {
    const events = defineEvents([
      { eventId: "t1", eventType: "override_applied", traceId: "t1", subjectId: "sig-001", timestamp: T },
      { eventId: "t2", eventType: "action_allowed", traceId: "t1", subjectId: "sig-002", timestamp: T1 },
    ]);
    assert.equal(detectAnomalies(events).filter((a) => a.type === "terminal_mutation").length, 0);
  });
});

// ---------------------------------------------------------------------------
// 5. Continuity anomalies
// ---------------------------------------------------------------------------

describe("continuity anomalies", () => {
  it("duplicate eventId → single deduplicated anomaly", () => {
    const events = defineEvents([
      { eventId: "dup-1", timestamp: T },
      { eventId: "dup-1", timestamp: T1 },
    ]);
    const dups = detectAnomalies(events).filter((a) => a.type === "duplicate_event_id");
    assert.equal(dups.length, 1);
  });

  it("timestamp regression in append order → timestamp_regression", () => {
    // Second event has EARLIER timestamp → regression
    const events = defineEvents([
      { eventId: "earlier", timestamp: T },
      { eventId: "later-but-earlier-ts", timestamp: T_EARLY },
    ]);
    const reg = detectAnomalies(events).filter((a) => a.type === "timestamp_regression");
    assert.equal(reg.length, 1);
  });

  it("monotonic timestamps in append order → no regression", () => {
    const events = defineEvents([
      { eventId: "e1", timestamp: T },
      { eventId: "e2", timestamp: T1 },
    ]);
    assert.equal(detectAnomalies(events).filter((a) => a.type === "timestamp_regression").length, 0);
  });

  it("hash-chain break → hash_chain_break (append order)", () => {
    const events = defineEvents([
      { eventId: "h1", timestamp: T, eventHash: "hash-abc", previousHash: null },
      { eventId: "h2", timestamp: T1, eventHash: "hash-def", previousHash: "hash-abc" },
      { eventId: "h3", timestamp: T2, eventHash: "hash-ghi", previousHash: "WRONG-HASH" }, // break
    ]);
    const breaks = detectAnomalies(events).filter((a) => a.type === "hash_chain_break");
    assert.equal(breaks.length, 1);
  });

  it("first event with previousHash null → no false chain break", () => {
    const events = defineEvents([
      { eventId: "h1", timestamp: T, eventHash: "hash-abc", previousHash: null },
      { eventId: "h2", timestamp: T1, eventHash: "hash-def", previousHash: "hash-abc" },
    ]);
    assert.equal(detectAnomalies(events).filter((a) => a.type === "hash_chain_break").length, 0);
  });
});

// ---------------------------------------------------------------------------
// 6. Output structure invariants
// ---------------------------------------------------------------------------

describe("output structure", () => {
  it("every anomaly carries type, severity, reason, evidenceEventIds", () => {
    const events = defineEvents([
      { eventId: "s1", eventType: "action_denied" },
      { eventId: "s2", eventType: "action_denied" },
      { eventId: "s3", eventType: "action_denied" },
      { eventId: "s4", eventType: "action_denied" },
      { eventId: "s5", eventType: "action_denied" },
    ]);
    const baseline = defineEvents([
      { eventId: "b1", eventType: "policy_evaluated" },
    ]);
    const results = detectAnomalies(events, baseline);
    for (const a of results) {
      assert.ok(typeof a.type === "string" && a.type.length > 0);
      assert.ok(["info", "warning", "critical"].includes(a.severity));
      assert.ok(typeof a.reason === "string" && a.reason.length > 0);
      assert.ok(Array.isArray(a.evidenceEventIds));
      assert.ok(a.anomalyId.startsWith("anom_"));
    }
  });

  it("anomalyId is deterministic (same input → same id)", () => {
    const events1 = defineEvents([
      { eventId: "fix-1", eventType: "action_allowed", traceId: "t-fix", metadata: { requiresHumanReview: true } },
    ]);
    const events2 = defineEvents([
      { eventId: "fix-1", eventType: "action_allowed", traceId: "t-fix", metadata: { requiresHumanReview: true } },
    ]);
    const r1 = detectAnomalies(events1);
    const r2 = detectAnomalies(events2);
    if (r1.length > 0 && r2.length > 0) {
      assert.equal(r1[0]!.anomalyId, r2[0]!.anomalyId);
    }
  });

  it("sort order: critical before warning before info", () => {
    const events = defineEvents([
      { eventId: "dup-1", timestamp: T },
      { eventId: "dup-1", timestamp: T1 },
      { eventId: "s1", eventType: "action_denied" },
      { eventId: "s2", eventType: "action_denied" },
      { eventId: "s3", eventType: "action_denied" },
    ]);
    const baseline = defineEvents([
      { eventId: "b1", eventType: "policy_evaluated" },
    ]);
    const results = detectAnomalies(events, baseline);
    // All critical continuity anomalies should come before volume spikes (warning)
    let lastSeverity = 0;
    const order = { critical: 0, warning: 1, info: 2 };
    for (const a of results) {
      assert.ok(order[a.severity] >= lastSeverity);
      lastSeverity = order[a.severity];
    }
  });
});
