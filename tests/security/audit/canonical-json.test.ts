/**
 * P4.3-Sd1 — Canonical JSON test vectors
 *
 * Verifies deterministic key ordering, rejection of invalid types,
 * nested object handling, array preservation, and hash consistency.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canonicalStringify, canonicalHash, getDomainPrefix } from "../../../src/security/audit/canonical-json.js";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Test vectors — canonical output
// ---------------------------------------------------------------------------

describe("canonicalStringify", () => {
  it("sorts keys alphabetically", () => {
    const input = { z: 1, a: 2, m: 3 };
    const result = canonicalStringify(input);
    assert.equal(result, '{"a":2,"m":3,"z":1}');
  });

  it("is independent of key insertion order", () => {
    const a = { alpha: 1, beta: 2, gamma: 3 };
    const b = { gamma: 3, alpha: 1, beta: 2 };
    assert.equal(canonicalStringify(a), canonicalStringify(b));
  });

  it("handles nested objects with recursive key sorting", () => {
    const input = {
      outer: { z: 10, a: 20 },
      inner: { m: 100, b: 200 },
    };
    const result = canonicalStringify(input);
    assert.equal(result, '{"inner":{"b":200,"m":100},"outer":{"a":20,"z":10}}');
  });

  it("preserves array element order", () => {
    const input = { items: [3, 1, 2] };
    const result = canonicalStringify(input);
    assert.equal(result, '{"items":[3,1,2]}');
  });

  it("serializes null", () => {
    assert.equal(canonicalStringify(null), "null");
    assert.equal(canonicalStringify({ x: null }), '{"x":null}');
  });

  it("serializes booleans", () => {
    assert.equal(canonicalStringify(true), "true");
    assert.equal(canonicalStringify(false), "false");
  });

  it("serializes strings with standard JSON escaping", () => {
    assert.equal(canonicalStringify("hello"), '"hello"');
    assert.equal(canonicalStringify('quote"test'), String.raw`"quote\"test"`);
    assert.equal(canonicalStringify("back\\slash"), String.raw`"back\\slash"`);
    assert.equal(canonicalStringify("tab\there"), '"tab\\there"');
  });

  it("serializes -0 as 0", () => {
    assert.equal(canonicalStringify(-0), "0");
    assert.equal(canonicalStringify({ val: -0 }), '{"val":0}');
  });

  it("handles an empty object", () => {
    assert.equal(canonicalStringify({}), "{}");
  });

  it("handles an empty array", () => {
    assert.equal(canonicalStringify([]), "[]");
  });

  it("handles deeply nested structures", () => {
    const input = {
      level1: {
        level2: {
          z: "last",
          a: "first",
        },
      },
    };
    const result = canonicalStringify(input);
    assert.equal(result, '{"level1":{"level2":{"a":"first","z":"last"}}}');
  });

  it("handles arrays of objects", () => {
    const input = [
      { b: 2, a: 1 },
      { d: 4, c: 3 },
    ];
    const result = canonicalStringify(input);
    assert.equal(result, '[{"a":1,"b":2},{"c":3,"d":4}]');
  });

  // -----------------------------------------------------------------------
  // Rejection of invalid types
  // -----------------------------------------------------------------------

  it("rejects NaN", () => {
    assert.throws(
      () => canonicalStringify(NaN),
      { name: "TypeError", message: /non-finite/ },
    );
    assert.throws(
      () => canonicalStringify({ val: NaN }),
      { name: "TypeError", message: /non-finite/ },
    );
  });

  it("rejects Infinity", () => {
    assert.throws(
      () => canonicalStringify(Infinity),
      { name: "TypeError", message: /non-finite/ },
    );
    assert.throws(
      () => canonicalStringify({ val: Infinity }),
      { name: "TypeError", message: /non-finite/ },
    );
  });

  it("rejects -Infinity", () => {
    assert.throws(
      () => canonicalStringify(-Infinity),
      { name: "TypeError", message: /non-finite/ },
    );
  });

  it("rejects undefined", () => {
    assert.throws(
      () => canonicalStringify(undefined),
      { name: "TypeError", message: /undefined/ },
    );
  });

  it("rejects functions", () => {
    assert.throws(
      () => canonicalStringify(() => {}),
      { name: "TypeError", message: /function/ },
    );
    assert.throws(
      () => canonicalStringify({ fn() {} }),
      { name: "TypeError", message: /function/ },
    );
  });

  it("rejects symbols", () => {
    assert.throws(
      () => canonicalStringify(Symbol("test")),
      { name: "TypeError", message: /symbol/ },
    );
  });

  it("rejects bigint", () => {
    assert.throws(
      () => canonicalStringify(BigInt(1)),
      { name: "TypeError", message: /symbol/ },
    );
  });
});

// ---------------------------------------------------------------------------
// Test vectors — canonicalHash
// ---------------------------------------------------------------------------

describe("canonicalHash", () => {
  it("includes the domain prefix in the hash", () => {
    const value = { action: "test" };
    const hash = canonicalHash(value);
    const canonical = canonicalStringify(value);
    const domainPrefix = getDomainPrefix();

    // Manually compute the expected hash.
    const expected = createHash("sha256").update(domainPrefix + canonical, "utf8").digest("hex");
    assert.equal(hash, expected);
  });

  it("produces the same hash for the same canonical value regardless of key order", () => {
    const a = { action: "login", timestamp: 1000, actor: "alice" };
    const b = { actor: "alice", timestamp: 1000, action: "login" };
    assert.equal(canonicalHash(a), canonicalHash(b));
  });

  it("produces different hashes for different values", () => {
    const h1 = canonicalHash({ action: "login" });
    const h2 = canonicalHash({ action: "logout" });
    assert.notEqual(h1, h2);
  });

  it("produces hex output of correct length", () => {
    const hash = canonicalHash({ test: true });
    assert.equal(hash.length, 64); // SHA-256 hex is 64 chars
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("throws on invalid values", () => {
    assert.throws(
      () => canonicalHash(NaN),
      { name: "TypeError", message: /non-finite/ },
    );
  });

  it("is deterministic across calls", () => {
    const value = { seq: 1, action: "auth.success", timestamp: 1234567890 };
    const h1 = canonicalHash(value);
    const h2 = canonicalHash(value);
    assert.equal(h1, h2);
  });
});

// ---------------------------------------------------------------------------
// Domain prefix
// ---------------------------------------------------------------------------

describe("getDomainPrefix", () => {
  it("returns the expected prefix", () => {
    assert.equal(getDomainPrefix(), "alix-audit-v1:");
  });
});
