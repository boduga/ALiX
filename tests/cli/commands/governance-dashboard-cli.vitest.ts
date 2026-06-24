/**
 * P9.5 — Governance Dashboard CLI integration tests.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let cwd: string;
let originalCwd: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  cwd = mkdtempSync(join(tmpdir(), "gov-dash-cli-"));
  mkdirSync(join(cwd, ".alix", "governance"), { recursive: true });
  mkdirSync(join(cwd, ".alix", "adaptation", "proposals"), { recursive: true });
  mkdirSync(join(cwd, ".alix", "adaptation", "snapshots"), { recursive: true });
  originalCwd = process.cwd();
  process.chdir(cwd);
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(cwd);
});

afterEach(() => {
  process.chdir(originalCwd);
  cwdSpy.mockRestore();
  rmSync(cwd, { recursive: true, force: true });
});

describe("runDashboard", () => {
  it("renders 6 panel headers in text mode", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { runDashboard } = await import("../../../src/cli/commands/governance-dashboard-handler.js");
    await runDashboard([]);
    const out = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    log.mockRestore();
    expect(out).toContain("GOVERNANCE DASHBOARD");
    expect(out).toContain("MUTATION PIPELINE HEALTH");
    expect(out).toContain("OPEN MUTATIONS");
    expect(out).toContain("INVESTIGATION QUEUE");
    expect(out).toContain("MUTATION HISTORY");
    expect(out).toContain("REVERT READINESS");
    expect(out).toContain("DRIFT & INTEGRITY GAPS");
  });

  it("emits valid JSON in --json mode", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { runDashboard } = await import("../../../src/cli/commands/governance-dashboard-handler.js");
    await runDashboard(["--json"]);
    const out = log.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    log.mockRestore();
    const parsed = JSON.parse(out);
    expect(parsed.schemaVersion).toBe("p9.5.0");
    expect(parsed.health).toBeDefined();
    expect(parsed.openMutations).toBeDefined();
    expect(parsed.investigationQueue).toBeDefined();
    expect(parsed.mutationHistory).toBeDefined();
    expect(parsed.revertReadiness).toBeDefined();
    expect(parsed.driftIntegrityGaps).toBeDefined();
  });

  it("respects --window flag", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { runDashboard } = await import("../../../src/cli/commands/governance-dashboard-handler.js");
    await runDashboard(["--json", "--window", "7"]);
    const out = log.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    log.mockRestore();
    const parsed = JSON.parse(out);
    expect(parsed.windowDays).toBe(7);
  });
});
