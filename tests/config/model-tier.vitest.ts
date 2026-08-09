import { describe, it, expect } from "vitest";
import {
  MODEL_SUBAGENT_TIERS,
  MODEL_TIER_VALUES,
  isModelTier,
} from "../../src/config/schema.js";
import type { ModelTier } from "../../src/config/schema.js";
import { PROFILE_TIER_MAP } from "../../src/config/profile-types.js";

describe("canonical configuration tier vocabulary (schema.ts)", () => {
  it("MODEL_TIER_VALUES is the canonical closed tier set", () => {
    expect(MODEL_TIER_VALUES).toEqual([
      "default",
      "thinking",
      "coding",
      "fast",
      "critic",
      "tiny",
      "image",
    ]);
  });

  it("MODEL_SUBAGENT_TIERS is exactly the six non-default tiers", () => {
    expect(MODEL_SUBAGENT_TIERS).toEqual([
      "thinking",
      "coding",
      "fast",
      "critic",
      "tiny",
      "image",
    ]);
  });

  it("accepts every canonical tier", () => {
    for (const tier of MODEL_TIER_VALUES) {
      expect(isModelTier(tier)).toBe(true);
    }
  });

  it("accepts 'coding' as a configuration tier", () => {
    expect(isModelTier("coding")).toBe(true);
  });

  it("rejects profile-only vocabulary as configuration tiers", () => {
    // Profile vocabulary must NOT be valid configuration tiers.
    expect(isModelTier("coder")).toBe(false);
    expect(isModelTier("planner")).toBe(false);
    expect(isModelTier("researcher")).toBe(false);
    expect(isModelTier("embeddings")).toBe(false);
    expect(isModelTier("classifier")).toBe(false);
  });

  it("rejects arbitrary strings", () => {
    expect(isModelTier("bogus")).toBe(false);
    expect(isModelTier("")).toBe(false);
  });

  it("isModelTier narrows a string to ModelTier when canonical", () => {
    const input: string = "coding";
    if (isModelTier(input)) {
      // Compile-time proof of type-guard narrowing: assignable to ModelTier.
      const tier: ModelTier = input;
      expect(tier).toBe("coding");
    } else {
      expect.unreachable();
    }
  });
});

describe("PROFILE_TIER_MAP (profile-types.ts)", () => {
  it("maps profile 'coder' to configuration 'coding'", () => {
    expect(PROFILE_TIER_MAP["coder"]).toBe("coding");
  });

  it("maps profile 'classifier' to no configuration tier", () => {
    expect(PROFILE_TIER_MAP["classifier"]).toBeUndefined();
  });

  it("is the complete profile-to-config tier mapping", () => {
    expect(PROFILE_TIER_MAP).toEqual({
      default: "default",
      planner: "thinking",
      researcher: "fast",
      coder: "coding",
      critic: "critic",
      embeddings: "tiny",
      classifier: undefined,
    });
  });
});
