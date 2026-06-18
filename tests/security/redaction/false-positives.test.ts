/**
 * P4.3-Sa1 — False-positive avoidance tests.
 *
 * Verifies that benign key names like `keyboardLayout`, `monkeyPatch`,
 * `tokenizer`, `tokenCount`, `secretSanta`, `passwordResetUrl`,
 * `apiVersion`, `credentialsFile`, and `apiKey` (as a value key, not a
 * credential-bearing one) pass through without redaction.
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

describe("false positive avoidance", () => {
  // =======================================================================
  // Benign key names
  // =======================================================================

  describe("benign key names are NOT redacted", () => {
    it("keyboardLayout passes through", () => {
      const input = { keyboardLayout: "qwerty" };
      const result = redactValue(input, policy, detector) as Record<string, string>;
      assert.equal(result.keyboardLayout, "qwerty");
    });

    it("monkeyPatch passes through", () => {
      const input = { monkeyPatch: "some function" };
      const result = redactValue(input, policy, detector) as Record<string, string>;
      assert.equal(result.monkeyPatch, "some function");
    });

    it("tokenizer passes through", () => {
      const input = { tokenizer: "gpt-4" };
      const result = redactValue(input, policy, detector) as Record<string, string>;
      assert.equal(result.tokenizer, "gpt-4");
    });

    it("tokenCount passes through", () => {
      const input = { tokenCount: 1500 };
      const result = redactValue(input, policy, detector) as Record<string, number>;
      assert.equal(result.tokenCount, 1500);
    });

    it("secretSanta passes through", () => {
      const input = { secretSanta: "Alice" };
      const result = redactValue(input, policy, detector) as Record<string, string>;
      assert.equal(result.secretSanta, "Alice");
    });

    it("passwordResetUrl passes through", () => {
      const input = { passwordResetUrl: "https://example.com/reset" };
      const result = redactValue(input, policy, detector) as Record<string, string>;
      assert.equal(result.passwordResetUrl, "https://example.com/reset");
    });

    it("apiVersion passes through", () => {
      const input = { apiVersion: "v1" };
      const result = redactValue(input, policy, detector) as Record<string, string>;
      assert.equal(result.apiVersion, "v1");
    });

    it("credentialsFile passes through as key name", () => {
      const input = { credentialsFile: "/path/to/file" };
      const result = redactValue(input, policy, detector) as Record<string, string>;
      assert.equal(result.credentialsFile, "/path/to/file");
    });
  });

  // =======================================================================
  // False-positive detector patterns
  // =======================================================================

  describe("benign strings are NOT flagged as secrets", () => {
    it("a short hex string does not trigger", () => {
      const spans = detector.detect("abc123");
      // "abc123" should not match any pattern
      assert.equal(spans.length, 0);
    });

    it("a normal sentence does not trigger", () => {
      const spans = detector.detect("The quick brown fox jumps over the lazy dog.");
      assert.equal(spans.length, 0);
    });

    it("a URL without credentials does not trigger", () => {
      const spans = detector.detect("https://example.com/api/v1/users");
      assert.equal(spans.length, 0);
    });
  });

  // =======================================================================
  // keyIsSensitive exact match
  // =======================================================================

  describe("keyIsSensitive is exact match", () => {
    it("does not match substrings of sensitive keys", () => {
      // We need to test via the redactor
      const input = {
        tokenizer: "preserve me",
        tokenCount: "preserve me",
        keyboardLayout: "preserve me",
        monkeyPatch: "preserve me",
        secretSanta: "preserve me",
        passwordResetUrl: "preserve me",
        apiVersion: "preserve me",
        credentialsFile: "preserve me",
      };

      const result = redactValue(input, policy, detector) as Record<string, string>;
      assert.equal(result.tokenizer, "preserve me");
      assert.equal(result.tokenCount, "preserve me");
      assert.equal(result.keyboardLayout, "preserve me");
      assert.equal(result.monkeyPatch, "preserve me");
      assert.equal(result.secretSanta, "preserve me");
      assert.equal(result.passwordResetUrl, "preserve me");
      assert.equal(result.apiVersion, "preserve me");
      assert.equal(result.credentialsFile, "preserve me");
    });

    it("does exactly match sensitive keys", () => {
      const input = {
        token: "redact me",
        secret: "redact me",
        password: "redact me",
        apiKey: "redact me",
        api_key: "redact me",
        accessToken: "redact me",
      };

      const result = redactValue(input, policy, detector) as Record<string, string>;
      assert.equal(result.token, "[REDACTED]");
      assert.equal(result.secret, "[REDACTED]");
      assert.equal(result.password, "[REDACTED]");
      assert.equal(result.apiKey, "[REDACTED]");
      assert.equal(result.api_key, "[REDACTED]");
      assert.equal(result.accessToken, "[REDACTED]");
    });
  });

  // =======================================================================
  // toJSON not interfering
  // =======================================================================

  describe("toJSON is not invoked for false-positive checks", () => {
    it("a class with toJSON is walked raw, not serialised", () => {
      class SafeConfig {
        token = "sk-abcdefghijklmnopqrstuvwxyz123456";
        toJSON() {
          return { token: "clean-token" };
        }
      }

      const instance = new SafeConfig();
      const result = redactValue(instance, policy, detector) as unknown as Record<string, unknown>;

      // toJSON should NOT be called, so the raw object with the real
      // token should be walked
      assert.ok(
        (result.token as string).includes("[REDACTED_API_KEY]") ||
          result.token === "[REDACTED]",
        `Expected redacted token, got: ${String(result.token)}`,
      );
    });
  });

  // =======================================================================
  // Explicit secret patterns override key-based allowlist
  // =======================================================================

  describe("explicit secret patterns override key-based allowlist", () => {
    it("redacts a matching pattern even under a non-sensitive key", () => {
      // "displayName" is NOT in the sensitive keys list, but its value
      // IS an explicit API key
      const input = {
        displayName: "sk-abcdefghijklmnopqrstuvwxyz123456",
      };

      const result = redactValue(input, policy, detector) as Record<string, string>;
      assert.ok(
        (result.displayName as string).includes("[REDACTED_API_KEY]"),
        `Expected marker in displayName: ${result.displayName}`,
      );
    });
  });
});
