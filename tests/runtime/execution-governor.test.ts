// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type {
  ExecutionIntent,
  ExecutionIntentEvent,
  ExecutionEvidence,
} from "../../src/runtime/contracts/execution-intent-contract.js";

import { ExecutionGovernorImpl } from "../../src/runtime/execution-governor.js";
import type {
  ExecutionGovernor,
  ValidationResult,
  AuthorizationResult,
  ExecutionSession,
} from "../../src/runtime/execution-governor.js";

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Create a minimal intent for testing with all required fields.
 * Defaults to an already-approved intent with future expiration.
 */
function sampleIntent(overrides?: Partial<ExecutionIntent>): ExecutionIntent {
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
    expiration: "2099-12-31T23:59:59.000Z", // far future — never expires in tests
    approvalReference: "approval-ref-001",
    approvedBy: "bob",
    approvedAt: "2026-07-10T10:30:00.000Z",
    intentHash: "deadbeef",
    ...overrides,
  };
}

/**
 * Create a single event with sensible defaults.
 */
function event(
  overrides: Partial<ExecutionIntentEvent> & { type: ExecutionIntentEvent["type"] },
): ExecutionIntentEvent {
  return {
    intentId: "intent-001",
    timestamp: "2026-07-10T10:00:00.000Z",
    actor: "alice",
    ...overrides,
  };
}

/**
 * Build a governors with pre-seeded event streams for the given intents.
 */
function governorWithEvents(
  intentId: string,
  events: ExecutionIntentEvent[],
): ExecutionGovernorImpl {
  const map = new Map<string, ExecutionIntentEvent[]>();
  map.set(intentId, events);
  return new ExecutionGovernorImpl(map);
}

/**
 * Assert that two strings are non-empty and equal (for sessionId checks).
 */
