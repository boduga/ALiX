// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * X2 — Execution Governor
 *
 * The gate that validates, authorizes, and produces evidence for execution
 * intents. This is the first runtime component of the X-Series.
 *
 * ─────────────── GOVERNOR INVARIANTS ───────────────
 *
 * 1. **validate() is PURE** — no side effects, no session creation, no
 *    authorization, no state transitions, no evidence emission. Returns
 *    `{ valid, reason? }`.
 *
 * 2. **authorize() is IDEMPOTENT** — first call creates a session; repeated
 *    calls return the existing session. Conflicting states (not APPROVED)
 *    are rejected.
 *
 * 3. **heartbeat() only for active sessions** — updates a last-seen timestamp.
 *    Rejected after COMPLETED, FAILED, or REVOKED.
 *
 * 4. **Governor never imports from agent/tools/providers/mcp.**
 *
 * 5. **deriveIntentStatus(events)** computes the current status from the
 *    append-only event stream — status is never stored directly.
 *
 * @module execution-governor
 */

import { randomUUID } from "node:crypto";
import type {
  ExecutionIntent,
  ExecutionIntentEvent,
  ExecutionEvidence,
} from "./contracts/execution-intent-contract.js";
import { deriveIntentStatus } from "./contracts/execution-intent-contract.js";

// ─── Public Types ─────────────────────────────────────────────────────

/**
 * Result of a validate() call.
 *
 * Pure check — no side effects. Contains only a boolean and an
 * optional reason string explaining a failure.
 */
export type ValidationResult = Readonly<{
  valid: boolean;
  reason?: string;
}>;

/**
 * Result of an authorize() call.
 *
 * When authorized, includes a sessionId for tracking the authorization
 * session. Repeated calls for the same approved intent return the same
 * sessionId (idempotent).
 */
export type AuthorizationResult = Readonly<{
  authorized: boolean;
  sessionId?: string;
  reason?: string;
}>;

/**
 * An active execution session.
 *
 * Created by authorize() (or start()) and referenced by heartbeat(),
 * complete(), fail(), and revoke().
 */
export type ExecutionSession = Readonly<{
  sessionId: string;
  intentId: string;
  startedAt: string;
}>;

/**
 * Execution Governor interface.
 *
 * All methods are async to accommodate future database-backed or
 * distributed implementations under the same interface.
 */
export type ExecutionGovernor = {
  validate(intent: ExecutionIntent): Promise<ValidationResult>;
  authorize(intentId: string): Promise<AuthorizationResult>;
  start(intentId: string): Promise<ExecutionSession>;
  heartbeat(intentId: string, sessionId: string): Promise<void>;
  complete(
    intentId: string,
    outcome: ExecutionEvidence["outcome"],
    summary: string,
  ): Promise<ExecutionEvidence>;
  fail(intentId: string, reason: string): Promise<ExecutionEvidence>;
  revoke(intentId: string, reason: string): Promise<void>;
};

// ─── Implementation ───────────────────────────────────────────────────

/**
 * In-memory implementation of the Execution Governor.
 *
 * Stores event streams and sessions in Maps. Designed to be replaced
 * with a database-backed implementation under the same
 * {@link ExecutionGovernor} interface.
 */
export class ExecutionGovernorImpl implements ExecutionGovernor {
  private readonly events: Map<string, ExecutionIntentEvent[]>;
  private readonly sessions: Map<string, ExecutionSession>;
  private readonly heartbeats: Map<string, string>;

  /**
   * @param events - Optional pre-seeded event streams keyed by intentId.
   *                 Used for testing or recovery scenarios.
   */
  constructor(events?: Map<string, ExecutionIntentEvent[]>) {
    this.events = events ?? new Map();
    this.sessions = new Map();
    this.heartbeats = new Map();
  }

  // ─── validate ────────────────────────────────────────────────────────

