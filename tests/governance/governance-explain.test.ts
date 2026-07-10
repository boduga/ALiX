/**
 * P28.4 — Governance Explain CLI Handler Tests.
 *
 * Tests verify:
 * - CLI trace output produces valid explanation
 * - CLI window output produces valid explanation
 * - JSON mode produces parseable JSON
 * - No write operations occur (no store dirs created)
 *
 * @module
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleGovernanceExplainCommand } from "../../src/cli/commands/governance-explain.js";

let tmpDir: string;
let bundlePath: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "p28-cli-"));

  // Create minimal P24 bundle
  bundlePath = join(tmpDir, "test-bundle.json");
  writeFileSync(bundlePath, JSON.stringify({
    signals: [
      {
        signalId: "s-1",
        kind: "performance_drop",
        severity: "high",
        direction: "negative",
        windowStart: "2026-06-01T00:00:00.000Z",
        windowEnd: "2026-07-01T00:00:00.000Z",
        confidence: 0.78,
        sampleSize: { p22CalibrationCount: 30, p23ReplayCount: 20, pairedLifecycleCount: 8 },
        rates: { overconfidentRate: 0.3 },
        implicatedPolicyAreas: ["thresholds"],
        evidenceRefs: [],
        rationale: [],
      },
    ],
  }));

  // Create P25 candidates directory with a known candidate
  const candidatesDir = join(tmpDir, ".alix", "governance", "policy-review-candidates");
  mkdirSync(candidatesDir, { recursive: true });
  writeFileSync(join(candidatesDir, "candidate-c1.json"), JSON.stringify({
    id: "c1",
    title: "Adjust performance threshold",
    status: "accepted",
    source: {
      signalId: "s-1",
      signalKind: "performance_drop",
      signalSeverity: "high",
      signalDirection: "negative",
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-07-01T00:00:00.000Z",
    },
    createdAt: "2026-06-15T08:00:00.000Z",
    updatedAt: "2026-06-20T10:00:00.000Z",
  }));

  // Create another candidate for peer context
  writeFileSync(join(candidatesDir, "candidate-c2.json"), JSON.stringify({
    id: "c2",
    title: "Review cost threshold",
    status: "dismissed",
    source: {
      signalId: "s-2",
      signalKind: "cost_spike",
      signalSeverity: "medium",
      signalDirection: "positive",
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-07-01T00:00:00.000Z",
    },
    createdAt: "2026-06-10T08:00:00.000Z",
    updatedAt: "2026-06-18T10:00:00.000Z",
  }));

  // Create P26 outcomes directory
  const outcomesDir = join(tmpDir, ".alix", "governance", "policy-review-outcomes");
  mkdirSync(outcomesDir, { recursive: true });
  writeFileSync(join(outcomesDir, "outcome-o1.json"), JSON.stringify({
    outcomeId: "o1",
    candidateId: "c1",
    outcomeType: "approved",
    recordedAt: "2026-06-20T12:00:00.000Z",
    rationale: "Threshold adjustment aligned with performance goals",
  }));
  writeFileSync(join(outcomesDir, "outcome-o2.json"), JSON.stringify({
    outcomeId: "o2",
    candidateId: "c2",
    outcomeType: "dismissed",
    recordedAt: "2026-06-18T14:00:00.000Z",
    rationale: "No cost action needed at this time",
  }));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleGovernanceExplainCommand", () => {
  it("returns usage when no subcommand is given", () => {
    const result = handleGovernanceExplainCommand([], { cwd: tmpDir });
    assert.ok(result.includes("usage"), "should return usage message");
  });

  it("returns error when --p24-bundle is not provided", () => {
    const result = handleGovernanceExplainCommand(["trace", "c1"], { cwd: tmpDir });
    assert.ok(result.includes("ERROR: --p24-bundle"), "should require --p24-bundle");
  });

  it("trace subcommand renders explanation for a known candidate", () => {
    const result = handleGovernanceExplainCommand(
      ["trace", "c1", "--p24-bundle", bundlePath],
      { cwd: tmpDir },
    );

    // Should be successful output
    const trimmed = result.trim();
    assert.ok(trimmed.startsWith("P28-EXPLAIN-START"), "should start with P28-EXPLAIN-START");
    assert.ok(trimmed.endsWith("P28-EXPLAIN-END"), "should end with P28-EXPLAIN-END");
    assert.ok(result.includes("Adjust performance threshold"), "should include candidate title");
    assert.ok(result.includes("P28 explains governance decisions already made."), "should include footer");
  });

  it("trace subcommand with --json produces parseable JSON", () => {
    const result = handleGovernanceExplainCommand(
      ["trace", "c1", "--p24-bundle", bundlePath, "--json"],
      { cwd: tmpDir },
    );

    assert.doesNotThrow(() => {
      JSON.parse(result);
    }, "JSON output must be parseable");

    const parsed = JSON.parse(result);
    assert.strictEqual(parsed.readOnly, true);
    assert.strictEqual(parsed.noPolicyMutation, true);
    assert.strictEqual(parsed.noThresholdChange, true);
    assert.strictEqual(parsed.noAutoAdoption, true);
    assert.strictEqual(parsed.noRanking, true);
    assert.ok(Array.isArray(parsed.sections));
    assert.ok(parsed.sections.length >= 4, "should have at least 4 sections");
  });

  it("trace subcommand returns error for unknown candidate", () => {
    const result = handleGovernanceExplainCommand(
      ["trace", "unknown-candidate", "--p24-bundle", bundlePath],
      { cwd: tmpDir },
    );

    assert.ok(result.startsWith("ERROR"), "should report candidate not found");
    assert.ok(result.includes("not found"), "should indicate candidate was not found");
  });

  it("window subcommand renders aggregated explanation", () => {
    const result = handleGovernanceExplainCommand(
      ["window", "--p24-bundle", bundlePath],
      { cwd: tmpDir },
    );

    const trimmed = result.trim();
    assert.ok(trimmed.startsWith("P28-EXPLAIN-START"), "should start with P28-EXPLAIN-START");
    assert.ok(trimmed.endsWith("P28-EXPLAIN-END"), "should end with P28-EXPLAIN-END");
    assert.ok(result.includes("Governance Window Analysis"), "should window subject");
    assert.ok(result.includes("P28 explains governance decisions already made."), "should include footer");
  });

  it("window subcommand with --json produces parseable JSON", () => {
    const result = handleGovernanceExplainCommand(
      ["window", "--p24-bundle", bundlePath, "--json"],
      { cwd: tmpDir },
    );

    assert.doesNotThrow(() => {
      JSON.parse(result);
    }, "JSON output must be parseable");

    const parsed = JSON.parse(result);
    assert.strictEqual(parsed.readOnly, true);
    assert.strictEqual(parsed.subject, "Governance Window Analysis");
    assert.ok(Array.isArray(parsed.sections));
    assert.strictEqual(parsed.sections.length, 1);
    assert.strictEqual(parsed.sections[0].kind, "learning_synthesis");
  });

  it("no write operations occur (no store directory created)", () => {
    // P28 has no write path — verify .alix/governance/explain is NOT created
    const storePath = join(tmpDir, ".alix", "governance", "explain");
    assert.equal(existsSync(storePath), false, "P28 must not write to disk");
  });
});
