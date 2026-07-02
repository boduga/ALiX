import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { GovernanceBaselineProvider } from "../../../src/baseline/providers/governance-provider.js";

describe("GovernanceBaselineProvider", () => {
  const provider = new GovernanceBaselineProvider();
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `gov-provider-${randomUUID()}`);
    mkdirSync(join(tempDir, ".alix", "governance"), { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Metadata
  // -----------------------------------------------------------------------
  it("subsystem returns 'governance'", () => {
    expect(provider.subsystem).toBe("governance");
  });

  it("metadata: version, state, capabilities", () => {
    expect(provider.version).toBe("1.0.0");
    expect(provider.state).toBe("ready");
    expect(provider.capabilities).toContain("capture");
  });

  // -----------------------------------------------------------------------
  // Baseline with fixture files
  // -----------------------------------------------------------------------
  it("baseline reads calibration count", async () => {
    writeFileSync(
      join(tempDir, ".alix", "governance", "calibration.json"),
      JSON.stringify({ calibrations: [{ target: "a", value: 0.8 }, { target: "b", value: 0.6 }] }),
    );
    const artifact = await provider.captureBaseline();
    const data = artifact.data as Record<string, number>;
    expect(data.calibrationCount).toBe(2);
  });

  it("baseline reads lens metrics", async () => {
    writeFileSync(
      join(tempDir, ".alix", "governance", "lens-registry.json"),
      JSON.stringify({ lenses: [{ lens: "a", status: "active" }, { lens: "b", status: "demoted" }] }),
    );
    const artifact = await provider.captureBaseline();
    const data = artifact.data as Record<string, number>;
    expect(data.totalLenses).toBe(2);
    expect(data.activeLenses).toBe(1);
    expect(data.demotedLenses).toBe(1);
  });

  it("baseline reads coverage metrics", async () => {
    writeFileSync(
      join(tempDir, ".alix", "governance", "policy-coverage.json"),
      JSON.stringify({ currentCoverage: 60, targetCoverage: 80 }),
    );
    const artifact = await provider.captureBaseline();
    const data = artifact.data as Record<string, number>;
    expect(data.currentCoverage).toBe(60);
    expect(data.coverageGap).toBe(20);
  });

  // -----------------------------------------------------------------------
  // Graceful degradation
  // -----------------------------------------------------------------------
  it("missing directory returns 0 metrics", async () => {
    // Remove the governance dir so files don't exist
    rmSync(join(tempDir, ".alix", "governance"), { recursive: true, force: true });
    const artifact = await provider.captureBaseline();
    const data = artifact.data as Record<string, number>;
    expect(data.calibrationCount).toBe(0);
    expect(data.totalLenses).toBe(0);
    expect(data.currentCoverage).toBe(0);
  });

  it("missing individual file returns 0 for that file", async () => {
    // Only write calibration, leave lens-registry and policy-coverage missing
    writeFileSync(
      join(tempDir, ".alix", "governance", "calibration.json"),
      JSON.stringify({ calibrations: [{ target: "a", value: 0.8 }] }),
    );
    const artifact = await provider.captureBaseline();
    const data = artifact.data as Record<string, number>;
    expect(data.calibrationCount).toBe(1);
    expect(data.totalLenses).toBe(0); // missing file
    expect(data.currentCoverage).toBe(0); // missing file
  });

  it("malformed JSON degrades gracefully", async () => {
    // Remove dir and recreate with specific files
    rmSync(join(tempDir, ".alix", "governance"), { recursive: true, force: true });
    mkdirSync(join(tempDir, ".alix", "governance"), { recursive: true });
    writeFileSync(join(tempDir, ".alix", "governance", "calibration.json"), "not-json");
    writeFileSync(
      join(tempDir, ".alix", "governance", "lens-registry.json"),
      JSON.stringify({ lenses: [{ lens: "a", status: "active" }] }),
    );
    const artifact = await provider.captureBaseline();
    const data = artifact.data as Record<string, number>;
    expect(data.calibrationCount).toBe(0); // malformed
    expect(data.totalLenses).toBe(1); // valid
  });
});
