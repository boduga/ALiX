import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("simplify skill", () => {
  it("should have valid front matter", () => {
    const content = readFileSync(join(process.cwd(), "src/cli/commands/skills/simplify/SKILL.md"), "utf8");
    expect(content).toMatch(/name: simplify/);
    expect(content).toMatch(/trigger: \/simplify/);
    expect(content).toMatch(/is_core: true/);
  });

  it("should contain cleanup guidance", () => {
    const content = readFileSync(join(process.cwd(), "src/cli/commands/skills/simplify/SKILL.md"), "utf8");
    expect(content).toMatch(/dead code/i);
    expect(content).toMatch(/duplication/i);
  });
});