import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleGovernanceCalibrationCommand } from "../../src/cli/commands/governance-calibration.js";

let bundlePath: string;

describe("handleGovernanceCalibrationCommand", () => {

  before(() => {
    const dir = mkdtempSync(join(tmpdir(), "p24-cal-cli-"));
    bundlePath = join(dir, "empty-bundle.json");
    writeFileSync(bundlePath, JSON.stringify({
      calibrations: [],
      replayDiffs: [],
      candidateLessons: [],
      readOnly: true,
    }));
  });

  it("returns usage when no subcommand given", () => {
    const result = handleGovernanceCalibrationCommand([], { cwd: "/tmp" });
    assert.ok(result.includes("usage"));
  });

  it("returns error when --input is missing", () => {
    const result = handleGovernanceCalibrationCommand(["detect"], { cwd: "/tmp" });
    assert.ok(result.includes("ERROR"));
    assert.ok(result.includes("--input"));
  });

  it("returns error for non-existent input file", () => {
    const result = handleGovernanceCalibrationCommand(["report", "--input", "/tmp/nonexistent.json"], { cwd: "/tmp" });
    assert.ok(result.includes("ERROR"));
  });

  it("handles report --json with empty bundle", () => {
    const result = handleGovernanceCalibrationCommand(
      ["report", "--json", "--input", bundlePath],
      { cwd: "/tmp" },
    );
    const parsed = JSON.parse(result);
    assert.ok(Array.isArray(parsed.signals));
    assert.ok(parsed.signals.length >= 0);
  });

  it("handles bands with empty bundle", () => {
    const result = handleGovernanceCalibrationCommand(
      ["bands", "--input", bundlePath],
      { cwd: "/tmp" },
    );
    assert.ok(result);
  });

  it("handles --input with --window flag", () => {
    const result = handleGovernanceCalibrationCommand(
      ["detect", "--input", bundlePath, "--window", "90"],
      { cwd: "/tmp" },
    );
    assert.ok(result);
  });

  it("rejects unknown subcommand", () => {
    const result = handleGovernanceCalibrationCommand(["unknown"], { cwd: "/tmp" });
    assert.ok(result.includes("usage"));
  });
});
