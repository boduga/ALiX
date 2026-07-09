import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleGovernancePolicyReviewCommand } from "../../src/cli/commands/governance-policy-review.js";

let tmpDir: string;
let bundlePath: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "p25-cli-"));
  bundlePath = join(tmpDir, "input-bundle.json");

  // Create minimal P24 bundle (no signals = empty candidate list)
  const bundle = {
    calibrations: [],
    replayDiffs: [],
    candidateLessons: [],
    readOnly: true,
  };
  writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleGovernancePolicyReviewCommand", () => {
  it("returns usage when no subcommand given", async () => {
    const result = await handleGovernancePolicyReviewCommand([], { cwd: tmpDir });
    assert.ok(result.includes("usage"));
  });

  it("build --input <path> returns candidate preview", async () => {
    const result = await handleGovernancePolicyReviewCommand(
      ["build", "--input", bundlePath],
      { cwd: tmpDir },
    );
    assert.ok(result.includes("P25-BUILD"));
  });

  it("build --input <path> --json returns parseable JSON", async () => {
    const result = await handleGovernancePolicyReviewCommand(
      ["build", "--input", bundlePath, "--json"],
      { cwd: tmpDir },
    );
    const parsed = JSON.parse(result);
    assert.ok(Array.isArray(parsed));
  });

  it("list returns P25-LIST banner", async () => {
    const result = await handleGovernancePolicyReviewCommand(
      ["list"],
      { cwd: tmpDir },
    );
    assert.ok(result.includes("P25-LIST"));
  });

  it("transition rejects invalid transition through store validation", async () => {
    const result = await handleGovernancePolicyReviewCommand(
      ["transition", "nonexistent-id", "--status", "closed", "--rationale", "test"],
      { cwd: tmpDir },
    );
    assert.ok(result.includes("Candidate not found") || result.includes("ERROR"));
  });

  it("report --json returns parseable JSON", async () => {
    const result = await handleGovernancePolicyReviewCommand(
      ["report", "--json"],
      { cwd: tmpDir },
    );
    const parsed = JSON.parse(result);
    assert.ok(parsed.totalCount !== undefined);
  });
});
