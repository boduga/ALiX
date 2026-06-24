/**
 * P10.0 — Executive Dashboard CLI integration tests.
 *
 * @module
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let cwd: string;
let originalCwd: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "exec-dash-cli-"));
  mkdirSync(join(cwd, ".alix"), { recursive: true });
  originalCwd = process.cwd();
  process.chdir(cwd);
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(cwd);
});

afterEach(() => {
  process.chdir(originalCwd);
  cwdSpy.mockRestore();
  rmSync(cwd, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("runDashboard", () => {
  it("renders 3 panel headers in text mode", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { runDashboard } = await import("../../../src/cli/commands/executive-dashboard-handler.js");
    await runDashboard([]);
    const out = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    log.mockRestore();
    expect(out).toContain("EXECUTIVE DASHBOARD");
    expect(out).toContain("EXECUTIVE HEALTH SUMMARY");
    expect(out).toContain("EXECUTIVE PRIORITIES");
  });

  it("emits valid JSON in --json mode", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { runDashboard } = await import("../../../src/cli/commands/executive-dashboard-handler.js");
    await runDashboard(["--json"]);
    const out = log.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    log.mockRestore();
    const parsed = JSON.parse(out);
    expect(parsed.health.schemaVersion).toBe("p10.0.0");
    expect(parsed.health.rankedSubsystems).toBeDefined();
    expect(parsed.health.rankedSubsystems.length).toBe(8);
    expect(parsed.priority.schemaVersion).toBe("p10.1.0");
    expect(parsed.priority.priorities.length).toBe(8);
  });

  it("respects --window flag", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { runDashboard } = await import("../../../src/cli/commands/executive-dashboard-handler.js");
    await runDashboard(["--window", "7", "--json"]);
    const out = log.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    log.mockRestore();
    const parsed = JSON.parse(out);
    expect(parsed.health.windowDays).toBe(7);
  });
});
