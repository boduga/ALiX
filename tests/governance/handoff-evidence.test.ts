import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateHandoffEvidence,
  HandoffEvidenceError,
} from "../../src/governance/handoff-evidence.js";

const VALID_ISO = "2026-07-08T18:00:00.000Z";

describe("validateHandoffEvidence", () => {
  it("valid evidence passes validation", () => {
    const result = validateHandoffEvidence(
      ["ref-1", "ref-2"],
      {
        "ref-1": { ref: "ref-1", capturedAt: VALID_ISO, capturedBy: "operator-1", description: "Done", payload: {} },
        "ref-2": { ref: "ref-2", capturedAt: VALID_ISO, capturedBy: "operator-2", description: "Done", payload: {} },
      },
    );
    assert.equal(result.valid, true);
    assert.equal(result.missingRefs.length, 0);
    assert.equal(result.totalRequired, 2);
    assert.equal(result.totalCaptured, 2);
  });

  it("missing evidence ref → valid false", () => {
    const result = validateHandoffEvidence(
      ["ref-1", "ref-2"],
      { "ref-1": { ref: "ref-1", capturedAt: VALID_ISO, capturedBy: "operator-1", description: "Done", payload: {} } },
    );
    assert.equal(result.valid, false);
    assert.deepEqual(result.missingRefs, ["ref-2"]);
    assert.equal(result.totalCaptured, 1);
  });

  it("extra evidence refs are ignored", () => {
    const result = validateHandoffEvidence(
      ["ref-1"],
      {
        "ref-1": { ref: "ref-1", capturedAt: VALID_ISO, capturedBy: "operator-1", description: "Done", payload: {} },
        "extra": { ref: "extra", capturedAt: VALID_ISO, capturedBy: "op", description: "Extra", payload: {} },
      },
    );
    assert.equal(result.valid, true);
    assert.equal(result.missingRefs.length, 0);
  });

  it("empty evidence → valid false", () => {
    const result = validateHandoffEvidence(["ref-1"], {});
    assert.equal(result.valid, false);
    assert.deepEqual(result.missingRefs, ["ref-1"]);
  });

  it("invalid capturedAt timestamp throws", () => {
    assert.throws(
      () => validateHandoffEvidence(
        ["ref-1"],
        { "ref-1": { ref: "ref-1", capturedAt: "not-a-timestamp", capturedBy: "op", description: "Bad", payload: {} } },
      ),
      HandoffEvidenceError,
    );
  });

  it("empty capturedBy throws", () => {
    assert.throws(
      () => validateHandoffEvidence(
        ["ref-1"],
        { "ref-1": { ref: "ref-1", capturedAt: VALID_ISO, capturedBy: "", description: "Bad", payload: {} } },
      ),
      HandoffEvidenceError,
    );
  });
});
