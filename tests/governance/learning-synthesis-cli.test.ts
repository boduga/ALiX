/**
 * P27.4 — Learning Synthesis CLI Tests.
 *
 * Tests the sync CLI handler for `alix governance learning-synthesis {build|report}`.
 * No write path — verifies no store directories are created.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleGovernanceLearningSynthesisCommand } from "../../src/cli/commands/governance-learning-synthesis.js";

let tmpDir: string;
let bundlePath: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "p27-cli-"));
  bundlePath = join(tmpDir, "test-bundle.json");

  // Minimal P24 bundle
  writeFileSync(bundlePath, JSON.stringify({
    signals: [
      { signalId: "s-1", kind: "calibration_skew", severity: "medium", direction: "too_loose", windowStart: "2026-06-01T00:00:00.000Z", windowEnd: "2026-07-01T00:00:00.000Z", confidence: 0.7, sampleSize: { p22CalibrationCount: 20, p23ReplayCount: 15, pairedLifecycleCount: 10 }, rates: { overconfidentRate: 0.65 }, implicatedPolicyAreas: [], evidenceRefs: [], rationale: [] },
    ],
  }));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleGovernanceLearningSynthesisCommand", () => {

  it("returns usage when no subcommand given", () => {
    const result = handleGovernanceLearningSynthesisCommand([], { cwd: tmpDir });
    assert.ok(result.includes("usage"));
  });

  it("build reads from bundle without error", () => {
    const result = handleGovernanceLearningSynthesisCommand(
      ["build", "--p24-bundle", bundlePath],
      { cwd: tmpDir },
    );
    assert.ok(result.includes("P27-BUILD"));
  });

  it("build --json returns parseable JSON", () => {
    const result = handleGovernanceLearningSynthesisCommand(
      ["build", "--json", "--p24-bundle", bundlePath],
      { cwd: tmpDir },
    );
    const parsed = JSON.parse(result);
    assert.ok(parsed.traces !== undefined);
  });

  it("report renders text output", () => {
    const result = handleGovernanceLearningSynthesisCommand(
      ["report", "--p24-bundle", bundlePath],
      { cwd: tmpDir },
    );
    assert.ok(result.includes("P27-SYNTHESIS"));
  });

  it("report --json returns parseable JSON", () => {
    const result = handleGovernanceLearningSynthesisCommand(
      ["report", "--json", "--p24-bundle", bundlePath],
      { cwd: tmpDir },
    );
    const parsed = JSON.parse(result);
    assert.ok(parsed.totalOutcomes !== undefined);
  });

  it("no write operations occur (store directory not created)", () => {
    // P27 has no write path — verify .alix/governance/learning-synthesis is NOT created
    const storePath = join(tmpDir, ".alix", "governance", "learning-synthesis");
    assert.equal(existsSync(storePath), false);
  });
});
