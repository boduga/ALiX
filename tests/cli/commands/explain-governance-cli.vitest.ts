/**
 * P9.0b.2 — `alix explain governance <id>` CLI tests.
 *
 * Covers terminal + JSON renderers for governance artifact lookup:
 * 1. Not-found artifact prints "not found" + exits 1.
 * 2. Found governance artifact renders type info in terminal mode.
 * 3. `--json` outputs valid JSON matching the artifact shape.
 *
 * Uses temp-dir + vi.spyOn(process, "cwd") with a seeded GovernanceStore.
 * CLI itself is read-only; no writes from explain governance.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleExplainCommand } from "../../../src/cli/commands/explain.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "explain-gov-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  // Throw on exit so the error path terminates and we can assert exit code.
  exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation(((code?: number | string | null) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);
});

afterEach(() => {
  cwdSpy.mockRestore();
  logSpy.mockRestore();
  errorSpy.mockRestore();
  exitSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

/** Helper: seed a governance artifact record into the temp store. */
function seedGovernanceRecord(
  type: string,
  record: Record<string, unknown>,
): void {
  const govDir = join(tempRoot, ".alix", "governance");
  mkdirSync(govDir, { recursive: true });
  const fileMap: Record<string, string> = {
    health: "health.jsonl",
    assessment: "assessment.jsonl",
    drift: "drift.jsonl",
    lensReviews: "lens-reviews.jsonl",
    integrity: "integrity.jsonl",
  };
  const filename = fileMap[type];
  if (!filename) throw new Error(`Unknown governance type: ${type}`);
  appendFileSync(join(govDir, filename), JSON.stringify(record) + "\n", "utf-8");
}

/** Helper: collect terminal output from logSpy calls. */
function terminalOutput(): string {
  return logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
}

describe("explain governance CLI", () => {
  it("not-found artifact prints 'not found' and exits 1", async () => {
    let capturedExit: Error | undefined;
    try {
      await handleExplainCommand(["governance", "bogus-id"]);
    } catch (err) {
      capturedExit = err as Error;
    }

    expect(errorSpy).toHaveBeenCalled();
    const errorMsg = errorSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(errorMsg).toContain("not found");
    expect(errorMsg).toContain("bogus-id");
    expect(capturedExit?.message).toBe("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("found governance health artifact renders type info in terminal mode", async () => {
    seedGovernanceRecord("health", {
      id: "health-001",
      subject: "Weekly governance health check",
      outcome: "healthy",
      confidence: 0.92,
      reasons: ["All metrics within acceptable range"],
      generatedAt: "2026-06-22T12:00:00.000Z",
      reportType: "governance_health",
      totalReviews: 42,
      totalProposals: 18,
      lensEffectiveness: { red_team: 75, historian: 88, ethicist: 92 },
      policyCoverage: 85,
      sourceMetrics: {
        dashboardIntegrityScore: 96,
        explanationCompleteness: 78,
        evidenceChainUsage: 82,
        incompleteChainLayers: 3,
      },
    });

    await handleExplainCommand(["governance", "health-001"]);

    const output = terminalOutput();
    expect(output).toContain("Governance Artifact health-001");
    expect(output).toContain("Type: health");
    expect(output).toContain("Report Type: governance_health");
    expect(output).toContain("Total Reviews:");
    expect(output).toContain("42");
    expect(output).toContain("Lens Effectiveness:");
    expect(output).toContain("red_team: 75%");
    expect(output).toContain("Dashboard Integrity:");
    expect(output).toContain("96");
    expect(output).toContain("Confidence: 0.92");
  });

  it("--json outputs valid JSON matching the artifact", async () => {
    seedGovernanceRecord("health", {
      id: "health-001",
      subject: "Weekly governance health check",
      outcome: "healthy",
      confidence: 0.92,
      reasons: ["All metrics within acceptable range"],
      generatedAt: "2026-06-22T12:00:00.000Z",
      reportType: "governance_health",
      totalReviews: 42,
      totalProposals: 18,
      lensEffectiveness: {},
      policyCoverage: 85,
      sourceMetrics: {
        dashboardIntegrityScore: null,
        explanationCompleteness: null,
        evidenceChainUsage: null,
        incompleteChainLayers: 0,
      },
    });

    logSpy.mockRestore();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleExplainCommand(["governance", "health-001", "--json"]);

    const output = terminalOutput();
    const parsed = JSON.parse(output);
    expect(parsed.id).toBe("health-001");
    expect(parsed.reportType).toBe("governance_health");
    expect(parsed.totalReviews).toBe(42);
    expect(parsed.totalProposals).toBe(18);
    expect(parsed.confidence).toBe(0.92);
    // Verify DecisionArtifact shape
    expect(parsed).toHaveProperty("generatedAt");
    expect(parsed).toHaveProperty("outcome");
    expect(parsed).toHaveProperty("reasons");
  });
});
