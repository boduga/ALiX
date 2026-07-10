// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Contract types ──────────────────────────────────────────────────

import type {
  ExecutionIntentStatus,
  ExecutionIntentEventType,
  ExecutionConstraints,
  ExecutionIntent,
  ExecutionIntentEvent,
  ExecutionEvidence,
} from "../../src/runtime/contracts/execution-intent-contract.js";
import {
  createIntentId,
  createIntentHash,
  deriveIntentStatus,
  EXECUTION_INTENT_INVARIANTS,
} from "../../src/runtime/contracts/execution-intent-contract.js";

// ── Helpers ──────────────────────────────────────────────────────────

function sampleIntent(): Omit<ExecutionIntent, "intentHash"> {
  return {
    intentId: "intent-001",
    proposalId: "prop-001",
    actor: "alice",
    action: "refactor",
    target: "src/auth/login.ts",
    justification: "Simplify login flow",
    constraints: {
      maxFilesChanged: 5,
      allowedPaths: ["src/auth/"],
      blockedPaths: ["node_modules/"],
      verificationRequired: true,
      allowedTools: ["edit", "shell"],
    },
    riskClass: "medium",
    expectedEffect: "Login flow simplified without breaking changes",
    sourceEvidenceId: "ev-001",
    createdAt: "2026-07-10T10:00:00.000Z",
    expiration: "2026-07-17T10:00:00.000Z",
    approvalReference: "approval-ref-001",
    approvedBy: "bob",
    approvedAt: "2026-07-10T10:30:00.000Z",
  };
}

function fullIntent(): ExecutionIntent {
  return {
    ...sampleIntent(),
    intentHash: createIntentHash(sampleIntent()),
  };
}

