/**
 * Tests for P14.8 — Audit Inspection CLI Polish.
 *
 * Covers the pure format helpers (unit tests) and handler-level
 * filter/correlation behavior via integration with the audit store.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Module under test — P14.8 exported format helpers
// ---------------------------------------------------------------------------

import {
  formatMetadata,
  formatTimelineLine,
  computeRelatedEvents,
} from "../../src/cli/commands/governance.js";

// ---------------------------------------------------------------------------
// formatMetadata
// ---------------------------------------------------------------------------

describe("formatMetadata", () => {
  it("returns empty string for empty metadata", () => {
    assert.equal(formatMetadata({}), "");
  });

  it("renders scalar values as key: value", () => {
    const out = formatMetadata({ signalType: "trend_alert", confidence: 0.85 });
    assert.ok(out.includes("signalType: trend_alert"));
    assert.ok(out.includes("confidence: 0.85"));
  });

  it("renders null as dash", () => {
    const out = formatMetadata({ foo: null });
    assert.ok(out.includes("foo: -"));
  });

  it("renders undefined as dash", () => {
    const out = formatMetadata({ bar: undefined });
    assert.ok(out.includes("bar: -"));
  });

  it("falls back to JSON for nested objects", () => {
    const out = formatMetadata({ nested: { a: 1, b: [2] } });
    assert.ok(out.includes('nested: {"a":1,"b":[2]}'));
  });

  it("falls back to JSON for arrays", () => {
    const out = formatMetadata({ tags: ["a", "b"] });
    assert.ok(out.includes('tags: ["a","b"]'));
  });

  it("renders each key on its own line", () => {
    const out = formatMetadata({ a: "1", b: "2", c: "3" });
    const lines = out.split("\n").filter(Boolean);
    assert.equal(lines.length, 3);
  });
});

// ---------------------------------------------------------------------------
// formatTimelineLine
// ---------------------------------------------------------------------------

describe("formatTimelineLine", () => {
  function makeEvent(overrides: Partial<Parameters<typeof formatTimelineLine>[0]> = {}) {
    return {
      timestamp: "2026-07-07T14:00:00.000Z",
      eventType: "policy_evaluated",
      actorType: "system",
      actorId: "governance",
      subjectType: "signal",
      subjectId: "sig-001",
      traceId: null,
      decision: "allowed",
      ...overrides,
    };
  }

  it("includes timestamp (without subseconds or Z)", () => {
    const line = formatTimelineLine(makeEvent());
    assert.ok(line.startsWith("2026-07-07 14:00:00"));
  });

  it("includes eventType", () => {
    const line = formatTimelineLine(makeEvent({ eventType: "action_escalated" }));
    assert.ok(line.includes("action_escalated"));
  });

  it("includes actor type and id", () => {
    const line = formatTimelineLine(makeEvent({ actorType: "human", actorId: "alice" }));
    assert.ok(line.includes("human:alice"));
  });

  it("includes subjectType:subjectId when subjectId is present", () => {
    const line = formatTimelineLine(makeEvent({ subjectType: "proposal", subjectId: "prop-001" }));
    assert.ok(line.includes("proposal:prop-001"));
  });

  it("falls back to subjectType alone when subjectId is null", () => {
    const line = formatTimelineLine(makeEvent({ subjectType: "proposal", subjectId: null }));
    assert.ok(line.includes("proposal"));
    assert.ok(!line.includes("proposal:"));
  });

  it("uses traceId as tail when present", () => {
    const line = formatTimelineLine(makeEvent({ traceId: "trace-abc", decision: "allowed" }));
    assert.ok(line.includes("trace-abc"));
  });

  it("uses decision as tail when traceId is null", () => {
    const line = formatTimelineLine(makeEvent({ traceId: null, decision: "escalated" }));
    assert.ok(line.includes("escalated"));
  });
});

// ---------------------------------------------------------------------------
// computeRelatedEvents
// ---------------------------------------------------------------------------

describe("computeRelatedEvents", () => {
  type TestEvent = {
    eventId: string;
    traceId: string | null;
    sessionId: string | null;
    parentEventId: string | null;
    timestamp: string;
  };

  const FOCAL_ID = "evt-focal";

  function makeAll(overrides: Partial<TestEvent>[] = []): TestEvent[] {
    const base: TestEvent = {
      eventId: "evt-other",
      traceId: null,
      sessionId: null,
      parentEventId: null,
      timestamp: "2026-07-07T14:00:00.000Z",
    };
    return [
      { eventId: FOCAL_ID, traceId: null, sessionId: null, parentEventId: null, timestamp: "2026-07-07T14:00:00.000Z" },
      ...overrides.map((o) => ({ ...base, ...o })),
    ];
  }

  it("returns empty when focal event is not found", () => {
    assert.deepEqual(computeRelatedEvents([], "missing"), []);
  });

  it("returns empty when no events share trace/session/parent", () => {
    const all = makeAll([
      { eventId: "evt-1", traceId: "trace-other", sessionId: null, parentEventId: null, timestamp: "2026-07-07T14:05:00.000Z" },
    ]);
    assert.deepEqual(computeRelatedEvents(all, FOCAL_ID), []);
  });

  it("includes events with the same traceId", () => {
    const all = makeAll([
      { eventId: "evt-1", traceId: "trace-abc", sessionId: null, parentEventId: null, timestamp: "2026-07-07T14:05:00.000Z" },
    ]);
    (all.find((e) => e.eventId === FOCAL_ID)!).traceId = "trace-abc";
    const result = computeRelatedEvents(all, FOCAL_ID);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.eventId, "evt-1");
  });

  it("includes events with the same sessionId", () => {
    const all = makeAll([
      { eventId: "evt-session", traceId: null, sessionId: "sess-xyz", parentEventId: null, timestamp: "2026-07-07T14:05:00.000Z" },
    ]);
    (all.find((e) => e.eventId === FOCAL_ID)!).sessionId = "sess-xyz";
    const result = computeRelatedEvents(all, FOCAL_ID);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.eventId, "evt-session");
  });

  it("includes child events (parentEventId === focalId)", () => {
    const all = makeAll([
      { eventId: "evt-child", traceId: null, sessionId: null, parentEventId: FOCAL_ID, timestamp: "2026-07-07T14:05:00.000Z" },
    ]);
    const result = computeRelatedEvents(all, FOCAL_ID);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.eventId, "evt-child");
  });

  it("includes parent event (focal.parentEventId === other.eventId)", () => {
    const all = makeAll([
      { eventId: "evt-parent", traceId: null, sessionId: null, parentEventId: null, timestamp: "2026-07-07T13:55:00.000Z" },
    ]);
    (all.find((e) => e.eventId === FOCAL_ID)!).parentEventId = "evt-parent";
    const result = computeRelatedEvents(all, FOCAL_ID);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.eventId, "evt-parent");
  });

  it("de-duplicates events matching via multiple relations", () => {
    const all = makeAll([
      { eventId: "evt-dupe", traceId: "trace-dupe", sessionId: "sess-dupe", parentEventId: null, timestamp: "2026-07-07T14:05:00.000Z" },
    ]);
    const focal = all.find((e) => e.eventId === FOCAL_ID)!;
    focal.traceId = "trace-dupe";
    focal.sessionId = "sess-dupe";
    const result = computeRelatedEvents(all, FOCAL_ID);
    assert.equal(result.length, 1);
  });

  it("excludes the focal event itself", () => {
    const all = makeAll([]);
    const result = computeRelatedEvents(all, FOCAL_ID);
    assert.equal(result.length, 0);
  });

  it("returns events in chronological order", () => {
    const all = makeAll([
      { eventId: "evt-older", traceId: "trace-ord", sessionId: null, parentEventId: null, timestamp: "2026-07-07T13:00:00.000Z" },
      { eventId: "evt-newer", traceId: "trace-ord", sessionId: null, parentEventId: null, timestamp: "2026-07-07T15:00:00.000Z" },
    ]);
    (all.find((e) => e.eventId === FOCAL_ID)!).traceId = "trace-ord";
    const result = computeRelatedEvents(all, FOCAL_ID);
    assert.equal(result.length, 2);
    assert.equal(result[0]!.eventId, "evt-older");
    assert.equal(result[1]!.eventId, "evt-newer");
  });
});

// ---------------------------------------------------------------------------
// Handler-level integration: list filters + validation (via FileAuditStore)
// ---------------------------------------------------------------------------

describe("audit list filter integration", () => {
  /** Seed a real FileAuditStore with one known event. */
  function seedStore(dir: string): void {
    const event = {
      eventId: "aud-test-001",
      timestamp: "2026-07-07T14:00:00.000Z",
      eventType: "action_escalated",
      actorType: "system",
      actorId: "governance",
      subjectType: "proposal",
      subjectId: "prop-001",
      action: "escalate",
      decision: "escalated",
      policyId: null,
      policyVersion: null,
      ruleId: null,
      reason: "Test escalation",
      evidenceRefs: [],
      requestId: null,
      traceId: null,
      sessionId: null,
      parentEventId: null,
      riskLevel: "high",
      requiresHumanReview: true,
      metadata: {},
      previousHash: null,
      eventHash: "test-hash",
    };
    const storeDir = join(dir, ".alix", "governance");
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(storeDir, "governance-audit-events.jsonl"), JSON.stringify(event) + "\n", "utf8");
  }

  it("list query using store.list() returns seeded events", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gov-p148-list-"));
    try {
      seedStore(dir);
      const { FileAuditStore } = await import("../../src/governance/audit-store.js");
      const store = new FileAuditStore(dir);
      const events = await store.list();
      assert.equal(events.length, 1);
      assert.equal(events[0]!.eventId, "aud-test-001");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("event-type filter via .filter() produces correct result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gov-p148-filter-"));
    try {
      seedStore(dir);
      const { FileAuditStore } = await import("../../src/governance/audit-store.js");
      const store = new FileAuditStore(dir);
      const events = await store.list();
      const filtered = events.filter((e) => e.eventType === "action_escalated");
      assert.equal(filtered.length, 1);
      assert.equal(filtered.filter((e) => e.eventType === "policy_evaluated").length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("subject filter matches subjectId", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gov-p148-subject-"));
    try {
      seedStore(dir);
      const { FileAuditStore } = await import("../../src/governance/audit-store.js");
      const store = new FileAuditStore(dir);
      const events = await store.list();
      const filtered = events.filter((e) => e.subjectId === "prop-001" || (e.subjectType as string) === "prop-001");
      assert.equal(filtered.length, 1);
      assert.equal(filtered.filter((e) => e.subjectId === "nonexistent" || (e.subjectType as string) === "nonexistent").length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("risk filter using exact match", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gov-p148-risk-"));
    try {
      seedStore(dir);
      const { FileAuditStore } = await import("../../src/governance/audit-store.js");
      const store = new FileAuditStore(dir);
      const events = await store.list();
      assert.equal(events.filter((e) => e.riskLevel === "high").length, 1);
      assert.equal(events.filter((e) => e.riskLevel === "low").length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// show --related integration (against a real FileAuditStore)
// ---------------------------------------------------------------------------

describe("show --related integration", () => {
  function seedTwoRelated(dir: string, focalId: string): void {
    const traceId = "trace-abc";
    const storeDir = join(dir, ".alix", "governance");
    mkdirSync(storeDir, { recursive: true });
    const storeFile = join(storeDir, "governance-audit-events.jsonl");

    // Write events newest-first to test chronological ordering of computeRelatedEvents
    const events = [
      {
        eventId: "evt-older",
        timestamp: "2026-07-07T13:00:00.000Z",
        eventType: "policy_evaluated",
        actorType: "system",
        actorId: "governance",
        subjectType: "signal",
        subjectId: "sig-001",
        action: "evaluate",
        decision: "allowed",
        policyId: null, policyVersion: null, ruleId: null,
        reason: "Older event",
        evidenceRefs: [],
        requestId: null, traceId, sessionId: null, parentEventId: null,
        riskLevel: "low",
        requiresHumanReview: false,
        metadata: {},
        previousHash: null, eventHash: "hash-older",
      },
      {
        eventId: focalId,
        timestamp: "2026-07-07T14:00:00.000Z",
        eventType: "action_escalated",
        actorType: "system",
        actorId: "governance",
        subjectType: "proposal",
        subjectId: "prop-001",
        action: "escalate",
        decision: "escalated",
        policyId: null, policyVersion: null, ruleId: null,
        reason: "Focal event",
        evidenceRefs: [],
        requestId: null, traceId, sessionId: null, parentEventId: null,
        riskLevel: "high",
        requiresHumanReview: true,
        metadata: {},
        previousHash: null, eventHash: "hash-focal",
      },
      {
        eventId: "evt-newer",
        timestamp: "2026-07-07T15:00:00.000Z",
        eventType: "override_applied",
        actorType: "human",
        actorId: "operator",
        subjectType: "proposal",
        subjectId: "prop-001",
        action: "mark_executed",
        decision: "overridden",
        policyId: null, policyVersion: null, ruleId: null,
        reason: "Newer event",
        evidenceRefs: [],
        requestId: null, traceId, sessionId: null, parentEventId: null,
        riskLevel: "medium",
        requiresHumanReview: false,
        metadata: {},
        previousHash: null, eventHash: "hash-newer",
      },
    ];
    writeFileSync(storeFile, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  }

  it("computeRelatedEvents on real store data returns chronological order", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gov-p148-rel-"));
    try {
      const focalId = "aud-focal";
      seedTwoRelated(dir, focalId);

      const { FileAuditStore } = await import("../../src/governance/audit-store.js");
      const store = new FileAuditStore(dir);
      const all = await store.list();

      const result = computeRelatedEvents(all, focalId);
      assert.equal(result.length, 2);
      // Older should come first (chronological oldest→newest in computeRelatedEvents)
      assert.equal(result[0]!.eventId, "evt-older");
      assert.equal(result[1]!.eventId, "evt-newer");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