function assertSessionId(
  actual: string | undefined,
  expected: string | undefined,
): void {
  assert.equal(typeof actual, "string");
  assert.ok(actual!.length > 0, "sessionId must not be empty");
  if (expected !== undefined) {
    assert.equal(actual, expected);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("X2 — Execution Governor", () => {
  // ── 1: Interface shape ─────────────────────────────────────────────

  it("execution-governor has validate() and authorize() methods", () => {
    const gov = new ExecutionGovernorImpl();

    // Type-level check: the instance satisfies the interface
    const governor: ExecutionGovernor = gov;

    assert.equal(typeof governor.validate, "function");
    assert.equal(typeof governor.authorize, "function");
    assert.equal(typeof governor.start, "function");
    assert.equal(typeof governor.heartbeat, "function");
    assert.equal(typeof governor.complete, "function");
    assert.equal(typeof governor.fail, "function");
    assert.equal(typeof governor.revoke, "function");
  });

  // ── 2: validate — APPROVED intent ──────────────────────────────────

  it("validate() accepts well-formed intent APPROVED-derived status valid constraints", async () => {
    const events: ExecutionIntentEvent[] = [
      event({ type: "CREATED", timestamp: "2026-07-10T10:00:00.000Z" }),
      event({
        type: "APPROVED",
        timestamp: "2026-07-10T10:30:00.000Z",
        actor: "bob",
      }),
    ];
    const gov = governorWithEvents("intent-001", events);
    const intent = sampleIntent();

    const result: ValidationResult = await gov.validate(intent);

    assert.equal(result.valid, true);
    assert.equal(result.reason, undefined);
  });

  // ── 3: validate — CREATED intent (not executable) ──────────────────

  it("validate() rejects intent when derived status CREATED (not executable)", async () => {
    const events: ExecutionIntentEvent[] = [
      event({ type: "CREATED", timestamp: "2026-07-10T10:00:00.000Z" }),
    ];
    const gov = governorWithEvents("intent-001", events);
    const intent = sampleIntent();

    const result: ValidationResult = await gov.validate(intent);

    assert.equal(result.valid, false);
    assert.ok(result.reason, "reason must be present");
    assert.ok(
      result.reason!.includes("CREATED"),
      `reason "${result.reason}" must mention CREATED`,
    );
  });

  // ── 4: authorize — idempotent session creation ─────────────────────

  it("authorize() creates authorization session; repeated authorize() returns existing session (idempotent)", async () => {
    const events: ExecutionIntentEvent[] = [
      event({ type: "CREATED", timestamp: "2026-07-10T10:00:00.000Z" }),
      event({
        type: "APPROVED",
        timestamp: "2026-07-10T10:30:00.000Z",
        actor: "bob",
      }),
    ];
    const gov = governorWithEvents("intent-001", events);

    // First call — should succeed and return a sessionId
    const first: AuthorizationResult = await gov.authorize("intent-001");
    assert.equal(first.authorized, true);
    assertSessionId(first.sessionId, undefined);

    // Second call — should return the same sessionId (idempotent)
    const second: AuthorizationResult = await gov.authorize("intent-001");
    assert.equal(second.authorized, true);
    assert.equal(second.sessionId, first.sessionId);
  });

  // ── 5: complete — produces ExecutionEvidence ───────────────────────

  it("complete() produces ExecutionEvidence correct fields", async () => {
    const events: ExecutionIntentEvent[] = [
      event({ type: "CREATED", timestamp: "2026-07-10T10:00:00.000Z" }),
      event({
        type: "APPROVED",
        timestamp: "2026-07-10T10:30:00.000Z",
        actor: "bob",
      }),
    ];
    const gov = governorWithEvents("intent-001", events);

    // Call start() to create a RUNNING event and session
    const session: ExecutionSession = await gov.start("intent-001");
    assert.equal(typeof session.sessionId, "string");

    // Now complete the intent
    const evidence: ExecutionEvidence = await gov.complete(
      "intent-001",
      "SUCCESS",
      "Refactored login flow successfully",
    );

    // Validate evidence fields
    assert.equal(typeof evidence.evidenceId, "string");
    assert.ok(evidence.evidenceId.length > 0, "evidenceId must not be empty");
    assert.equal(evidence.intentId, "intent-001");
    assert.equal(evidence.startedAt, session.startedAt);
    assert.equal(typeof evidence.completedAt, "string");
    assert.ok(
      new Date(evidence.completedAt) >= new Date(evidence.startedAt),
      "completedAt must be >= startedAt",
    );
    assert.equal(evidence.outcome, "SUCCESS");
    assert.equal(evidence.summary, "Refactored login flow successfully");
    assert.ok(Array.isArray(evidence.artifacts));
    assert.equal(evidence.verificationPassed, true);
    assert.equal(typeof evidence.evidenceHash, "string");
  });

  // ── 6: fail — produces FAILED outcome ──────────────────────────────

  it("fail() produces ExecutionEvidence FAILED outcome", async () => {
    const events: ExecutionIntentEvent[] = [
      event({ type: "CREATED", timestamp: "2026-07-10T10:00:00.000Z" }),
      event({
        type: "APPROVED",
        timestamp: "2026-07-10T10:30:00.000Z",
        actor: "bob",
      }),
    ];
    const gov = governorWithEvents("intent-001", events);

    // Call start() to create a session
    await gov.start("intent-001");

    // Now fail the intent
    const evidence: ExecutionEvidence = await gov.fail(
      "intent-001",
      "Build error during compilation",
    );

    assert.equal(typeof evidence.evidenceId, "string");
    assert.ok(evidence.evidenceId.length > 0);
    assert.equal(evidence.intentId, "intent-001");
    assert.equal(evidence.outcome, "FAILED");
    assert.equal(evidence.summary, "Build error during compilation");
    assert.equal(evidence.verificationPassed, false);
    assert.equal(typeof evidence.completedAt, "string");
    assert.equal(typeof evidence.startedAt, "string");
  });

  // ── 7: revoke + heartbeat rejection ────────────────────────────────

  it("revoke() appends REVOKED event; heartbeat() rejected revoked intents", async () => {
    const events: ExecutionIntentEvent[] = [
      event({ type: "CREATED", timestamp: "2026-07-10T10:00:00.000Z" }),
      event({
        type: "APPROVED",
        timestamp: "2026-07-10T10:30:00.000Z",
        actor: "bob",
      }),
    ];
    const gov = governorWithEvents("intent-001", events);

    // Authorize and start to create an active session
    const auth = await gov.authorize("intent-001");
    assert.equal(auth.authorized, true);
    const sessionId = auth.sessionId!;

    // Revoke the intent
    await gov.revoke("intent-001", "Decision changed after approval");

    // Verify REVOKED event was appended by checking derived status
    // (we can inspect the governor's events through a second validate call)
    const intent = sampleIntent();
    const valResult = await gov.validate(intent);
    assert.equal(valResult.valid, false);
    assert.ok(
      valResult.reason!.includes("REVOKED"),
      `reason "${valResult.reason}" should mention REVOKED`,
    );

    // Heartbeat after revoke should be rejected
    await assert.rejects(
      gov.heartbeat("intent-001", sessionId),
      {
        name: "Error",
        message: /terminal status REVOKED/,
      },
      "heartbeat() must reject after REVOKED",
    );
  });
});
