import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SkillsBaselineProvider } from "../../../src/baseline/providers/skills-provider.js";

describe("SkillsBaselineProvider", () => {
  let provider: SkillsBaselineProvider;
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `skills-provider-${randomUUID()}`);
    mkdirSync(join(tempDir, ".alix", "skills", "workflow"), { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    provider = new SkillsBaselineProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("subsystem returns 'skills'", () => {
    expect(provider.subsystem).toBe("skills");
  });

  it("metadata: version, state, capabilities", () => {
    expect(provider.version).toBe("1.0.0");
    expect(provider.state).toBe("ready");
    expect(provider.capabilities).toContain("capture");
  });

  it("baseline reads skill files from temp dir", async () => {
    const skillsDir = join(tempDir, ".alix", "skills", "workflow");
    writeFileSync(join(skillsDir, "a.json"), JSON.stringify({ steps: [{ id: "s1" }, { id: "s2" }] }));
    writeFileSync(join(skillsDir, "b.json"), JSON.stringify({ steps: [{ id: "s3" }] }));
    const artifact = await provider.captureBaseline();
    const data = artifact.data as Record<string, number>;
    expect(data.skillCount).toBe(2);
    expect(data.totalSteps).toBe(3);
    expect(data.avgStepsPerSkill).toBe(2); // 3/2 = 1.5 rounds to 2
  });

  it("missing directory returns 0 metrics", async () => {
    rmSync(join(tempDir, ".alix"), { recursive: true, force: true });
    const artifact = await provider.captureBaseline();
    const data = artifact.data as Record<string, number>;
    expect(data.skillCount).toBe(0);
    expect(data.invalidSkills).toBe(0);
  });

  it("baseline cached, current re-reads", async () => {
    const skillsDir = join(tempDir, ".alix", "skills", "workflow");
    writeFileSync(join(skillsDir, "a.json"), JSON.stringify({ steps: [{ id: "s1" }] }));
    const baseline = await provider.captureBaseline();
    expect((baseline.data as Record<string, number>).skillCount).toBe(1);

    writeFileSync(join(skillsDir, "b.json"), JSON.stringify({ steps: [{ id: "s2" }] }));
    const current = await provider.captureCurrent();
    expect((current.data as Record<string, number>).skillCount).toBe(2);

    const baselineAgain = await provider.captureBaseline();
    expect((baselineAgain.data as Record<string, number>).skillCount).toBe(1);
  });

  it("malformed skill file degrades gracefully", async () => {
    const skillsDir = join(tempDir, ".alix", "skills", "workflow");
    writeFileSync(join(skillsDir, "good.json"), JSON.stringify({ steps: [{ id: "s1" }] }));
    writeFileSync(join(skillsDir, "bad.json"), "not-json");
    const artifact = await provider.captureBaseline();
    const data = artifact.data as Record<string, number>;
    expect(data.skillCount).toBe(1);  // only good.json
    expect(data.invalidSkills).toBe(1); // bad.json
  });
});
