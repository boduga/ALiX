import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("optimize skill", () => {
  it("should have valid front matter", () => {
    const content = readFileSync(join(process.cwd(), "src/cli/commands/skills/optimize/SKILL.md"), "utf8");
    expect(content).toMatch(/name: optimize/);
    expect(content).toMatch(/trigger: \/optimize/);
    expect(content).toMatch(/is_core: true/);
  });

  it("should contain optimization guidance", () => {
    const content = readFileSync(join(process.cwd(), "src/cli/commands/skills/optimize/SKILL.md"), "utf8");
    expect(content).toMatch(/profile|bottleneck/i);
    expect(content).toMatch(/cache/i);
  });
});