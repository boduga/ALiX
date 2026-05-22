import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("debug skill", () => {
  it("should have valid front matter", () => {
    const skillPath = join(process.cwd(), "src/cli/commands/skills/debug/SKILL.md");
    const content = readFileSync(skillPath, "utf8");

    expect(content).toMatch(/name: debug/);
    expect(content).toMatch(/trigger: \/debug/);
    expect(content).toMatch(/is_core: true/);
  });

  it("should contain systematic debugging phases", () => {
    const skillPath = join(process.cwd(), "src/cli/commands/skills/debug/SKILL.md");
    const content = readFileSync(skillPath, "utf8");

    expect(content).toMatch(/Phase 1.*Root Cause/s);
    expect(content).toMatch(/Phase 2.*Pattern/s);
    expect(content).toMatch(/Phase 3.*Hypothesis/s);
    expect(content).toMatch(/Phase 4.*Implementation/s);
    expect(content).toMatch(/Red Flags/);
  });
});