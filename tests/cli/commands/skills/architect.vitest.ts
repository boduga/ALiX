import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("architect skill", () => {
  it("should have valid front matter", () => {
    const content = readFileSync(join(process.cwd(), "src/cli/commands/skills/architect/SKILL.md"), "utf8");
    expect(content).toMatch(/name: architect/);
    expect(content).toMatch(/trigger: \/architect/);
    expect(content).toMatch(/is_core: true/);
  });

  it("should contain architecture guidance", () => {
    const content = readFileSync(join(process.cwd(), "src/cli/commands/skills/architect/SKILL.md"), "utf8");
    expect(content).toMatch(/deepen|depth/i);
    expect(content).toMatch(/ADR/i);
  });
});