/**
 * P4.3-Sa1 — Redactor tests (core behavior).
 *
 * Tests redaction of secrets nested in arrays, objects, Error
 * message/cause, Map, Set, Buffer, Date.  Tests key-based redaction
 * (sensitive key names) and the rule that explicit secret patterns
 * override any allowlist.
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

describe("redactValue (core)", () => {
  // =======================================================================
  // Secrets in strings
  // =======================================================================

  describe("string redaction", () => {
    it("redacts an inline API key in a string", () => {
      const result = redactValue(
        "api_key = sk-abcdefghijklmnopqrstuvwxyz123456",
        policy,
        detector,
      );
      assert.equal(typeof result, "string");
      assert.ok(
        (result as string).includes("[REDACTED_API_KEY]"),
        `Expected marker in result: ${result}`,
      );
      assert.ok(
        !(result as string).includes("sk-abcdefghijklmnopqrstuvwxyz123456"),
      );
    });

    it("passes through safe strings unchanged", () => {
      const result = redactValue("hello world", policy, detector);
      assert.equal(result, "hello world");
    });
  });

  // =======================================================================
  // Secrets nested in arrays
  // =======================================================================

  describe("arrays", () => {
    it("redacts secrets inside array elements", () => {
      const input = [
        "safe text",
        "sk-abcdefghijklmnopqrstuvwxyz123456",
        "more safe text",
      ];
      const result = redactValue(input, policy, detector) as string[];
      assert.ok(result[1].includes("[REDACTED_API_KEY]"));
      assert.equal(result[0], "safe text");
      assert.equal(result[2], "more safe text");
    });

    it("handles empty arrays", () => {
      const result = redactValue([], policy, detector);
      assert.deepEqual(result, []);
    });
  });

  // =======================================================================
  // Secrets nested in objects
  // =======================================================================

  describe("objects", () => {
    it("redacts secrets inside nested object values", () => {
      const input = {
        name: "test",
        credentials: "sk-abcdefghijklmnopqrstuvwxyz123456",
        nested: {
          token: "ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ",
        },
      };
      const result = redactValue(input, policy, detector) as unknown as Record<string, unknown>;
      assert.equal(result.name, "test");
      // "credentials" is a sensitive key name, so the entire value is redacted
      assert.equal(result.credentials, "[REDACTED]");
      const nestedResult = result.nested as unknown as Record<string, unknown>;
      // "token" is a sensitive key name, so the entire value is redacted
      assert.equal(nestedResult.token, "[REDACTED]");
    });

    it("handles empty objects", () => {
      const result = redactValue({}, policy, detector) as unknown as Record<string, unknown>;
      assert.deepEqual(result, {});
    });
  });

  // =======================================================================
  // Key-based redaction
  // =======================================================================

  describe("key-based redaction", () => {
    it("redacts value for a sensitive key name", () => {
      const input = {
        token: "my-custom-token-value",
        name: "hello",
      };
      const result = redactValue(input, policy, detector) as Record<string, string>;
      assert.equal(result.name, "hello");
      assert.equal(result.token, "[REDACTED]");
    });

    it("does NOT redact value for benign key names", () => {
      const input = {
        tokenizer: "some value",
        monkeyPatch: "some value",
        keyboardLayout: "some value",
      };
      const result = redactValue(input, policy, detector) as Record<string, string>;
      assert.equal(result.tokenizer, "some value");
      assert.equal(result.monkeyPatch, "some value");
      assert.equal(result.keyboardLayout, "some value");
    });
  });

  // =======================================================================
  // Explicit secret pattern overrides allowlist
  // =======================================================================

  describe("explicit secret pattern overrides allowlist", () => {
    it("redacts an explicit API key even under a benign key name", () => {
      const input = {
        // "keyboardLayout" is a benign key, but the value is an explicit secret
        keyboardLayout: "sk-abcdefghijklmnopqrstuvwxyz123456",
      };
      const result = redactValue(input, policy, detector) as Record<string, string>;
      assert.ok(
        (result.keyboardLayout as string).includes("[REDACTED_API_KEY]"),
        `Expected marker in keyboardLayout: ${result.keyboardLayout}`,
      );
    });
  });

  // =======================================================================
  // Error redaction
  // =======================================================================

  describe("Error redaction", () => {
    it("redacts the message of an Error", () => {
      const error = new Error("Connection failed: sk-abcdefghijklmnopqrstuvwxyz123456");
      const result = redactValue(error, policy, detector) as unknown as Record<string, unknown>;
      assert.ok(
        (result.message as string).includes("[REDACTED_API_KEY]"),
        `Expected marker in message: ${result.message}`,
      );
      assert.equal(result.name, "Error");
    });

    it("redacts the cause of an Error", () => {
      const cause = new Error("Cause contains: ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ");
      const error = new Error("Outer error", { cause });
      const result = redactValue(error, policy, detector) as unknown as Record<string, unknown>;
      const causeResult = result.cause as unknown as Record<string, unknown>;
      assert.ok((causeResult.message as string).includes("[REDACTED_API_KEY]"));
      assert.equal(causeResult.name, "Error");
    });
  });

  // =======================================================================
  // Map redaction
  // =======================================================================

  describe("Map redaction", () => {
    it("redacts values in a Map", () => {
      const map = new Map<string, string>([
        ["name", "test"],
        ["apiKey", "sk-abcdefghijklmnopqrstuvwxyz123456"],
      ]);
      const result = redactValue(map, policy, detector) as unknown as Record<string, unknown>;
      assert.equal(result.name, "test");
      assert.equal(result.apiKey, "[REDACTED]");
    });
  });

  // =======================================================================
  // Set redaction
  // =======================================================================

  describe("Set redaction", () => {
    it("redacts values in a Set", () => {
      const set = new Set<string>([
        "safe value",
        "sk-abcdefghijklmnopqrstuvwxyz123456",
      ]);
      const result = redactValue(set, policy, detector) as unknown as unknown[];
      assert.ok(
        (result[1] as string).includes("[REDACTED_API_KEY]") ||
          result[1] === "[REDACTED]",
      );
    });
  });

  // =======================================================================
  // Buffer / Binary
  // =======================================================================

  describe("Buffer / binary redaction", () => {
    it("redacts a Buffer to sentinel", () => {
      const buf = Buffer.from("some sensitive binary data");
      const result = redactValue(buf, policy, detector);
      assert.equal(result, "[REDACTED_BINARY]");
    });

    it("redacts a Uint8Array to sentinel", () => {
      const arr = new Uint8Array([1, 2, 3, 4]);
      const result = redactValue(arr, policy, detector);
      assert.equal(result, "[REDACTED_BINARY]");
    });
  });

  // =======================================================================
  // Date
  // =======================================================================

  describe("Date redaction", () => {
    it("returns an invalid Date for Date inputs", () => {
      const date = new Date("2024-01-01T00:00:00Z");
      const result = redactValue(date, policy, detector) as Date;
      assert.ok(result instanceof Date);
      assert.ok(Number.isNaN(result.getTime()));
    });
  });

  // =======================================================================
  // Primitives pass through
  // =======================================================================

  describe("primitives", () => {
    it("passes through booleans", () => {
      assert.equal(redactValue(true, policy, detector), true);
      assert.equal(redactValue(false, policy, detector), false);
    });

    it("passes through numbers", () => {
      assert.equal(redactValue(42, policy, detector), 42);
      assert.equal(redactValue(0, policy, detector), 0);
      assert.equal(redactValue(-1, policy, detector), -1);
      assert.equal(redactValue(3.14, policy, detector), 3.14);
    });

    it("passes through Infinity and NaN as strings", () => {
      assert.equal(redactValue(Infinity, policy, detector), "Infinity");
      assert.equal(redactValue(-Infinity, policy, detector), "-Infinity");
      assert.equal(redactValue(NaN, policy, detector), "NaN");
    });

    it("passes through null and undefined", () => {
      assert.equal(redactValue(null, policy, detector), null);
      assert.equal(redactValue(undefined, policy, detector), undefined);
    });
  });

  // =======================================================================
  // Headers and cookies as object properties
  // =======================================================================

  describe("auth headers and cookies", () => {
    it("redacts an Authorization header value in an object", () => {
      const input = {
        authorization: "Bearer sk-abcdefghijklmnopqrstuvwxyz123456",
        "content-type": "application/json",
      };
      const result = redactValue(input, policy, detector) as Record<string, string>;
      // "authorization" is a sensitive key
      assert.equal(result.authorization, "[REDACTED]");
      assert.equal(result["content-type"], "application/json");
    });
  });

  // =======================================================================
  // Credential-bearing URLs
  // =======================================================================

  describe("credential URLs in values", () => {
    it("redacts credential URLs in objects", () => {
      const input = {
        url: "https://admin:supersecret@db.example.com:5432/mydb",
      };
      const result = redactValue(input, policy, detector) as Record<string, string>;
      assert.ok(
        (result.url as string).includes("[REDACTED_CREDENTIAL_URL]"),
      );
    });
  });
});