  /**
   * Pure validation check with no side effects.
   *
   * Checks:
   *   1. Event stream exists and is non-empty for the intent.
   *   2. Derived status is APPROVED (rejects CREATED, RUNNING, terminal).
   *   3. approvalReference exists on the intent.
   *   4. approvedAt exists on the intent.
   *   5. expiration has not been exceeded.
   *
   * @param intent - The execution intent to validate.
   * @returns ValidationResult with `valid: true` or a descriptive reason.
   */
  async validate(intent: ExecutionIntent): Promise<ValidationResult> {
    const intentEvents = this.events.get(intent.intentId);

    if (!intentEvents || intentEvents.length === 0) {
      return { valid: false, reason: `No events found for intent ${intent.intentId}` };
    }

    let status: string;
    try {
      status = deriveIntentStatus(intentEvents);
    } catch {
      return { valid: false, reason: "Cannot derive intent status from empty event stream" };
    }

    if (status !== "APPROVED") {
      return { valid: false, reason: `Intent status is ${status}, expected APPROVED` };
    }

    if (!intent.approvalReference) {
      return { valid: false, reason: "Missing approvalReference" };
    }

    if (!intent.approvedAt) {
      return { valid: false, reason: "Missing approvedAt" };
    }

    if (new Date(intent.expiration) < new Date()) {
      return { valid: false, reason: "Intent has expired" };
    }

    // Check that the intent has not been revoked after approval
    const hasRevoked = intentEvents.some((e) => e.type === "REVOKED");
    if (hasRevoked) {
      return { valid: false, reason: "Referenced approval has been revoked" };
    }

    return { valid: true };
  }

  // ─── authorize ───────────────────────────────────────────────────────

  /**
   * Authorize an approved intent for execution.
   *
   * - First call with an APPROVED intent: creates a session, returns success.
   * - Repeated call with the same APPROVED intent: returns the existing
   *   session (idempotent).
   * - Non-APPROVED status: rejects with a descriptive reason.
   *
   * @param intentId - The ID of the intent to authorize.
   * @returns AuthorizationResult with authorized flag and optional sessionId.
   */
  async authorize(intentId: string): Promise<AuthorizationResult> {
    // Idempotent: return existing session if already authorized
    const existing = this.sessions.get(intentId);
    if (existing) {
      return { authorized: true, sessionId: existing.sessionId };
    }

    const intentEvents = this.events.get(intentId);

    if (!intentEvents || intentEvents.length === 0) {
      return { authorized: false, reason: `No events found for intent ${intentId}` };
    }

    let status: string;
    try {
      status = deriveIntentStatus(intentEvents);
    } catch {
      return { authorized: false, reason: "Cannot derive intent status from empty event stream" };
    }

    if (status !== "APPROVED") {
      return {
        authorized: false,
        reason: `Cannot authorize intent with status ${status}, expected APPROVED`,
      };
    }

    const sessionId = randomUUID();
    const session: ExecutionSession = {
      sessionId,
      intentId,
      startedAt: new Date().toISOString(),
    };
    this.sessions.set(intentId, session);
    return { authorized: true, sessionId };
  }

  // ─── start ───────────────────────────────────────────────────────────

  /**
   * Start executing an approved intent.
   *
   * Appends a RUNNING event to the intent's event stream and returns an
   * ExecutionSession. Requires the intent status to be APPROVED.
   *
   * @param intentId - The ID of the intent to start.
   * @returns The active execution session.
   * @throws {Error} if the intent has no events or is not in APPROVED status.
   */
  async start(intentId: string): Promise<ExecutionSession> {
    const intentEvents = this.events.get(intentId);

    if (!intentEvents || intentEvents.length === 0) {
      throw new Error(`No events found for intent ${intentId}`);
    }

    const status = deriveIntentStatus(intentEvents);

    if (status !== "APPROVED") {
      throw new Error(`Cannot start intent with status ${status}, expected APPROVED`);
    }

    const timestamp = new Date().toISOString();
    const event: ExecutionIntentEvent = {
      intentId,
      type: "RUNNING",
      timestamp,
      actor: "governor",
    };
    intentEvents.push(event);

    // Use existing session from authorize() if present, otherwise create one
    let session = this.sessions.get(intentId);
    if (!session) {
      session = {
        sessionId: randomUUID(),
        intentId,
        startedAt: timestamp,
      };
      this.sessions.set(intentId, session);
    }

    return session;
  }

  // ─── heartbeat ───────────────────────────────────────────────────────

  /**
   * Record a heartbeat for an active execution session.
   *
   * Only succeeds for sessions on intents in non-terminal status
   * (CREATED, APPROVED, RUNNING). Updates the last-seen timestamp.
   *
   * @param intentId - The ID of the executing intent.
   * @param sessionId - The session ID to heartbeat.
   * @throws {Error} if intentId or sessionId are empty, no events found,
   *   the intent has a terminal status, or the session is not found.
   */
  async heartbeat(intentId: string, sessionId: string): Promise<void> {
    if (!intentId) {
      throw new Error("intentId is required");
    }

    if (!sessionId) {
      throw new Error("sessionId is required");
    }

    const intentEvents = this.events.get(intentId);

    if (!intentEvents || intentEvents.length === 0) {
      throw new Error(`No events found for intent ${intentId}`);
    }

    const status = deriveIntentStatus(intentEvents);

    if (status === "COMPLETED" || status === "FAILED" || status === "REVOKED") {
      throw new Error(`Cannot heartbeat intent with terminal status ${status}`);
    }

    const session = this.sessions.get(intentId);
    if (!session || session.sessionId !== sessionId) {
      throw new Error(`Session ${sessionId} not found for intent ${intentId}`);
    }

    this.heartbeats.set(sessionId, new Date().toISOString());
  }

