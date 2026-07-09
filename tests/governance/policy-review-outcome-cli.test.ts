/**
 * P26.4 — Policy Review Outcome CLI Tests.
 *
 * NOTE: record validates P25 candidate existence before recording.
 * Tests create a P25 candidate fixture before record tests.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleGovernancePolicyReviewOutcomeCommand } from "../../src/cli/commands/governance-policy-review-outcome.js";

let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "p26-cli-"));

  // Create a P25 candidate fixture so record tests have a valid candidate
  const candidatesDir = join(tmpDir, ".alix", "governance", "policy-review-candidates");
  mkdirSync(candidatesDir, { recursive: true });
  writeFileSync(
    join(candidatesDir, "p25-candidate-1.json"),
    JSON.stringify({
      candidateId: "p25-candidate-1",
      title: "Test policy review candidate",
      status: "dismissed",
      summary: "A test candidate for CLI testing",
      source: {
        phase: "P24",
        signalId: "sig-test-1",
        signalKind: "drift",
        signalSeverity: "medium",
        signalDirection: "up",
        windowStart: "2026-01-01T00:00:00.000Z",
        windowEnd: "2026-07-01T00:00:00.000Z",
      },
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      evidenceRefs: [],
      review: { notes: [], decisionBasis: [] },
      boundaries: {
        readOnlyEvidence: true,
        noPolicyMutation: true,
        noThresholdChange: true,
        noAutoAdoption: true,
        noRanking: true,
        requiresHumanReview: true,
      },
    }, null, 2),
    "utf-8",
  );
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleGovernancePolicyReviewOutcomeCommand", () => {

  it("returns usage when no subcommand given", async () => {
    const result = await handleGovernancePolicyReviewOutcomeCommand([], { cwd: tmpDir });
    assert.ok(result.includes("usage"));
  });

  it("record persists outcome for valid P25 candidate", async () => {
    const result = await handleGovernancePolicyReviewOutcomeCommand([
      "record", "p25-candidate-1",
      "--outcome", "dismissed_no_change",
      "--recorded-by", "human-1",
      "--rationale", "No evidence of drift.",
    ], { cwd: tmpDir });
    assert.ok(result.includes("Recorded"));
  });

  it("record rejects non-existent P25 candidate", async () => {
    const result = await handleGovernancePolicyReviewOutcomeCommand([
      "record", "nonexistent-candidate",
      "--outcome", "dismissed_no_change",
      "--recorded-by", "human-1",
      "--rationale", "No evidence.",
    ], { cwd: tmpDir });
    assert.ok(result.includes("ERROR"));
    assert.ok(result.includes("not found"));
  });

  it("record rejects empty rationale", async () => {
    const result = await handleGovernancePolicyReviewOutcomeCommand([
      "record", "p25-candidate-1",
      "--outcome", "dismissed_no_change",
      "--recorded-by", "human-1",
      "--rationale", "",
    ], { cwd: tmpDir });
    assert.ok(result.includes("ERROR"));
  });

  it("list returns outcomes", async () => {
    // Record one outcome first so list has data
    await handleGovernancePolicyReviewOutcomeCommand([
      "record", "p25-candidate-1",
      "--outcome", "dismissed_no_change",
      "--recorded-by", "human-1",
      "--rationale", "No evidence of drift.",
    ], { cwd: tmpDir });

    const result = await handleGovernancePolicyReviewOutcomeCommand([
      "list",
    ], { cwd: tmpDir });
    assert.ok(result.includes("P26-LIST"));
  });

  it("report --json returns parseable JSON", async () => {
    const result = await handleGovernancePolicyReviewOutcomeCommand([
      "report", "--json",
    ], { cwd: tmpDir });
    const parsed = JSON.parse(result);
    assert.ok(parsed.totalOutcomeCount !== undefined);
  });

  it("rejects unknown subcommand", async () => {
    const result = await handleGovernancePolicyReviewOutcomeCommand([
      "unknown",
    ], { cwd: tmpDir });
    assert.ok(result.includes("usage"));
  });
});
