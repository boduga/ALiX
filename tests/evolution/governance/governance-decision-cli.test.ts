/**
 * Tests A3 — Governance Decision CLI.
 *
 * Covers the runDecide function from governance-decision-cli.ts.
 *
 * Test cases:
 * - Valid UNDER_REVIEW evolution → success path
 * - Evolution not found
 * - Wrong state (DRAFT, not UNDER_REVIEW)
 * - No evidence found
 * - JSON mode output
 *
 * @module governance-decision-cli
 */

import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { runDecide } from "../../../src/evolution/governance/governance-decision-cli.js";
import { EvolutionState } from "../../../src/evolution/contracts/evolution-contract.js";
import type { VerificationEvidence } from "../../../src/evolution/verification/contracts/verification-contract.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEvidence(overrides: Partial<VerificationEvidence> = {}): VerificationEvidence {
  return {
    evidenceId: "ev-ver-001",
    verificationId: "ver-run-001",
    proposalId: "prop-001",
    replayDatasetId: "ds-001",
    evidenceClass: "projected",
    proposalSnapshotHash: "hash-prop",
    environmentHash: "hash-env",
    baselineMetrics: { m: 1, n: 10 },
    candidateMetrics: { m: 2, n: 10 },
    metricDeltas: { m: 1, n: 0 },
    behavioralChanges: ["Metric m changed: 1 → 2 (delta +1.0)"],
    confidenceProfile: {
      replayFidelity: 0.95,
      coverage: 0.9,
      determinism: 1.0,
      historicalSimilarity: 0.9,
      overallConfidence: 0.9,
    },
    reproducibilityLevel: 2,
    lineage: [],
    verifiedAt: "2026-07-12T10:00:00.000Z",
    expiresAt: "2099-12-31T00:00:00.000Z",
    reverificationRequired: false,
    integrityHash: "abc123",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function createMocks(initialState: EvolutionState | "__NOT_FOUND__" = EvolutionState.UNDER_REVIEW) {
  /** Mock state machine — implements only what runDecide uses. */
  const stateMachine = {
    getStatus: mock.fn((_id: string): string => {
      if (initialState === "__NOT_FOUND__") {
        throw new Error(`Unknown evolution: ${_id}`);
      }
      return initialState;
    }),
    listEvolutions: mock.fn(() => []),
    getHistory: mock.fn(() => []),
    getMetadata: mock.fn(() => null),
    transition: mock.fn(() => ({ previous: initialState, current: EvolutionState.APPROVED, event: {} })),
  } as Record<string, ReturnType<typeof mock.fn>>;

  /** Mock evidence ledger — implements only what runDecide uses. */
  const evidenceList: VerificationEvidence[] = [];
  const evidenceLedger = {
    listByProposal: mock.fn((_proposalId: string) => Promise.resolve([...evidenceList])),
    store: mock.fn((e: VerificationEvidence) => Promise.resolve(e)),
    get: mock.fn(() => Promise.reject(new Error("not found"))),
    countExpired: mock.fn(() => Promise.resolve(0)),
    listExpired: mock.fn(() => Promise.resolve([])),
  } as Record<string, ReturnType<typeof mock.fn>>;

  /** Mock decision bridge — implements only what runDecide uses. */
  const decisionBridge = {
    execute: mock.fn((_decision: unknown) => Promise.resolve({
      decision: _decision,
      lifecycleTransitioned: true,
      transition: { previous: EvolutionState.UNDER_REVIEW, current: EvolutionState.APPROVED, event: {} },
      error: undefined,
    })),
  } as Record<string, ReturnType<typeof mock.fn>>;

  return { stateMachine, evidenceLedger, decisionBridge };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("governance-decision-cli", () => {
  beforeEach(() => {
    process.exitCode = 0;
    mock.restoreAll();
  });

  describe("runDecide", () => {
    it("should succeed with a valid UNDER_REVIEW evolution", async () => {
      const mocks = createMocks(EvolutionState.UNDER_REVIEW);
      mocks.evidenceLedger.listByProposal.mock.mockImplementation(
        () => Promise.resolve([makeEvidence({ proposalId: "evol-001" })]),
      );

      const logCalls: string[] = [];
      mock.method(console, "log", (msg: string) => { logCalls.push(msg); });

      await runDecide(
        {
          stateMachine: mocks.stateMachine as never,
          evidenceLedger: mocks.evidenceLedger as never,
          decisionBridge: mocks.decisionBridge as never,
        },
        "evol-001",
        false,
        [],
      );

      // Restore console.log
      mock.restoreAll();

      // Verify state machine was consulted
      assert.equal(mocks.stateMachine.getStatus.mock.callCount(), 1);
      assert.equal(mocks.stateMachine.getStatus.mock.calls[0]?.arguments[0], "evol-001");

      // Verify evidence was fetched
      assert.equal(mocks.evidenceLedger.listByProposal.mock.callCount(), 1);
      assert.equal(mocks.evidenceLedger.listByProposal.mock.calls[0]?.arguments[0], "evol-001");

      // Verify bridge was called
      assert.equal(mocks.decisionBridge.execute.mock.callCount(), 1);

      // Verify outcome in log output
      const output = logCalls.join("\n");
      assert.ok(output.includes("Governance Decision for Evolution: evol-001"));
      assert.ok(output.includes("APPROVE"));
      assert.ok(output.includes("✓ Governance decision executed."));
      assert.equal(process.exitCode, 0);
    });

    it("should fail with exit code when evolution is not found", async () => {
      const mocks = createMocks("__NOT_FOUND__");

      const logCalls: string[] = [];
      mock.method(console, "log", (msg: string) => { logCalls.push(msg); });

      await runDecide(
        {
          stateMachine: mocks.stateMachine as never,
          evidenceLedger: mocks.evidenceLedger as never,
          decisionBridge: mocks.decisionBridge as never,
        },
        "evol-unknown",
        false,
        [],
      );

      mock.restoreAll();

      assert.equal(process.exitCode, 1);
      const output = logCalls.join("\n");
      assert.ok(output.includes("Evolution not found: evol-unknown"));
      // Bridge should not have been called
      assert.equal(mocks.decisionBridge.execute.mock.callCount(), 0);
    });

    it("should fail when evolution is not in UNDER_REVIEW state", async () => {
      const mocks = createMocks(EvolutionState.DRAFT);
      mocks.evidenceLedger.listByProposal.mock.mockImplementation(
        () => Promise.resolve([makeEvidence({ proposalId: "evol-002" })]),
      );

      const logCalls: string[] = [];
      mock.method(console, "log", (msg: string) => { logCalls.push(msg); });

      await runDecide(
        {
          stateMachine: mocks.stateMachine as never,
          evidenceLedger: mocks.evidenceLedger as never,
          decisionBridge: mocks.decisionBridge as never,
        },
        "evol-002",
        false,
        [],
      );

      mock.restoreAll();

      assert.equal(process.exitCode, 1);
      const output = logCalls.join("\n");
      assert.ok(output.includes("must be UNDER_REVIEW to decide"));
      assert.equal(mocks.decisionBridge.execute.mock.callCount(), 0);
    });

    it("should fail when no verification evidence is found", async () => {
      const mocks = createMocks(EvolutionState.UNDER_REVIEW);
      // Return empty evidence list
      mocks.evidenceLedger.listByProposal.mock.mockImplementation(
        () => Promise.resolve([]),
      );

      const logCalls: string[] = [];
      mock.method(console, "log", (msg: string) => { logCalls.push(msg); });

      await runDecide(
        {
          stateMachine: mocks.stateMachine as never,
          evidenceLedger: mocks.evidenceLedger as never,
          decisionBridge: mocks.decisionBridge as never,
        },
        "evol-003",
        false,
        [],
      );

      mock.restoreAll();

      assert.equal(process.exitCode, 1);
      const output = logCalls.join("\n");
      assert.ok(output.includes("No verification evidence found"));
      assert.equal(mocks.decisionBridge.execute.mock.callCount(), 0);
    });

    it("should output JSON when jsonMode is true", async () => {
      const mocks = createMocks(EvolutionState.UNDER_REVIEW);
      mocks.evidenceLedger.listByProposal.mock.mockImplementation(
        () => Promise.resolve([makeEvidence({ proposalId: "evol-004" })]),
      );

      const logCalls: string[] = [];
      mock.method(console, "log", (msg: string) => { logCalls.push(msg); });

      await runDecide(
        {
          stateMachine: mocks.stateMachine as never,
          evidenceLedger: mocks.evidenceLedger as never,
          decisionBridge: mocks.decisionBridge as never,
        },
        "evol-004",
        true,
        [],
      );

      mock.restoreAll();

      // Should have exactly one JSON string logged
      assert.equal(logCalls.length, 1);
      const parsed = JSON.parse(logCalls[0]!);
      assert.equal(parsed.ok, true);
      assert.ok(parsed.decision);
      assert.ok(parsed.bridgeResult);
      assert.equal(parsed.decision.evolutionId, "evol-004");
      assert.equal(typeof parsed.decision.decisionId, "string");
      assert.equal(parsed.bridgeResult.lifecycleTransitioned, true);
      assert.equal(process.exitCode, 0);
    });

    it("should output JSON error when evolution not found in jsonMode", async () => {
      const mocks = createMocks("__NOT_FOUND__");

      const logCalls: string[] = [];
      mock.method(console, "log", (msg: string) => { logCalls.push(msg); });

      await runDecide(
        {
          stateMachine: mocks.stateMachine as never,
          evidenceLedger: mocks.evidenceLedger as never,
          decisionBridge: mocks.decisionBridge as never,
        },
        "evol-unknown",
        true,
        [],
      );

      mock.restoreAll();

      assert.equal(logCalls.length, 1);
      const parsed = JSON.parse(logCalls[0]!);
      assert.equal(parsed.ok, false);
      assert.ok(parsed.error.includes("Evolution not found"));
      assert.equal(process.exitCode, 1);
    });

    it("should accept --policy flag as default", async () => {
      const mocks = createMocks(EvolutionState.UNDER_REVIEW);
      mocks.evidenceLedger.listByProposal.mock.mockImplementation(
        () => Promise.resolve([makeEvidence({ proposalId: "evol-005" })]),
      );

      const logCalls: string[] = [];
      mock.method(console, "log", (msg: string) => { logCalls.push(msg); });

      await runDecide(
        {
          stateMachine: mocks.stateMachine as never,
          evidenceLedger: mocks.evidenceLedger as never,
          decisionBridge: mocks.decisionBridge as never,
        },
        "evol-005",
        true,
        ["--policy", "default"],
      );

      mock.restoreAll();

      assert.equal(logCalls.length, 1);
      const parsed = JSON.parse(logCalls[0]!);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.decision.policySnapshot.policyName, "default");
      assert.equal(process.exitCode, 0);
    });
  });
});
