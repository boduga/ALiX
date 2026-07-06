/**
 * Tests P14.5a — Governance Audit Trail Core.
 *
 * Covers types, hash computation, store, chain verification, and query helpers.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import {
  validateAuditEvent,
  validateAuditEventInput,
  type GovernanceAuditEvent,
  type GovernanceAuditEventInput,
  type GovernanceEventType,
  type ActorType,
  type SubjectType,
  type GovernanceDecision,
  type RiskLevel,
} from "../../src/governance/audit-types.js";

import {
  FileAuditStore,
  computeEventHash,
} from "../../src/governance/audit-store.js";

import {
  verifyChain,
  findBrokenLinks,
  recomputeEventHash,
} from "../../src/governance/audit-chain.js";

import {
  queryByActor,
  queryByPolicy,
  queryByTraceId,
  queryByDecision,
  queryByTimeRange,
} from "../../src/governance/audit-query.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOW = "2026-07-06T14:00:00.000Z";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function validEventInput(
  overrides: Partial<GovernanceAuditEventInput> = {},
): GovernanceAuditEventInput {
  return {
    eventId: "aud-ev-001",
    timestamp: NOW,
    eventType: "policy_evaluated",
    actorType: "policy_engine",
    actorId: "engine-v1",
    subjectType: "policy",
    subjectId: "pol-auto-approve",
    action: "evaluate_run_risk",
    decision: "allowed",
    policyId: "run-approval-policy",
    policyVersion: "1.2",
    ruleId: null,
    reason: "Run risk below threshold",
    evidenceRefs: ["sig-risk-001", "dec-run-001"],
    requestId: "req-abc-123",
    traceId: "trace-run-001",
    sessionId: "sess-auto-007",
    parentEventId: null,
    riskLevel: "low",
    requiresHumanReview: false,
    metadata: { runId: "run-042", riskScore: 0.15 },
    ...overrides,
  };
}

function validEvent(
  overrides: Partial<GovernanceAuditEvent> = {},
  previousHash: string | null = null,
): GovernanceAuditEvent {
  const input = validEventInput(overrides as Partial<GovernanceAuditEventInput>);
  const body = { ...input, previousHash };
  const eventHash = computeEventHash(body);
  return {
    ...input,
    ...overrides,
    previousHash,
    eventHash,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "gov-audit-test-"));
}

function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function setupStore(): { store: FileAuditStore; cleanup: () => void } {
  const dir = makeTempDir();
  return {
    store: new FileAuditStore(dir),
    cleanup: () => cleanupTempDir(dir),
  };
}

// ---------------------------------------------------------------------------
// validateAuditEventInput
// ---------------------------------------------------------------------------

describe("validateAuditEventInput", () => {
  it("accepts valid input", () => {
    const result = validateAuditEventInput(validEventInput());
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("rejects non-object", () => {
    const result = validateAuditEventInput("not-an-object");
    assert.equal(result.valid, false);
  });

  it("rejects empty object", () => {
    const result = validateAuditEventInput({});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("eventId")));
  });

  it("rejects missing eventId", () => {
    const result = validateAuditEventInput(validEventInput({ eventId: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("eventId")));
  });

  it("rejects invalid eventType", () => {
    const result = validateAuditEventInput(
      validEventInput({ eventType: "invalid_type" as GovernanceEventType }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("eventType")));
  });

  it("rejects invalid actorType", () => {
    const result = validateAuditEventInput(
      validEventInput({ actorType: "robot" as ActorType }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("actorType")));
  });

  it("rejects missing actorId", () => {
    const result = validateAuditEventInput(validEventInput({ actorId: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("actorId")));
  });

  it("rejects invalid subjectType", () => {
    const result = validateAuditEventInput(
      validEventInput({ subjectType: "unknown" as SubjectType }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("subjectType")));
  });

  it("rejects invalid decision", () => {
    const result = validateAuditEventInput(
      validEventInput({ decision: "maybe" as GovernanceDecision }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("decision")));
  });

  it("rejects missing reason", () => {
    const result = validateAuditEventInput(validEventInput({ reason: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("reason")));
  });

  it("rejects non-array evidenceRefs", () => {
    const result = validateAuditEventInput(
      validEventInput({ evidenceRefs: "not-an-array" as unknown as string[] }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("evidenceRefs")));
  });

  it("rejects non-boolean requiresHumanReview", () => {
    const result = validateAuditEventInput(
      validEventInput({ requiresHumanReview: "yes" as unknown as boolean }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("requiresHumanReview")));
  });

  it("rejects non-object metadata", () => {
    const result = validateAuditEventInput(
      validEventInput({ metadata: "string" as unknown as Record<string, unknown> }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("metadata")));
  });

  it("rejects invalid riskLevel", () => {
    const result = validateAuditEventInput(
      validEventInput({ riskLevel: "extreme" as RiskLevel }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("riskLevel")));
  });

  it("accepts null optional fields", () => {
    const input = validEventInput({
      subjectId: null,
      policyId: null,
      policyVersion: null,
      ruleId: null,
      requestId: null,
      traceId: null,
      sessionId: null,
      parentEventId: null,
    });
    const result = validateAuditEventInput(input);
    assert.equal(result.valid, true);
  });
});

// ---------------------------------------------------------------------------
// validateAuditEvent
// ---------------------------------------------------------------------------

describe("validateAuditEvent", () => {
  it("accepts valid event with hashes", () => {
    const event = validEvent();
    const result = validateAuditEvent(event);
    assert.equal(result.valid, true);
  });

  it("rejects missing eventHash", () => {
    const { eventHash: _, ...eventWithoutHash } = validEvent();
    const result = validateAuditEvent(eventWithoutHash as GovernanceAuditEvent);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("eventHash")));
  });

  it("accepts null previousHash", () => {
    const event = validEvent({}, null);
    const result = validateAuditEvent(event);
    assert.equal(result.valid, true);
  });

  it("accepts string previousHash", () => {
    const first = validEvent({ eventId: "first" }, null);
    const second = validEvent(
      { eventId: "second" },
      first.eventHash,
    );
    const result = validateAuditEvent(second);
    assert.equal(result.valid, true);
  });
});

// ---------------------------------------------------------------------------
// computeEventHash
// ---------------------------------------------------------------------------

describe("computeEventHash", () => {
  it("is deterministic for same input", () => {
    const body = { foo: "bar", num: 42 };
    const h1 = computeEventHash(body);
    const h2 = computeEventHash(body);
    assert.equal(h1, h2);
  });

  it("changes when payload changes", () => {
    const h1 = computeEventHash({ value: "a" });
    const h2 = computeEventHash({ value: "b" });
    assert.notEqual(h1, h2);
  });

  it("produces 64-char hex string (SHA-256)", () => {
    const hash = computeEventHash({ test: "data" });
    assert.equal(hash.length, 64);
    assert.match(hash, /^[a-f0-9]{64}$/);
  });

  it("is affected by previousHash field", () => {
    const h1 = computeEventHash({ action: "test", previousHash: null });
    const h2 = computeEventHash({ action: "test", previousHash: "abc" });
    assert.notEqual(h1, h2);
  });

  it("produces consistent hash across same input with sorted keys", () => {
    const h1 = computeEventHash({ z: 1, a: 2, m: 3 });
    const h2 = computeEventHash({ a: 2, m: 3, z: 1 });
    assert.equal(h1, h2);
  });
});

// ---------------------------------------------------------------------------
// FileAuditStore — append and read
// ---------------------------------------------------------------------------

describe("FileAuditStore", () => {
  describe("append and list", () => {
    it("appends and returns event with computed hashes", async () => {
      const { store, cleanup } = setupStore();
      try {
        const input = validEventInput();
        const event = await store.append(input);

        assert.equal(event.eventId, input.eventId);
        assert.equal(event.previousHash, null);
        assert.equal(event.eventHash.length, 64);
        assert.match(event.eventHash, /^[a-f0-9]{64}$/);

        // Verify hash is deterministic for same payload
        const expectedHash = computeEventHash({
          ...input,
          previousHash: null,
        });
        assert.equal(event.eventHash, expectedHash);
      } finally {
        cleanup();
      }
    });

    it("chains events: second event links to first", async () => {
      const { store, cleanup } = setupStore();
      try {
        const ev1 = await store.append(
          validEventInput({ eventId: "first" }),
        );
        const ev2 = await store.append(
          validEventInput({ eventId: "second" }),
        );

        assert.equal(ev1.previousHash, null);
        assert.equal(ev2.previousHash, ev1.eventHash);
      } finally {
        cleanup();
      }
    });

    it("lists events newest-first", async () => {
      const { store, cleanup } = setupStore();
      try {
        await store.append(validEventInput({ eventId: "ev-1" }));
        await store.append(validEventInput({ eventId: "ev-2" }));
        await store.append(validEventInput({ eventId: "ev-3" }));

        const events = await store.list();
        assert.equal(events.length, 3);
        assert.equal(events[0].eventId, "ev-3");
        assert.equal(events[2].eventId, "ev-1");
      } finally {
        cleanup();
      }
    });

    it("lists chronological (oldest first)", async () => {
      const { store, cleanup } = setupStore();
      try {
        await store.append(validEventInput({ eventId: "ev-1" }));
        await store.append(validEventInput({ eventId: "ev-2" }));

        const events = await store.listChronological();
        assert.equal(events.length, 2);
        assert.equal(events[0].eventId, "ev-1");
        assert.equal(events[1].eventId, "ev-2");
      } finally {
        cleanup();
      }
    });

    it("returns empty list for empty store", async () => {
      const { store, cleanup } = setupStore();
      try {
        const events = await store.list();
        assert.equal(events.length, 0);
      } finally {
        cleanup();
      }
    });
  });

  describe("getById", () => {
    it("returns matching event", async () => {
      const { store, cleanup } = setupStore();
      try {
        await store.append(validEventInput({ eventId: "ev-find-me" }));
        const found = await store.getById("ev-find-me");
        assert.notEqual(found, null);
        assert.equal(found!.eventId, "ev-find-me");
      } finally {
        cleanup();
      }
    });

    it("returns null for missing event", async () => {
      const { store, cleanup } = setupStore();
      try {
        const found = await store.getById("does-not-exist");
        assert.equal(found, null);
      } finally {
        cleanup();
      }
    });
  });

  describe("size", () => {
    it("returns 0 for empty store", async () => {
      const { store, cleanup } = setupStore();
      try {
        assert.equal(await store.size(), 0);
      } finally {
        cleanup();
      }
    });

    it("returns event count after appends", async () => {
      const { store, cleanup } = setupStore();
      try {
        await store.append(validEventInput({ eventId: "a" }));
        await store.append(validEventInput({ eventId: "b" }));
        assert.equal(await store.size(), 2);
      } finally {
        cleanup();
      }
    });
  });

  describe("append-only invariant", () => {
    it("rejects invalid input", async () => {
      const { store, cleanup } = setupStore();
      try {
        const badInput = validEventInput({ eventId: "" });
        await assert.rejects(
          () => store.append(badInput),
          /Invalid audit event/,
        );
      } finally {
        cleanup();
      }
    });

    it("creates directory on first append", async () => {
      const { store, cleanup } = setupStore();
      try {
        const dir = makeTempDir();
        const isolated = new FileAuditStore(dir);
        await isolated.append(validEventInput());
        assert.equal(existsSync(join(dir, ".alix", "governance")), true);
        cleanupTempDir(dir);
      } finally {
        cleanup();
      }
    });

    it("skips malformed JSONL lines on read", async () => {
      // Manual setup: write a malformed line to the JSONL file
      const dir = makeTempDir();
      try {
        const store = new FileAuditStore(dir);

        // Append a valid event
        await store.append(validEventInput({ eventId: "valid-1" }));

        // Manually append a malformed line
        const { appendFileSync } = await import("node:fs");
        const storePath = join(dir, ".alix", "governance", "governance-audit-events.jsonl");
        appendFileSync(storePath, "not-json\n", "utf8");

        // Append another valid event
        await store.append(validEventInput({ eventId: "valid-2" }));

        const events = await store.list();
        assert.equal(events.length, 2);
        assert.equal(events[0].eventId, "valid-2");
        assert.equal(events[1].eventId, "valid-1");
      } finally {
        cleanupTempDir(dir);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Chain verification
// ---------------------------------------------------------------------------

describe("verifyChain", () => {
  it("passes for valid chain", () => {
    const ev1 = validEvent({ eventId: "ev-1" }, null);
    const ev2 = validEvent({ eventId: "ev-2" }, ev1.eventHash);
    const ev3 = validEvent({ eventId: "ev-3" }, ev2.eventHash);

    const result = verifyChain([ev1, ev2, ev3]);
    assert.equal(result.valid, true);
    assert.equal(result.findings.length, 0);
    assert.equal(result.eventCount, 3);
  });

  it("passes for empty chain", () => {
    const result = verifyChain([]);
    assert.equal(result.valid, true);
    assert.equal(result.eventCount, 0);
  });

  it("passes for single event", () => {
    const ev1 = validEvent({ eventId: "ev-1" }, null);
    const result = verifyChain([ev1]);
    assert.equal(result.valid, true);
  });

  it("fails when event hash is tampered", () => {
    const ev1 = validEvent({ eventId: "ev-1" }, null);
    const ev2 = validEvent({ eventId: "ev-2" }, ev1.eventHash);
    // Tamper with ev2's eventHash
    ev2.eventHash = "0000000000000000000000000000000000000000000000000000000000000000";

    const result = verifyChain([ev1, ev2]);
    assert.equal(result.valid, false);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].type, "hash_mismatch");
    assert.equal(result.findings[0].eventId, "ev-2");
  });

  it("fails when previousHash is broken", () => {
    const ev1 = validEvent({ eventId: "ev-1" }, null);
    const ev2 = validEvent({ eventId: "ev-2" }, ev1.eventHash);
    // Tamper with ev1's eventHash (breaks ev2's previousHash)
    ev1.eventHash = "0000000000000000000000000000000000000000000000000000000000000000";

    const result = verifyChain([ev1, ev2]);
    assert.equal(result.valid, false);
    assert.equal(result.findings.length, 2); // ev1 hash mismatch + ev2 prev hash break
    assert.ok(result.findings.some((f) => f.type === "hash_mismatch"));
    assert.ok(result.findings.some((f) => f.type === "previous_hash_break"));
  });

  it("fails when first event has non-null previousHash", () => {
    const ev1 = validEvent({ eventId: "ev-1" }, null);
    ev1.previousHash = "some-fake-hash";

    const result = verifyChain([ev1]);
    assert.equal(result.valid, false);
    // Tampering previousHash also breaks the event hash, so we may get
    // hash_mismatch AND previous_hash_break. Check for at least one.
    assert.ok(
      result.findings.some((f) => f.type === "previous_hash_break"),
      "Expected at least one previous_hash_break finding",
    );
  });

  it("fails when non-first event has null previousHash", () => {
    const ev1 = validEvent({ eventId: "ev-1" }, null);
    const ev2 = validEvent({ eventId: "ev-2" }, null); // Chain break

    const result = verifyChain([ev1, ev2]);
    assert.equal(result.valid, false);
    assert.ok(result.findings.some((f) => f.type === "chain_break"));
  });

  it("reports all broken links", () => {
    const ev1 = validEvent({ eventId: "ev-1" }, null);
    const ev2 = validEvent({ eventId: "ev-2" }, ev1.eventHash);
    const ev3 = validEvent({ eventId: "ev-3" }, ev2.eventHash);

    // Tamper with all three
    ev1.eventHash = "1111111111111111111111111111111111111111111111111111111111111111";
    ev2.previousHash = "2222222222222222222222222222222222222222222222222222222222222222";
    ev3.eventHash = "3333333333333333333333333333333333333333333333333333333333333333";

    const broken = findBrokenLinks([ev1, ev2, ev3]);
    // Tampering each event creates findings for both hash mismatches and
    // broken previousHash links. We verify all 3 events are represented.
    const uniqueBroken = new Set(broken.map((f) => f.eventId));
    assert.equal(uniqueBroken.size, 3);
    assert.ok(uniqueBroken.has("ev-1"));
    assert.ok(uniqueBroken.has("ev-2"));
    assert.ok(uniqueBroken.has("ev-3"));
  });
});

describe("recomputeEventHash", () => {
  it("matches original eventHash for unmodified event", () => {
    const event = validEvent({ eventId: "hash-test" }, null);
    const recomputed = recomputeEventHash(event);
    assert.equal(recomputed, event.eventHash);
  });

  it("differs after payload modification", () => {
    const event = validEvent({ eventId: "hash-mod" }, null);
    const originalHash = recomputeEventHash(event);
    // Modify payload
    event.reason = "Modified reason";
    const modifiedHash = recomputeEventHash(event);
    assert.notEqual(modifiedHash, originalHash);
    assert.notEqual(modifiedHash, event.eventHash);
  });
});

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

describe("queryByActor", () => {
  it("filters by actor type", () => {
    const events = [
      validEvent({ eventId: "e1", actorType: "policy_engine" }),
      validEvent({ eventId: "e2", actorType: "human" }),
      validEvent({ eventId: "e3", actorType: "policy_engine" }),
    ];
    const result = queryByActor(events, "policy_engine");
    assert.equal(result.length, 2);
    assert.equal(result[0].eventId, "e1");
    assert.equal(result[1].eventId, "e3");
  });

  it("filters by actor type and ID", () => {
    const events = [
      validEvent({ eventId: "e1", actorType: "human", actorId: "alice" }),
      validEvent({ eventId: "e2", actorType: "human", actorId: "bob" }),
      validEvent({ eventId: "e3", actorType: "system", actorId: "cron" }),
    ];
    const result = queryByActor(events, "human", "alice");
    assert.equal(result.length, 1);
    assert.equal(result[0].eventId, "e1");
  });

  it("returns empty for no match", () => {
    const events = [
      validEvent({ eventId: "e1", actorType: "human" }),
    ];
    const result = queryByActor(events, "policy_engine");
    assert.equal(result.length, 0);
  });
});

describe("queryByPolicy", () => {
  it("filters by policy ID", () => {
    const events = [
      validEvent({ eventId: "e1", policyId: "policy-a" }),
      validEvent({ eventId: "e2", policyId: "policy-b" }),
      validEvent({ eventId: "e3", policyId: "policy-a" }),
    ];
    const result = queryByPolicy(events, "policy-a");
    assert.equal(result.length, 2);
    assert.equal(result[0].eventId, "e1");
    assert.equal(result[1].eventId, "e3");
  });

  it("matches null policyId correctly", () => {
    const events = [
      validEvent({ eventId: "e1", policyId: null }),
      validEvent({ eventId: "e2", policyId: "policy-b" }),
    ];
    // queryByPolicy only matches string policyId, not null
    const result = queryByPolicy(events, null as unknown as string);
    assert.equal(result.length, 0);
  });
});

describe("queryByTraceId", () => {
  it("filters by trace ID", () => {
    const events = [
      validEvent({ eventId: "e1", traceId: "trace-001" }),
      validEvent({ eventId: "e2", traceId: "trace-002" }),
      validEvent({ eventId: "e3", traceId: "trace-001" }),
    ];
    const result = queryByTraceId(events, "trace-001");
    assert.equal(result.length, 2);
  });
});

describe("queryByDecision", () => {
  it("filters by decision", () => {
    const events = [
      validEvent({ eventId: "e1", decision: "allowed" }),
      validEvent({ eventId: "e2", decision: "denied" }),
      validEvent({ eventId: "e3", decision: "allowed" }),
    ];
    const result = queryByDecision(events, "denied");
    assert.equal(result.length, 1);
    assert.equal(result[0].eventId, "e2");
  });
});

describe("queryByTimeRange", () => {
  const baseTs = "2026-07-06T12:00:00.000Z";
  const midTs = "2026-07-06T13:00:00.000Z";
  const lateTs = "2026-07-06T14:00:00.000Z";

  it("filters by range (inclusive)", () => {
    const events = [
      validEvent({ eventId: "e1", timestamp: baseTs }),
      validEvent({ eventId: "e2", timestamp: midTs }),
      validEvent({ eventId: "e3", timestamp: lateTs }),
    ];
    const result = queryByTimeRange(events, baseTs, midTs);
    assert.equal(result.length, 2);
    assert.equal(result[0].eventId, "e1");
    assert.equal(result[1].eventId, "e2");
  });

  it("returns all when no bounds given", () => {
    const events = [
      validEvent({ eventId: "e1", timestamp: baseTs }),
      validEvent({ eventId: "e2", timestamp: lateTs }),
    ];
    const result = queryByTimeRange(events);
    assert.equal(result.length, 2);
  });

  it("filters from start only", () => {
    const events = [
      validEvent({ eventId: "e1", timestamp: baseTs }),
      validEvent({ eventId: "e2", timestamp: midTs }),
    ];
    const result = queryByTimeRange(events, midTs);
    assert.equal(result.length, 1);
    assert.equal(result[0].eventId, "e2");
  });

  it("filters to end only", () => {
    const events = [
      validEvent({ eventId: "e1", timestamp: baseTs }),
      validEvent({ eventId: "e2", timestamp: lateTs }),
    ];
    const result = queryByTimeRange(events, undefined, baseTs);
    assert.equal(result.length, 1);
    assert.equal(result[0].eventId, "e1");
  });
});