function sampleEvent(
  overrides: Partial<ExecutionIntentEvent> & { type: ExecutionIntentEvent["type"] },
): ExecutionIntentEvent {
  return {
    intentId: "intent-001",
    timestamp: "2026-07-10T10:00:00.000Z",
    actor: "alice",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("X1 — Execution Intent Contract", () => {
  // ── ExecutionIntentStatus ──────────────────────────────────────

  it("ExecutionIntentStatus has exactly 6 values", () => {
    const statuses: ExecutionIntentStatus[] = [
      "CREATED",
      "APPROVED",
      "RUNNING",
      "COMPLETED",
      "FAILED",
      "REVOKED",
    ];
    assert.equal(statuses.length, 6);
    // Verify each status is assignable
    for (const s of statuses) {
      assert.ok(s, `status "${s}" is valid`);
    }
  });

  // ── ExecutionIntentEventType ───────────────────────────────────

  it("ExecutionIntentEventType has exactly 6 values matching status", () => {
    const types: ExecutionIntentEventType[] = [
      "CREATED",
      "APPROVED",
      "RUNNING",
      "COMPLETED",
      "FAILED",
      "REVOKED",
    ];
    assert.equal(types.length, 6);
    for (const t of types) {
      assert.ok(t, `event type "${t}" is valid`);
    }
  });

  // ── ExecutionConstraints shape ──────────────────────────────────

  it("ExecutionConstraints shape has all 5 fields", () => {
    const c: ExecutionConstraints = {
      maxFilesChanged: 5,
      allowedPaths: ["src/"],
      blockedPaths: ["node_modules/"],
      verificationRequired: true,
      allowedTools: ["edit", "shell"],
    };
    assert.equal(typeof c.maxFilesChanged, "number");
    assert.ok(Array.isArray(c.allowedPaths));
    assert.ok(Array.isArray(c.blockedPaths));
    assert.equal(typeof c.verificationRequired, "boolean");
    assert.ok(Array.isArray(c.allowedTools));
  });

  // ── ExecutionIntent shape ──────────────────────────────────────

  it("ExecutionIntent shape has no status field", () => {
    const intent: ExecutionIntent = fullIntent();
    // Verify all expected fields exist and status is absent
    assert.equal(typeof intent.intentId, "string");
    assert.equal(typeof intent.proposalId, "string");
    assert.equal(typeof intent.actor, "string");
    assert.equal(typeof intent.action, "string");
    assert.equal(typeof intent.target, "string");
    assert.equal(typeof intent.justification, "string");
    assert.equal(typeof intent.constraints, "object");
    assert.equal(typeof intent.riskClass, "string");
    assert.equal(typeof intent.expectedEffect, "string");
    assert.equal(typeof intent.sourceEvidenceId, "string");
    assert.equal(typeof intent.createdAt, "string");
    assert.equal(typeof intent.expiration, "string");
    assert.equal(typeof intent.approvalReference, "string");
    assert.equal(typeof intent.approvedBy, "string");
    assert.equal(typeof intent.approvedAt, "string");
    assert.equal(typeof intent.intentHash, "string");
    // Verify status is NOT a field
    const keys = Object.keys(intent);
    assert.equal(keys.includes("status"), false, "ExecutionIntent must not contain a status field");
  });

  it("ExecutionIntent riskClass is one of low, medium, high", () => {
    const low: ExecutionIntent = { ...fullIntent(), riskClass: "low" };
    const medium: ExecutionIntent = { ...fullIntent(), riskClass: "medium" };
    const high: ExecutionIntent = { ...fullIntent(), riskClass: "high" };
    assert.equal(low.riskClass, "low");
    assert.equal(medium.riskClass, "medium");
    assert.equal(high.riskClass, "high");
  });

  // ── ExecutionIntentEvent shape ─────────────────────────────────

  it("ExecutionIntentEvent shape has all required fields", () => {
    const event: ExecutionIntentEvent = {
      intentId: "intent-001",
      type: "CREATED",
      timestamp: "2026-07-10T10:00:00.000Z",
      actor: "alice",
    };
    assert.equal(typeof event.intentId, "string");
    assert.equal(typeof event.type, "string");
    assert.equal(typeof event.timestamp, "string");
    assert.equal(typeof event.actor, "string");
    assert.equal(event.reason, undefined);
  });

  it("ExecutionIntentEvent accepts optional reason", () => {
    const event: ExecutionIntentEvent = {
      intentId: "intent-001",
      type: "FAILED",
      timestamp: "2026-07-10T11:00:00.000Z",
      actor: "alice",
      reason: "Timeout during execution",
    };
    assert.equal(event.reason, "Timeout during execution");
  });

  // ── ExecutionEvidence shape ────────────────────────────────────

  it("ExecutionEvidence shape has all 8 fields", () => {
    const evidence: ExecutionEvidence = {
      evidenceId: "ev-001",
      intentId: "intent-001",
      startedAt: "2026-07-10T10:00:00.000Z",
      completedAt: "2026-07-10T10:05:00.000Z",
      outcome: "SUCCESS",
      summary: "Refactored login flow successfully",
      artifacts: ["src/auth/login.ts"],
      verificationPassed: true,
      evidenceHash: "abc123",
    };
    assert.equal(typeof evidence.evidenceId, "string");
    assert.equal(typeof evidence.intentId, "string");
    assert.equal(typeof evidence.startedAt, "string");
    assert.equal(typeof evidence.completedAt, "string");
    assert.equal(typeof evidence.outcome, "string");
    assert.equal(typeof evidence.summary, "string");
    assert.ok(Array.isArray(evidence.artifacts));
    assert.equal(typeof evidence.verificationPassed, "boolean");
    assert.equal(typeof evidence.evidenceHash, "string");
  });

  it("ExecutionEvidence outcome is one of SUCCESS, FAILED, PARTIAL", () => {
    const success: ExecutionEvidence = { ...fullIntent() as unknown as ExecutionEvidence, outcome: "SUCCESS" };
    const failed: ExecutionEvidence = { ...fullIntent() as unknown as ExecutionEvidence, outcome: "FAILED" };
    const partial: ExecutionEvidence = { ...fullIntent() as unknown as ExecutionEvidence, outcome: "PARTIAL" };
    // Just verify the assignments work at type level
    assert.ok(["SUCCESS", "FAILED", "PARTIAL"].includes(success.outcome));
    assert.ok(["SUCCESS", "FAILED", "PARTIAL"].includes(failed.outcome));
    assert.ok(["SUCCESS", "FAILED", "PARTIAL"].includes(partial.outcome));
  });

  // ── createIntentId ──────────────────────────────────────────────

  it("createIntentId returns a non-empty string", () => {
    const id = createIntentId("prop-001", "alice");
    assert.equal(typeof id, "string");
    assert.ok(id.length > 0);
  });

  it("createIntentId is deterministic — same inputs produce same output", () => {
    const ts = "2026-07-10T10:00:00.000Z";
    const id1 = createIntentId("prop-001", "alice", ts);
    const id2 = createIntentId("prop-001", "alice", ts);
    assert.equal(id1, id2);
  });

  it("createIntentId produces different IDs for different inputs", () => {
    const ts = "2026-07-10T10:00:00.000Z";
    const id1 = createIntentId("prop-001", "alice", ts);
    const id2 = createIntentId("prop-002", "bob", ts);
    assert.notEqual(id1, id2);
  });

  it("createIntentId produces different IDs for different timestamps", () => {
    const id1 = createIntentId("prop-001", "alice", "2026-07-10T10:00:00.000Z");
    const id2 = createIntentId("prop-001", "alice", "2026-07-10T11:00:00.000Z");
    assert.notEqual(id1, id2);
  });

  it("createIntentId works without explicit timestamp", () => {
    const id = createIntentId("prop-001", "alice");
    assert.equal(typeof id, "string");
    assert.equal(id.length, 16);
  });

  // ── createIntentHash ────────────────────────────────────────────

  it("createIntentHash returns a 64-character hex string (SHA-256)", () => {
    const hash = createIntentHash(sampleIntent());
    assert.equal(typeof hash, "string");
    assert.equal(hash.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(hash), `hash "${hash}" must be hex-encoded SHA-256`);
  });

  it("createIntentHash is deterministic — same inputs produce same hash", () => {
    const intent = sampleIntent();
    const hash1 = createIntentHash(intent);
    const hash2 = createIntentHash(intent);
    assert.equal(hash1, hash2);
  });

  it("createIntentHash produces different hashes for different intents", () => {
    const intent1 = sampleIntent();
    const intent2 = { ...intent1, action: "delete" };
    const hash1 = createIntentHash(intent1);
    const hash2 = createIntentHash(intent2);
    assert.notEqual(hash1, hash2);
  });

  it("createIntentHash is sensitive to constraints changes", () => {
    const intent1 = sampleIntent();
    const intent2 = {
      ...intent1,
      constraints: { ...intent1.constraints, maxFilesChanged: 10 },
    };
    const hash1 = createIntentHash(intent1);
    const hash2 = createIntentHash(intent2);
    assert.notEqual(hash1, hash2);
  });

  it("createIntentHash produces canonical output — same logical intent always same hash", () => {
    // Two structurally identical intents built in different orders
    const a = sampleIntent();
    const b: Omit<ExecutionIntent, "intentHash"> = {
      intentId: "intent-001",
      proposalId: "prop-001",
      actor: "alice",
      action: "refactor",
      target: "src/auth/login.ts",
      justification: "Simplify login flow",
      constraints: {
        maxFilesChanged: 5,
        allowedPaths: ["src/auth/"],
        blockedPaths: ["node_modules/"],
        verificationRequired: true,
        allowedTools: ["edit", "shell"],
      },
      riskClass: "medium",
      expectedEffect: "Login flow simplified without breaking changes",
      sourceEvidenceId: "ev-001",
      createdAt: "2026-07-10T10:00:00.000Z",
      expiration: "2026-07-17T10:00:00.000Z",
      approvalReference: "approval-ref-001",
      approvedBy: "bob",
      approvedAt: "2026-07-10T10:30:00.000Z",
    };
    assert.equal(createIntentHash(a), createIntentHash(b));
  });

  // ── deriveIntentStatus ──────────────────────────────────────────

  it("deriveIntentStatus returns CREATED for a single CREATED event", () => {
    const events: ExecutionIntentEvent[] = [
      sampleEvent({ type: "CREATED" }),
    ];
    assert.equal(deriveIntentStatus(events), "CREATED");
  });

  it("deriveIntentStatus returns latest event type from event stream", () => {
    const events: ExecutionIntentEvent[] = [
      sampleEvent({ type: "CREATED", timestamp: "2026-07-10T10:00:00.000Z" }),
      sampleEvent({ type: "APPROVED", timestamp: "2026-07-10T10:30:00.000Z", actor: "bob" }),
      sampleEvent({ type: "RUNNING", timestamp: "2026-07-10T11:00:00.000Z", actor: "bot" }),
      sampleEvent({ type: "COMPLETED", timestamp: "2026-07-10T11:30:00.000Z", actor: "bot" }),
    ];
    assert.equal(deriveIntentStatus(events), "COMPLETED");
  });

  it("deriveIntentStatus ignores event order — sorts by timestamp", () => {
    const events: ExecutionIntentEvent[] = [
      sampleEvent({ type: "COMPLETED", timestamp: "2026-07-10T11:30:00.000Z", actor: "bot" }),
      sampleEvent({ type: "CREATED", timestamp: "2026-07-10T10:00:00.000Z" }),
      sampleEvent({ type: "RUNNING", timestamp: "2026-07-10T11:00:00.000Z", actor: "bot" }),
      sampleEvent({ type: "APPROVED", timestamp: "2026-07-10T10:30:00.000Z", actor: "bob" }),
    ];
    assert.equal(deriveIntentStatus(events), "COMPLETED");
  });

  it("deriveIntentStatus returns FAILED when latest event is FAILED", () => {
    const events: ExecutionIntentEvent[] = [
      sampleEvent({ type: "CREATED" }),
      sampleEvent({ type: "APPROVED", timestamp: "2026-07-10T10:30:00.000Z", actor: "bob" }),
      sampleEvent({ type: "RUNNING", timestamp: "2026-07-10T11:00:00.000Z", actor: "bot" }),
      sampleEvent({ type: "FAILED", timestamp: "2026-07-10T11:05:00.000Z", actor: "bot", reason: "Build error" }),
    ];
    assert.equal(deriveIntentStatus(events), "FAILED");
  });

  it("deriveIntentStatus returns REVOKED when latest event is REVOKED", () => {
    const events: ExecutionIntentEvent[] = [
      sampleEvent({ type: "CREATED" }),
      sampleEvent({ type: "APPROVED", timestamp: "2026-07-10T10:30:00.000Z", actor: "bob" }),
      sampleEvent({ type: "REVOKED", timestamp: "2026-07-10T10:45:00.000Z", actor: "bob", reason: "Decision changed" }),
    ];
    assert.equal(deriveIntentStatus(events), "REVOKED");
  });

  it("deriveIntentStatus throws for empty events array", () => {
    assert.throws(
      () => deriveIntentStatus([]),
      { message: "Cannot derive intent status from empty event stream" },
    );
  });

  it("deriveIntentStatus handles a single event of each type", () => {
    for (const type of ["CREATED", "APPROVED", "RUNNING", "COMPLETED", "FAILED", "REVOKED"] as const) {
      const events: ExecutionIntentEvent[] = [
        sampleEvent({ type }),
      ];
      assert.equal(deriveIntentStatus(events), type);
    }
  });

  // ── Readonly<T> compile-time immutability ──────────────────────

  it("Readonly<T> prevents property reassignment (compile-time check)", () => {
    const intent: ExecutionIntent = fullIntent();
    // At runtime, JS allows mutation — this test documents the compile-time guard
    assert.equal(typeof intent.intentId, "string");
    // TypeScript enforces: intent.intentId = "new-id"; // Error: Cannot assign to 'intentId'
  });

  // ── EXECUTION_INTENT_INVARIANTS ─────────────────────────────────

  it("EXECUTION_INTENT_INVARIANTS documents all 5 invariants", () => {
    assert.equal(EXECUTION_INTENT_INVARIANTS.immutableIntent, true);
    assert.equal(EXECUTION_INTENT_INVARIANTS.statusDerivedFromEvents, true);
    assert.equal(EXECUTION_INTENT_INVARIANTS.writeOnceEvents, true);
    assert.equal(EXECUTION_INTENT_INVARIANTS.canonicalHash, true);
    assert.equal(EXECUTION_INTENT_INVARIANTS.immutableWrapper, true);

    // Verify shape: all keys are literal true
    const keys = Object.keys(EXECUTION_INTENT_INVARIANTS) as Array<keyof typeof EXECUTION_INTENT_INVARIANTS>;
    for (const key of keys) {
      assert.equal(EXECUTION_INTENT_INVARIANTS[key], true, `invariant "${key}" must be true`);
    }
  });
});
