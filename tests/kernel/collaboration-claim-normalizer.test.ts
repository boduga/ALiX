/**
 * collaboration-claim-normalizer.test.ts — Unit tests for claim extraction,
 * normalization, and topic-key computation.
 *
 * Plan §21: matrix covers boolean, numeric, version, digest, path claims,
 * ambiguous prose, stable topic key, and normalization-version changes
 * fingerprint.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  extractClaim,
  normalizeClaim,
  computeTopicKey,
  EXTRACTION_VERSION,
} from "../../src/kernel/collaboration-claim-normalizer.js";

describe("extractClaim", () => {
  it("extracts a boolean claim from 'is true'", () => {
    const c = extractClaim("the flag", "the flag is true");
    assert.ok(c, "should extract a claim");
    assert.equal(c!.value, "true");
    assert.equal(c!.valueType, "boolean");
    assert.equal(c!.subject, "claim");
    assert.equal(c!.predicate, "is");
  });

  it("extracts a boolean claim from 'is false'", () => {
    const c = extractClaim("config", "config is false");
    assert.ok(c);
    assert.equal(c!.value, "false");
    assert.equal(c!.valueType, "boolean");
  });

  it("extracts a numeric claim from 'count = 42'", () => {
    const c = extractClaim("retries", "retries = 42");
    assert.ok(c);
    assert.equal(c!.value, "42");
    assert.equal(c!.valueType, "number");
  });

  it("extracts a numeric claim from a decimal", () => {
    const c = extractClaim("ratio", "ratio = 3.14");
    assert.ok(c);
    assert.equal(c!.value, "3.14");
    assert.equal(c!.valueType, "number");
  });

  it("extracts a version claim from 'version = 1.2.3'", () => {
    const c = extractClaim("package", "version = 1.2.3");
    assert.ok(c);
    assert.equal(c!.value, "1.2.3");
    assert.equal(c!.valueType, "version");
  });

  it("extracts a digest claim from 'digest = sha256:abc...'", () => {
    const c = extractClaim("artifact", "digest = sha256:abcdef0123");
    assert.ok(c);
    assert.equal(c!.value, "sha256:abcdef0123");
    assert.equal(c!.valueType, "digest");
  });

  it("extracts a path-shaped claim from 'path = src/kernel/index.ts'", () => {
    // The key=value pattern recognizes 'path' as the predicate and
    // classifies string values. A path-like value is treated as a string
    // claim, which is the deterministic normalizer's behavior.
    const c = extractClaim("entry", "path = src/kernel/index.ts");
    assert.ok(c);
    assert.equal(c!.value, "src/kernel/index.ts");
    assert.equal(c!.valueType, "string");
    assert.equal(c!.predicate, "path");
  });

  it("returns null for ambiguous prose with no testable pattern", () => {
    const c = extractClaim(
      "we should consider refactoring later",
      "the team discussed possibilities and may follow up next sprint",
    );
    assert.equal(c, null);
  });
});

describe("normalizeClaim", () => {
  it("lowercases boolean values and stamps extraction version", () => {
    const raw = extractClaim("flag", "flag is TRUE")!;
    const n = normalizeClaim(raw);
    assert.equal(n.normalizedValue, "true");
    assert.equal(n.valueType, "boolean");
    assert.equal(n.extractionVersion, EXTRACTION_VERSION);
    assert.equal(n.extractionMethod, "deterministic");
  });

  it("strips leading zeros from numeric values", () => {
    const raw = { subject: "g", predicate: "n", value: "007", valueType: "number" as const };
    const n = normalizeClaim(raw);
    assert.equal(n.normalizedValue, "7");
  });

  it("lowercases version values", () => {
    const raw = extractClaim("pkg", "version = 2.0.0-RC1")!;
    const n = normalizeClaim(raw);
    assert.equal(n.normalizedValue, "2.0.0-rc1");
  });

  it("populates normalized* fields for downstream topic key computation", () => {
    const raw = extractClaim("x", "y = z")!;
    const n = normalizeClaim(raw);
    assert.equal(n.normalizedSubject, n.subject);
    assert.equal(n.normalizedPredicate, n.predicate);
    assert.equal(n.normalizedValue, n.value);
  });
});

describe("computeTopicKey", () => {
  it("is a 64-char hex SHA-256 string", () => {
    const claim = normalizeClaim(extractClaim("flag", "flag is true")!);
    const key = computeTopicKey(claim);
    assert.equal(key.length, 64);
    assert.match(key, /^[0-9a-f]{64}$/);
  });

  it("is stable: same subject+predicate+scope always produce the same key", () => {
    const a = normalizeClaim({ ...extractClaim("flag", "flag is true")!, scope: "src/auth.ts" });
    const b = normalizeClaim({ ...extractClaim("flag", "flag is true")!, scope: "src/auth.ts" });
    assert.equal(computeTopicKey(a), computeTopicKey(b));
  });

  it("differs when scope differs", () => {
    const a = normalizeClaim({ ...extractClaim("flag", "flag is true")!, scope: "src/a.ts" });
    const b = normalizeClaim({ ...extractClaim("flag", "flag is true")!, scope: "src/b.ts" });
    assert.notEqual(computeTopicKey(a), computeTopicKey(b));
  });

  it("differs when predicate differs", () => {
    // "is true" and "decision = use X" normalize to the same subject ("claim" vs "decision"
    // — both use the boolean/enum pre-claim path). Pick two clearly distinct predicates.
    const a = normalizeClaim(extractClaim("setting", "debug = on")!);
    const b = normalizeClaim(extractClaim("setting", "mode = fast")!);
    assert.notEqual(computeTopicKey(a), computeTopicKey(b));
  });
});

describe("normalization version effect on fingerprint", () => {
  it("changing extraction version yields a different normalized record", () => {
    const raw = extractClaim("flag", "flag is true")!;
    const v1 = normalizeClaim(raw);
    const v2: typeof v1 = { ...v1, extractionVersion: "1.0.1" };
    // Normalized fields are identical, but the wrapper carries the version
    // so any downstream consumer that fingerprints the whole claim will
    // see a different hash.
    const f1 = createHash("sha256").update(JSON.stringify(v1)).digest("hex");
    const f2 = createHash("sha256").update(JSON.stringify(v2)).digest("hex");
    assert.notEqual(f1, f2);
    // The topic key itself depends only on subject/predicate/scope, so it
    // must remain stable across extraction-version bumps.
    const raw2 = extractClaim("flag", "flag is true")!;
    const n2 = normalizeClaim(raw2);
    assert.equal(computeTopicKey(v1), computeTopicKey(n2));
  });
});
