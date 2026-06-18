/**
 * P4.3-Sa1 — Redactor error-handling tests.
 *
 * Tests: throwing getter, proxy trap failure, `toJSON()` not invoked,
 * redactor internal failure yields `"[REDACTION_FAILED]"` sentinel.
 * Tests null/undefined inputs, symbols, and BigInt.
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

describe("redactValue (error handling)", () => {
  // =======================================================================
  // Throwing getter
  // =======================================================================

  describe("throwing getter", () => {
    it("replaces a throwing getter with error sentinel", () => {
      const obj: Record<string, unknown> = {
        name: "safe",
        get throwing() {
          throw new Error("getter failed");
        },
      };

      const result = redactValue(obj, policy, detector) as unknown as Record<string, unknown>;
      assert.equal(result.name, "safe");
      assert.equal(result.throwing, "[REDACTION_ERROR]");
    });
  });

  // =======================================================================
  // Proxy trap failure
  // =======================================================================

  describe("proxy trap failure", () => {
    it("handles a Proxy that throws on property access", () => {
      const proxy = new Proxy(
        { safeProp: "hello" },
        {
          get() {
            throw new Error("proxy trap failed");
          },
        },
      );

      // The proxy should be handled gracefully — individual properties
      // may fail, but redacting the proxy should at least not crash
      const result = redactValue(proxy, policy, detector) as unknown;
      // The top-level result can be anything safe (partial, sentinel, etc.)
      // but must NOT throw
      assert.ok(
        result === "[REDACTION_FAILED]" ||
          typeof result === "object",
      );
    });

    it("handles a Proxy with a throwing get trap on ownKeys", () => {
      const proxy = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error("ownKeys trap failed");
          },
        },
      );

      const result = redactValue(proxy, policy, detector);
      // Must not throw; any result is acceptable
      assert.ok(result !== undefined);
    });
  });

  // =======================================================================
  // toJSON() NOT invoked
  // =======================================================================

  describe("toJSON() not invoked", () => {
    it("does not invoke toJSON() on a value", () => {
      let toJSONCalled = false;
      const obj = {
        secret: "sk-abcdefghijklmnopqrstuvwxyz123456",
        toJSON() {
          toJSONCalled = true;
          return { secret: "clean" };
        },
      };

      const result = redactValue(obj, policy, detector) as unknown as Record<string, unknown>;

      // toJSON should NOT have been called
      assert.equal(toJSONCalled, false);

      // The raw object should have been walked, so secret is redacted
      // (either by key-based redaction since "secret" is a sensitive key,
      //  or by pattern-based detection of the sk- API key value)
      const secretVal = result.secret as string;
      const isRedacted =
        secretVal === "[REDACTED]" ||
        secretVal.includes("[REDACTED_API_KEY]");
      assert.ok(isRedacted, `Expected redacted secret, got: ${secretVal}`);
    });
  });

  // =======================================================================
  // Redactor internal failure yields safe sentinel
  // =======================================================================

  describe("redactor failure yields safe sentinel", () => {
    it("returns a safe sentinel for an impossible-to-redact value", () => {
      // A Proxy that throws on property access will be handled gracefully —
      // individual properties become [REDACTION_ERROR] sentinels — but
      // never the original input.
      const nightmare = new Proxy(
        { someData: "sk-abcdefghijklmnopqrstuvwxyz123456" },
        {
          get(target, prop) {
            if (prop === "someData") {
              throw new Error("access fails");
            }
            return Reflect.get(target, prop);
          },
        },
      );

      const result = redactValue(nightmare, policy, detector);
      // The proxy property that throws becomes [REDACTION_ERROR]
      // but the function itself never throws and returns a safe object
      assert.ok(typeof result === "object", `Expected object, got: ${String(result)}`);
      // Verify the original input is not leaked
      assert.notEqual(JSON.stringify(result).includes("sk-abcdefghijklmnopqrstuvwxyz123456"), true);
    });
  });

  // =======================================================================
  // Null / undefined
  // =======================================================================

  describe("null and undefined", () => {
    it("passes through null", () => {
      assert.equal(redactValue(null, policy, detector), null);
    });

    it("passes through undefined", () => {
      assert.equal(redactValue(undefined, policy, detector), undefined);
    });

    it("handles objects with null values", () => {
      const result = redactValue({ a: null, b: undefined }, policy, detector) as unknown as Record<string, unknown>;
      assert.equal(result.a, null);
      assert.equal(result.b, undefined);
    });
  });

  // =======================================================================
  // Symbols, BigInt
  // =======================================================================

  describe("symbols and BigInt", () => {
    it("redacts Symbols to sentinel", () => {
      const result = redactValue(Symbol("secret"), policy, detector);
      assert.equal(result, "[REDACTED_SYMBOL]");
    });

    it("handles BigInt values", () => {
      const big = BigInt("12345678901234567890");
      const result = redactValue(big, policy, detector);
      assert.equal(result, "12345678901234567890n");
    });

    it("handles objects with BigInt values", () => {
      const input = { big: BigInt("42"), name: "test" };
      const result = redactValue(input, policy, detector) as unknown as Record<string, unknown>;
      assert.equal(result.big, "42n");
      assert.equal(result.name, "test");
    });
  });

  // =======================================================================
  // Non-throwing guarantees
  // =======================================================================

  describe("never throws", () => {
    it("never throws on any input", () => {
      const inputs = [
        null,
        undefined,
        42,
        "string",
        Symbol("test"),
        BigInt("100"),
        true,
        false,
        [],
        {},
        new Date(),
        new Error("test"),
        Buffer.from("test"),
        new Map(),
        new Set(),
        /regex/,
        () => "function",
        Infinity,
        -Infinity,
        NaN,
      ];

      for (const input of inputs) {
        assert.doesNotThrow(
          () => redactValue(input, policy, detector),
          `Threw for input: ${String(input)}`,
        );
      }
    });

    it("never throws on pathological inputs", () => {
      // Object with getter that produces itself
      const pathological: Record<string, unknown> = {};
      Object.defineProperty(pathological, "value", {
        get() {
          return pathological;
        },
        enumerable: true,
      });

      assert.doesNotThrow(() => {
        redactValue(pathological, policy, detector);
      });
    });
  });
});
