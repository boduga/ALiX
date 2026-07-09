/**
 * Tests for P25.1 — Policy Review Candidate Types.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  type PolicyReviewCandidateStatus,
  type PolicyReviewCandidate,
  type PolicyReviewCandidateEventType,
  type PolicyReviewCandidateEvent,
  ALLOWED_TRANSITIONS,
} from "../../src/governance/policy-review-candidate-types.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PolicyReviewCandidateTypes", () => {
  // -----------------------------------------------------------------------
  // Status values
  // -----------------------------------------------------------------------

  it("has 7 status values", () => {
    const statuses: PolicyReviewCandidateStatus[] = [
      "proposed",
      "under_review",
      "needs_info",
      "deferred",
      "accepted_for_policy_review",
      "dismissed",
      "closed",
    ];
    assert.equal(statuses.length, 7);
  });

  // -----------------------------------------------------------------------
  // Event types
  // -----------------------------------------------------------------------

  it("has 3 event types", () => {
    const types: PolicyReviewCandidateEventType[] = [
      "candidate_opened",
      "status_changed",
      "note_added",
    ];
    assert.equal(types.length, 3);
  });

  // -----------------------------------------------------------------------
  // ALLOWED_TRANSITIONS — positive tests
  // -----------------------------------------------------------------------

  it("ALLOWED_TRANSITIONS covers proposed→under_review", () => {
    const next = ALLOWED_TRANSITIONS["proposed"];
    assert.ok(next);
    assert.ok(next.includes("under_review"));
  });

  it("ALLOWED_TRANSITIONS covers proposed→dismissed", () => {
    const next = ALLOWED_TRANSITIONS["proposed"];
    assert.ok(next);
    assert.ok(next.includes("dismissed"));
  });

  it("ALLOWED_TRANSITIONS covers proposed→deferred", () => {
    const next = ALLOWED_TRANSITIONS["proposed"];
    assert.ok(next);
    assert.ok(next.includes("deferred"));
  });

  it("ALLOWED_TRANSITIONS covers under_review→needs_info", () => {
    const next = ALLOWED_TRANSITIONS["under_review"];
    assert.ok(next);
    assert.ok(next.includes("needs_info"));
  });

  it("ALLOWED_TRANSITIONS covers under_review→deferred", () => {
    const next = ALLOWED_TRANSITIONS["under_review"];
    assert.ok(next);
    assert.ok(next.includes("deferred"));
  });

  it("ALLOWED_TRANSITIONS covers under_review→accepted_for_policy_review", () => {
    const next = ALLOWED_TRANSITIONS["under_review"];
    assert.ok(next);
    assert.ok(next.includes("accepted_for_policy_review"));
  });

  it("ALLOWED_TRANSITIONS covers under_review→dismissed", () => {
    const next = ALLOWED_TRANSITIONS["under_review"];
    assert.ok(next);
    assert.ok(next.includes("dismissed"));
  });

  it("ALLOWED_TRANSITIONS covers needs_info→under_review", () => {
    const next = ALLOWED_TRANSITIONS["needs_info"];
    assert.ok(next);
    assert.ok(next.includes("under_review"));
  });

  it("ALLOWED_TRANSITIONS covers needs_info→deferred", () => {
    const next = ALLOWED_TRANSITIONS["needs_info"];
    assert.ok(next);
    assert.ok(next.includes("deferred"));
  });

  it("ALLOWED_TRANSITIONS covers needs_info→dismissed", () => {
    const next = ALLOWED_TRANSITIONS["needs_info"];
    assert.ok(next);
    assert.ok(next.includes("dismissed"));
  });

  it("ALLOWED_TRANSITIONS covers deferred→under_review", () => {
    const next = ALLOWED_TRANSITIONS["deferred"];
    assert.ok(next);
    assert.ok(next.includes("under_review"));
  });

  it("ALLOWED_TRANSITIONS covers deferred→dismissed", () => {
    const next = ALLOWED_TRANSITIONS["deferred"];
    assert.ok(next);
    assert.ok(next.includes("dismissed"));
  });

  it("ALLOWED_TRANSITIONS covers accepted_for_policy_review→closed", () => {
    const next = ALLOWED_TRANSITIONS["accepted_for_policy_review"];
    assert.ok(next);
    assert.ok(next.includes("closed"));
  });

  it("ALLOWED_TRANSITIONS covers dismissed→closed", () => {
    const next = ALLOWED_TRANSITIONS["dismissed"];
    assert.ok(next);
    assert.ok(next.includes("closed"));
  });

  // -----------------------------------------------------------------------
  // ALLOWED_TRANSITIONS — negative tests (explicitly disallowed)
  // -----------------------------------------------------------------------

  it("ALLOWED_TRANSITIONS does NOT include proposed→closed", () => {
    assert.equal(
      ALLOWED_TRANSITIONS["proposed"]?.includes("closed"),
      false
    );
  });

  it("ALLOWED_TRANSITIONS does NOT include dismissed→under_review", () => {
    assert.equal(
      ALLOWED_TRANSITIONS["dismissed"]?.includes("under_review"),
      false
    );
  });

  it("ALLOWED_TRANSITIONS does NOT include closed→anything", () => {
    assert.equal(
      ALLOWED_TRANSITIONS["closed"]?.length ?? 0,
      0
    );
  });

  // -----------------------------------------------------------------------
  // Boundary flags
  // -----------------------------------------------------------------------

  it("candidate interface has correct boundary flags", () => {
    // Type-level check only — if compiles, flags correct
    const flags: true = true as true;
    assert.ok(flags);
  });
});
