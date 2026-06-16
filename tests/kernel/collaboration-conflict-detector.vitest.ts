/**
 * Stub test for ConflictDetector.
 *
 * Fleshed out in Phase E (Task E5). For now, just confirms the class is
 * importable and that the type surface compiles.
 */

import { describe, it, expect } from "vitest";
import { ConflictDetector, DEFAULT_DETECTION_LIMITS } from "../../src/kernel/collaboration-conflict-detector.js";

describe("ConflictDetector (stub)", () => {
  it("exports the class and default limits", () => {
    expect(typeof ConflictDetector).toBe("function");
    expect(DEFAULT_DETECTION_LIMITS.maxFindingsPerTopic).toBe(20);
    expect(DEFAULT_DETECTION_LIMITS.maxPairsPerDetectionPass).toBe(200);
  });
});
