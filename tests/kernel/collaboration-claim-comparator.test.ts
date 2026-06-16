/**
 * collaboration-claim-comparator.test.ts — Unit tests for ClaimComparator.
 *
 * Plan §21: matrix covers true vs false (incompatible), same value
 * (compatible), different enum decisions, numeric within/beyond tolerance,
 * non-overlapping scopes (different_scope), ambiguous claims (uncertain),
 * and artifact digest mismatch.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ClaimComparator, COMPARATOR_VERSION } from "../../src/kernel/collaboration-claim-comparator.js";
import { normalizeClaim, extractClaim } from "../../src/kernel/collaboration-claim-normalizer.js";
import type { FindingClaim } from "../../src/kernel/collaboration-conflict-types.js";

const cmp = new ClaimComparator();

const claim = (title: string, content: string, scope?: string): FindingClaim => {
  const raw = extractClaim(title, content)!;
  return normalizeClaim({ ...raw, scope });
};

const manual = (overrides: Partial<FindingClaim>): FindingClaim => normalizeClaim(overrides);

describe("ClaimComparator", () => {
  it("flags true vs false as incompatible (contradiction)", () => {
    const left = claim("flag", "flag is true");
    const right = claim("flag", "flag is false");
    const result = cmp.compare(left, right, "L", "R");
    assert.equal(result.compatibility, "incompatible");
    assert.equal(result.type, "contradiction");
    assert.equal(result.comparatorVersion, COMPARATOR_VERSION);
    assert.equal(result.leftFindingId, "L");
    assert.equal(result.rightFindingId, "R");
  });

  it("treats same value as compatible", () => {
    const left = claim("flag", "flag is true");
    const right = claim("flag", "flag is true");
    const result = cmp.compare(left, right, "L", "R");
    assert.equal(result.compatibility, "compatible");
    assert.ok(result.reasons.some(r => r.includes("same value")));
  });

  it("treats different enum decisions in the same scope as competing decisions", () => {
    const left = claim("pick", "decision: use postgres", "src/db");
    const right = claim("pick", "decision: use mysql", "src/db");
    const result = cmp.compare(left, right, "L", "R");
    assert.equal(result.compatibility, "incompatible");
    assert.equal(result.type, "competing_decision");
  });

  it("treats numeric difference within tolerance as compatible", () => {
    const left = manual({
      subject: "latency", predicate: "p99", value: "100.000",
      valueType: "number", unit: "ms", normalizedSubject: "latency",
      normalizedPredicate: "p99", normalizedValue: "100.000",
      extractionMethod: "deterministic", extractionVersion: "1.0.0",
    });
    const right = manual({
      subject: "latency", predicate: "p99", value: "100.005",
      valueType: "number", unit: "ms", normalizedSubject: "latency",
      normalizedPredicate: "p99", normalizedValue: "100.005",
      extractionMethod: "deterministic", extractionVersion: "1.0.0",
    });
    const result = cmp.compare(left, right, "L", "R");
    assert.equal(result.compatibility, "compatible");
    assert.ok(result.reasons.some(r => r.includes("tolerance")));
  });

  it("treats numeric difference beyond tolerance as incompatible", () => {
    const left = manual({
      subject: "latency", predicate: "p99", value: "100",
      valueType: "number", unit: "ms", normalizedSubject: "latency",
      normalizedPredicate: "p99", normalizedValue: "100",
      extractionMethod: "deterministic", extractionVersion: "1.0.0",
    });
    const right = manual({
      subject: "latency", predicate: "p99", value: "250",
      valueType: "number", unit: "ms", normalizedSubject: "latency",
      normalizedPredicate: "p99", normalizedValue: "250",
      extractionMethod: "deterministic", extractionVersion: "1.0.0",
    });
    const result = cmp.compare(left, right, "L", "R");
    assert.equal(result.compatibility, "incompatible");
    assert.equal(result.type, "contradiction");
    assert.ok(result.reasons.some(r => r.includes("exceeds tolerance")));
  });

  it("treats non-overlapping scopes as different_scope", () => {
    const left = claim("decision", "decision: use postgres", "src/api");
    const right = claim("decision", "decision: use mysql", "src/reports");
    const result = cmp.compare(left, right, "L", "R");
    assert.equal(result.compatibility, "different_scope");
    assert.ok(result.reasons.some(r => r.includes("scope")));
  });

  it("returns uncertain for ambiguous / under-specified claims", () => {
    // Two claims with same subject+predicate and identical values that don't
    // match any structured type → they should be compatible ("same value"
    // short-circuit). The "uncertain" path is reached when claims have
    // structural overlap but no decisive rule applies — exercise via two
    // version claims at the same scope.
    const left = manual({
      subject: "service", predicate: "version", value: "1.0.0",
      valueType: "version", scope: "src/api", normalizedSubject: "service",
      normalizedPredicate: "version", normalizedValue: "1.0.0",
      extractionMethod: "deterministic", extractionVersion: "1.0.0",
    });
    const right = manual({
      subject: "service", predicate: "version", value: "2.0.0",
      valueType: "version", scope: "src/api", normalizedSubject: "service",
      normalizedPredicate: "version", normalizedValue: "2.0.0",
      extractionMethod: "deterministic", extractionVersion: "1.0.0",
    });
    const result = cmp.compare(left, right, "L", "R");
    assert.equal(result.compatibility, "uncertain");
    assert.ok(result.reasons.some(r => r.includes("progression") || r.includes("version")));
  });

  it("flags artifact digest mismatch as artifact_mismatch", () => {
    const left = manual({
      subject: "artifact", predicate: "digest", value: "sha256:aaaa",
      valueType: "digest", normalizedSubject: "artifact",
      normalizedPredicate: "digest", normalizedValue: "sha256:aaaa",
      extractionMethod: "deterministic", extractionVersion: "1.0.0",
    });
    const right = manual({
      subject: "artifact", predicate: "digest", value: "sha256:bbbb",
      valueType: "digest", normalizedSubject: "artifact",
      normalizedPredicate: "digest", normalizedValue: "sha256:bbbb",
      extractionMethod: "deterministic", extractionVersion: "1.0.0",
    });
    const result = cmp.compare(left, right, "L", "R");
    assert.equal(result.compatibility, "incompatible");
    assert.equal(result.type, "artifact_mismatch");
  });

  it("returns different_scope for mismatched subject or predicate", () => {
    const left = claim("flag", "flag is true");
    const right = claim("flag", "mode = fast");
    const result = cmp.compare(left, right, "L", "R");
    assert.equal(result.compatibility, "different_scope");
  });

  it("rejects numeric comparison when units differ (different_scope)", () => {
    // Use DIFFERENT numeric values so the unit check is reached (the comparator
    // short-circuits to "compatible" on identical normalizedValue before
    // reaching the unit check).
    const left = manual({
      subject: "size", predicate: "limit", value: "100", valueType: "number",
      unit: "MB", normalizedSubject: "size", normalizedPredicate: "limit",
      normalizedValue: "100", extractionMethod: "deterministic", extractionVersion: "1.0.0",
    });
    const right = manual({
      subject: "size", predicate: "limit", value: "50", valueType: "number",
      unit: "GB", normalizedSubject: "size", normalizedPredicate: "limit",
      normalizedValue: "50", extractionMethod: "deterministic", extractionVersion: "1.0.0",
    });
    const result = cmp.compare(left, right, "L", "R");
    assert.equal(result.compatibility, "different_scope");
    assert.ok(result.reasons.some(r => r.includes("unit")));
  });
});
