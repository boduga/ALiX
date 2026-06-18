/**
 * P4.3-Sa1 — Redactor limits tests.
 *
 * Tests cyclic graphs, huge strings, huge arrays, deep objects.
 * Verifies limits are deterministic (same input -> same output).
 * Verifies truncation behavior and sentinel values.
 *
 * @module
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SecretDetector } from "../../../src/security/redaction/secret-detector.js";
import { createRedactionPolicy } from "../../../src/security/redaction/redaction-policy.js";
import { redactValue } from "../../../src/security/redaction/redactor.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const detector = new SecretDetector();
const policy = createRedactionPolicy("public");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("redactValue (limits)", () => {
  // =======================================================================
  // Cyclic graphs
  // =======================================================================

  describe("cyclic graphs", () => {
    it("handles a direct self-reference", () => {
      const obj: Record<string, unknown> = { name: "test" };
      obj.self = obj;
      const result = redactValue(obj, policy, detector) as unknown as Record<string, unknown>;
      assert.equal(result.name, "test");
      assert.equal(result.self, "[CIRCULAR_REFERENCE]");
    });

    it("handles indirect cycles (A -> B -> A)", () => {
      const a: Record<string, unknown> = { name: "A" };
      const b: Record<string, unknown> = { name: "B", sibling: a };
      a.sibling = b;

      const result = redactValue(a, policy, detector) as unknown as Record<string, unknown>;
      assert.equal(result.name, "A");
      const bResult = result.sibling as unknown as Record<string, unknown>;
      assert.equal(bResult.name, "B");
      assert.equal(bResult.sibling, "[CIRCULAR_REFERENCE]");
    });

    it("handles Map with circular reference", () => {
      const map = new Map<string, unknown>();
      map.set("self", map);
      const result = redactValue(map, policy, detector) as unknown as Record<string, unknown>;
      assert.equal(result.self, "[CIRCULAR_REFERENCE]");
    });
  });

  // =======================================================================
  // Deep objects
  // =======================================================================

  describe("deep objects (max depth)", () => {
    // Build an object nested `depth` levels deep
    function buildDeep(depth: number): Record<string, unknown> {
      if (depth <= 0) return { value: "leaf" };
      return { child: buildDeep(depth - 1) };
    }

    it("truncates at max depth (default 12)", () => {
      const deep = buildDeep(15); // Exceeds default maxDepth of 12
      const result = redactValue(deep, policy, detector) as unknown as Record<string, unknown>;

      // Walk down — sentinel sits at depth (maxDepth + 1) = 13
      let current = result;
      for (let i = 0; i < 13; i++) {
        assert.ok(
          current && typeof current === "object",
          `Expected object at depth ${i}, got ${String(current)}`,
        );
        current = current.child as unknown as Record<string, unknown>;
      }
      // At depth 13: sentinel
      assert.equal(current, "[MAX_DEPTH_REACHED]");
    });

    it("respects a custom maxDepth", () => {
      const shallowPolicy = createRedactionPolicy("public", { maxDepth: 3 });
      const deep = buildDeep(5);
      const result = redactValue(deep, shallowPolicy, detector) as unknown as Record<string, unknown>;

      let current = result;
      for (let i = 0; i < 4; i++) {
        assert.ok(
          current && typeof current === "object",
          `Expected object at depth ${i}`,
        );
        current = current.child as unknown as Record<string, unknown>;
      }
      assert.equal(current, "[MAX_DEPTH_REACHED]");
    });
  });

  // =======================================================================
  // Large objects (max properties)
  // =======================================================================

  describe("large objects (max properties)", () => {
    it("truncates at maxProperties (default 200)", () => {
      const input: Record<string, number> = {};
      for (let i = 0; i < 300; i++) {
        input[`key_${i}`] = i;
      }
      const result = redactValue(input, policy, detector) as unknown as Record<string, unknown>;
      const keys = Object.keys(result);
      assert.ok(keys.length <= 200, `Expected <= 200 keys, got ${keys.length}`);
    });

    it("respects a custom maxProperties", () => {
      const customPolicy = createRedactionPolicy("public", { maxProperties: 5 });
      const input: Record<string, number> = {};
      for (let i = 0; i < 20; i++) {
        input[`key_${i}`] = i;
      }
      const result = redactValue(input, customPolicy, detector) as unknown as Record<string, unknown>;
      const keys = Object.keys(result);
      assert.ok(keys.length <= 5, `Expected <= 5 keys, got ${keys.length}`);
    });
  });

  // =======================================================================
  // Large arrays
  // =======================================================================

  describe("large arrays (max array items)", () => {
    it("truncates at maxArrayItems (default 1000)", () => {
      const input = new Array(5000).fill("safe");
      const result = redactValue(input, policy, detector) as unknown as unknown[];
      assert.ok(result.length <= 1000, `Expected <= 1000 items, got ${result.length}`);
    });

    it("respects a custom maxArrayItems", () => {
      const customPolicy = createRedactionPolicy("public", { maxArrayItems: 10 });
      const input = new Array(100).fill("safe");
      const result = redactValue(input, customPolicy, detector) as unknown as unknown[];
      assert.ok(result.length <= 10, `Expected <= 10 items, got ${result.length}`);
    });
  });

  // =======================================================================
  // Large output
  // =======================================================================

  describe("large output (max output bytes)", () => {
    it("returns sentinel when output exceeds maxOutputBytes", () => {
      const tinyPolicy = createRedactionPolicy("public", { maxOutputBytes: 10 });
      const input = { data: "x".repeat(1000) };
      const result = redactValue(input, tinyPolicy, detector);
      assert.equal(result, "[MAX_OUTPUT_EXCEEDED]");
    });
  });

  // =======================================================================
  // Determinism
  // =======================================================================

  describe("determinism", () => {
    it("produces the same output for the same input", () => {
      const input = {
        name: "test",
        token: "sk-abcdefghijklmnopqrstuvwxyz123456",
        nested: {
          password: "supersecret",
        },
      };

      const result1 = redactValue(input, policy, detector);
      const result2 = redactValue(input, policy, detector);

      assert.deepEqual(result1, result2);
    });

    it("produces the same output for deterministic error inputs", () => {
      const input = { error: new Error("test") };
      const result1 = redactValue(input, policy, detector) as unknown as Record<string, unknown>;
      const result2 = redactValue(input, policy, detector) as unknown as Record<string, unknown>;
      assert.equal((result1.error as Record<string, string>).message, "test");
      assert.equal((result2.error as Record<string, string>).message, "test");
    });
  });

  // =======================================================================
  // Large string handling
  // =======================================================================

  describe("large strings", () => {
    it("handles strings longer than MAX_STRING_SCAN without crashing", () => {
      // The detector truncates internally at MAX_STRING_SCAN (65536)
      const long = "x".repeat(100000);
      const result = redactValue(long, policy, detector);
      assert.equal(typeof result, "string");
      // String should not contain any secrets
    });

    it("redacts very long secret-bearing strings", () => {
      const sk = "sk-abcdefghijklmnopqrstuvwxyz123456";
      const long = sk + "x".repeat(70000);
      const result = redactValue(long, policy, detector);
      assert.equal(typeof result, "string");
      assert.ok((result as string).includes("[REDACTED_API_KEY]"));
    });
  });
});
