import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("refactor skill", () => {
  it("should have valid front matter", () => {
    const content = readFileSync(join(process.cwd(), "src/cli/commands/skills/refactor/SKILL.md"), "utf8");
    expect(content).toMatch(/name: refactor/);
    expect(content).toMatch(/trigger: \/refactor/);
    expect(content).toMatch(/is_core: true/);
  });

  it("should contain GitNexus guidance", () => {
    const content = readFileSync(join(process.cwd(), "src/cli/commands/skills/refactor/SKILL.md"), "utf8");
    expect(content).toMatch(/gitnexus/i);
    expect(content).toMatch(/blast radius/i);
  });
});