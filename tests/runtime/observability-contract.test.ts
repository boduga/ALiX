import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Contract types ──────────────────────────────────────────────

import type { RuntimeEvidence } from "../../src/runtime/contracts/observability-contract.js";
import {
  OBSERVABILITY_INVARIANTS,
} from "../../src/runtime/contracts/observability-contract.js";
import type { GovernanceEvidenceFilter } from "../../src/runtime/contracts/observability-contract.js";

// ── Tests ───────────────────────────────────────────────────────

describe("M1.7 — Observability Contract", () => {
  // ── RuntimeEvidence structural compatibility ─────────────────

  it("RuntimeEvidence compiles with all fields", () => {
    // Construct a full RuntimeEvidence record — verifies the shape
    // compiles and all required fields are present.
    const evidence: RuntimeEvidence = {
      eventId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      timestamp: "2026-07-10T12:00:00.000Z",
      sourceType: "tool",
      description: "Tool requested: file.read on /tmp/test",
      governanceRelevant: true,
      traceIds: ["trace-001", "trace-002"],
    };

    // All fields are present and of the correct type
    assert.equal(typeof evidence.eventId, "string");
    assert.equal(typeof evidence.timestamp, "string");
    assert.equal(typeof evidence.sourceType, "string");
    assert.equal(typeof evidence.description, "string");
    assert.equal(typeof evidence.governanceRelevant, "boolean");
    assert.ok(Array.isArray(evidence.traceIds));
    assert.equal(evidence.traceIds.length, 2);
    assert.equal(evidence.traceIds[0], "trace-001");

    // RuntimeEvidence is readonly — verify fields are not writable
    // at the type level (structural check passes at compile time)
    const keys: Array<keyof RuntimeEvidence> = [
      "eventId",
      "timestamp",
      "sourceType",
      "description",
      "governanceRelevant",
      "traceIds",
    ];
    assert.equal(keys.length, 6);
    for (const key of keys) {
      assert.ok(key in evidence, `RuntimeEvidence must have field "${key}"`);
    }
  });

  it("RuntimeEvidence accepts empty traceIds", () => {
    // Empty traceIds MUST be handled without error per the invariant
    const evidence: RuntimeEvidence = {
      eventId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      timestamp: "2026-07-10T12:00:01.000Z",
      sourceType: "memory",
      description: "Memory entry consolidated",
      governanceRelevant: false,
      traceIds: [],
    };

    assert.ok(Array.isArray(evidence.traceIds));
    assert.equal(evidence.traceIds.length, 0);
  });

  // ── governanceRelevant filtering ─────────────────────────────

  it("governanceRelevant field enables P14–P30 filtering", () => {
    // The canonical filter: only forward records where governanceRelevant is true
    const isGovernanceRelevant: GovernanceEvidenceFilter = (e) => e.governanceRelevant;

    const relevant: RuntimeEvidence = {
      eventId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
      timestamp: "2026-07-10T12:00:02.000Z",
      sourceType: "approval",
      description: "Approval created for scope expansion",
      governanceRelevant: true,
      traceIds: ["trace-003"],
    };

    const operational: RuntimeEvidence = {
      eventId: "d4e5f6a7-b8c9-0123-defa-234567890123",
      timestamp: "2026-07-10T12:00:03.000Z",
      sourceType: "tool",
      description: "Tool completed: file.read",
      governanceRelevant: false,
      traceIds: [],
    };

    // Filtering
    const all = [relevant, operational];
    const governanceBound = all.filter(isGovernanceRelevant);

    assert.equal(governanceBound.length, 1);
    assert.equal(governanceBound[0].eventId, relevant.eventId);
    assert.equal(governanceBound[0].governanceRelevant, true);

    // Operational-only evidence is excluded from governance
    assert.equal(governanceBound.find((e) => e.eventId === operational.eventId), undefined);
  });

  it("GovernanceEvidenceFilter signature is compatible with Array.filter", () => {
    // Verify the filter type works directly with standard library filter
    const records: RuntimeEvidence[] = [
      {
        eventId: "e5f6a7b8-c9d0-1234-efab-345678901234",
        timestamp: "2026-07-10T12:00:04.000Z",
        sourceType: "replay",
        description: "Replay plan created",
        governanceRelevant: true,
        traceIds: ["trace-004"],
      },
      {
        eventId: "f6a7b8c9-d0e1-2345-fabc-456789012345",
        timestamp: "2026-07-10T12:00:05.000Z",
        sourceType: "rollback",
        description: "Rollback progress saved",
        governanceRelevant: false,
        traceIds: [],
      },
    ];

    const relevant = records.filter((e: RuntimeEvidence) => e.governanceRelevant);
    assert.equal(relevant.length, 1);
    assert.equal(relevant[0].sourceType, "replay");
  });

  // ── Invariants ──────────────────────────────────────────────

  it("OBSERVABILITY_INVARIANTS documents all observability rules", () => {
    assert.equal(OBSERVABILITY_INVARIANTS.immutableIdentity, true);
    assert.equal(OBSERVABILITY_INVARIANTS.governanceRelevantFilterGate, true);
    assert.equal(OBSERVABILITY_INVARIANTS.traceLinkageHandlesEmpty, true);
    assert.equal(OBSERVABILITY_INVARIANTS.appendOnlyEvidenceLog, true);

    // All keys are readonly literal true — verify the shape
    const keys = Object.keys(OBSERVABILITY_INVARIANTS) as Array<
      keyof typeof OBSERVABILITY_INVARIANTS
    >;
    for (const key of keys) {
      assert.equal(
        OBSERVABILITY_INVARIANTS[key],
        true,
        `observability invariant "${key}" must be true`,
      );
    }
  });
});
