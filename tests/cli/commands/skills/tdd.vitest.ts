import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("tdd skill", () => {
  it("should have valid front matter", () => {
    const skillPath = join(process.cwd(), "src/cli/commands/skills/tdd/SKILL.md");
    const content = readFileSync(skillPath, "utf8");

    expect(content).toMatch(/^---\n/);
    expect(content).toMatch(/name: tdd/);
    expect(content).toMatch(/description:/);
    expect(content).toMatch(/trigger: \/tdd/);
    expect(content).toMatch(/version: "1\.0\.0"/);
    expect(content).toMatch(/is_core: true/);
  });

  it("should contain red-green-refactor guidance", () => {
    const skillPath = join(process.cwd(), "src/cli/commands/skills/tdd/SKILL.md");
    const content = readFileSync(skillPath, "utf8");

    expect(content).toMatch(/RED/);
    expect(content).toMatch(/GREEN/);
    expect(content).toMatch(/REFACTOR/);
    expect(content).toMatch(/vertical slices/i);
  });
});