/**
 * subagent-status-semantics.vitest.ts — pins the ownership contract and the
 * executor asymmetry that makes it a false-success risk.
 *
 * `computeSubagentStatus` answers an OWNERSHIP question ("did the worker stay
 * inside and deliver to its scope?"), not a task question ("did it achieve the
 * goal?"). That is intentional. The risk is downstream: the subagent coordination
 * executor accepts `status === "success"` directly, while the in-process executor
 * runs `reviewDefaultWorkerResult` first.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeSubagentStatus, isObjectiveComplete } from "../../src/agents/subagent-cli.js";

function makeCwd() {
  return mkdtempSync(join(tmpdir(), "status-sem-"));
}

describe("computeSubagentStatus is an OWNERSHIP verdict", () => {
  it("ownedPaths ['.'] reports success for a write unrelated to the objective", () => {
    const cwd = makeCwd();
    // This is the documented default: any in-cwd change covers ownership.
    const progress = { successfulPaths: new Set(["some-other-file.txt"]), fatalWriteFailures: [] as string[] };
    expect(computeSubagentStatus(progress, ["."], cwd)).toBe("success");
    rmSync(cwd, { recursive: true, force: true });
  });

  it("an explicit objective path reports partial when only a different file was written", () => {
    const cwd = makeCwd();
    const progress = { successfulPaths: new Set(["some-other-file.txt"]), fatalWriteFailures: [] as string[] };
    expect(computeSubagentStatus(progress, ["report.md"], cwd)).toBe("partial");
    rmSync(cwd, { recursive: true, force: true });
  });

  it("zero write attempts against an owned objective is failed (locked ruling)", () => {
    const cwd = makeCwd();
    const progress = { successfulPaths: new Set<string>(), fatalWriteFailures: [] as string[] };
    expect(computeSubagentStatus(progress, ["report.md"], cwd)).toBe("failed");
    rmSync(cwd, { recursive: true, force: true });
  });

  it("no owned objective makes zero activity genuinely success", () => {
    const cwd = makeCwd();
    const progress = { successfulPaths: new Set<string>(), fatalWriteFailures: [] as string[] };
    expect(computeSubagentStatus(progress, [], cwd)).toBe("success");
    rmSync(cwd, { recursive: true, force: true });
  });

  it("isObjectiveComplete is path-coverage, not goal achievement", () => {
    const cwd = makeCwd();
    expect(isObjectiveComplete(new Set(["a.txt"]), ["a.txt"], cwd)).toBe(true);
    expect(isObjectiveComplete(new Set(["b.txt"]), ["a.txt"], cwd)).toBe(false);
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("review coverage (corrected scope)", () => {
  it("coordination workers ARE reviewed: reviewCoordinationResult gated on coordinationRunId", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const cli = readFileSync(join(root, "src/agents/subagent-cli.ts"), "utf-8");
    // The review exists and returns early without a coordination run id.
    expect(cli).toContain("reviewCoordinationResult(");
    expect(cli).toMatch(/if \(!coordinationRunId\) return result;/);
  });

  it("the in-process coordination executor also reviews", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const src = readFileSync(join(root, "src/coordination/kernel/worker-executor.ts"), "utf-8");
    expect(src).toContain("reviewDefaultWorkerResult");
  });

  it("plain delegate has NO coordinationRunId, so it skips the review", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const driver = readFileSync(
      join(root, "src/operations/evals/drivers/delegate-driver.ts"),
      "utf-8",
    );
    // This is the actual reachable gap, and it is deliberately narrow.
    expect(driver).not.toContain("coordinationRunId");
  });
});