  // ─── complete ────────────────────────────────────────────────────────

  /**
   * Mark an execution intent as completed successfully or partially.
   *
   * Appends a COMPLETED event and returns ExecutionEvidence with the
   * given outcome and summary.
   *
   * @param intentId - The ID of the completing intent.
   * @param outcome - One of "SUCCESS", "FAILED", or "PARTIAL".
   * @param summary - A human-readable summary of the execution outcome.
   * @returns ExecutionEvidence recording the outcome.
   * @throws {Error} if no events or no session exist for the intent.
   */
  async complete(
    intentId: string,
    outcome: ExecutionEvidence["outcome"],
    summary: string,
  ): Promise<ExecutionEvidence> {
    const intentEvents = this.events.get(intentId);

    if (!intentEvents || intentEvents.length === 0) {
      throw new Error(`No events found for intent ${intentId}`);
    }

    const session = this.sessions.get(intentId);
    if (!session) {
      throw new Error(`No active session for intent ${intentId}`);
    }

    const timestamp = new Date().toISOString();
    const event: ExecutionIntentEvent = {
      intentId,
      type: "COMPLETED",
      timestamp,
      actor: "governor",
    };
    intentEvents.push(event);
    this.sessions.delete(intentId);

    const evidence: ExecutionEvidence = {
      evidenceId: randomUUID(),
      intentId,
      startedAt: session.startedAt,
      completedAt: timestamp,
      outcome,
      summary,
      artifacts: [],
      verificationPassed: outcome === "SUCCESS",
      evidenceHash: "",
    };

    return evidence;
  }

  // ─── fail ────────────────────────────────────────────────────────────

  /**
   * Mark an execution intent as failed.
   *
   * Appends a FAILED event and returns ExecutionEvidence with FAILED
   * outcome and the provided reason as summary.
   *
   * @param intentId - The ID of the failing intent.
   * @param reason - A human-readable reason for the failure.
   * @returns ExecutionEvidence with outcome set to FAILED.
   * @throws {Error} if no events or no session exist for the intent.
   */
  async fail(intentId: string, reason: string): Promise<ExecutionEvidence> {
    const intentEvents = this.events.get(intentId);

    if (!intentEvents || intentEvents.length === 0) {
      throw new Error(`No events found for intent ${intentId}`);
    }

    const session = this.sessions.get(intentId);
    if (!session) {
      throw new Error(`No active session for intent ${intentId}`);
    }

    const timestamp = new Date().toISOString();
    const event: ExecutionIntentEvent = {
      intentId,
      type: "FAILED",
      timestamp,
      actor: "governor",
      reason,
    };
    intentEvents.push(event);
    this.sessions.delete(intentId);

    const evidence: ExecutionEvidence = {
      evidenceId: randomUUID(),
      intentId,
      startedAt: session.startedAt,
      completedAt: timestamp,
      outcome: "FAILED",
      summary: reason,
      artifacts: [],
      verificationPassed: false,
      evidenceHash: "",
    };

    return evidence;
  }

  // ─── revoke ──────────────────────────────────────────────────────────

  /**
   * Revoke an execution intent.
   *
   * Appends a REVOKED event to the intent's event stream and removes
   * any active session. The intent must have an event stream.
   *
   * @param intentId - The ID of the intent to revoke.
   * @param reason - A human-readable reason for the revocation.
   * @throws {Error} if no events exist for the intent.
   */
  async revoke(intentId: string, reason: string): Promise<void> {
    const intentEvents = this.events.get(intentId);

    if (!intentEvents || intentEvents.length === 0) {
      throw new Error(`No events found for intent ${intentId}`);
    }

    const timestamp = new Date().toISOString();
    const event: ExecutionIntentEvent = {
      intentId,
      type: "REVOKED",
      timestamp,
      actor: "governor",
      reason,
    };
    intentEvents.push(event);
    this.sessions.delete(intentId);
  }
}
