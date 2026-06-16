/**
 * Stub test for ConflictDetector.
 *
 * Fleshed out in Phase E (Task E5). For now, just confirms the class is
 * importable and that the type surface compiles.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConflictDetector, DEFAULT_DETECTION_LIMITS } from "../../src/kernel/collaboration-conflict-detector.js";

describe("ConflictDetector (stub)", () => {
  it("exports the class and default limits", () => {
    assert.equal(typeof ConflictDetector, "function");
    assert.equal(DEFAULT_DETECTION_LIMITS.maxFindingsPerTopic, 20);
    assert.equal(DEFAULT_DETECTION_LIMITS.maxPairsPerDetectionPass, 200);
  });
});
