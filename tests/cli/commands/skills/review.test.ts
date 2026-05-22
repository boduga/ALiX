import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("review skill", () => {
  it("should have valid front matter", () => {
    const skillPath = join(process.cwd(), "src/cli/commands/skills/review/SKILL.md");
    const content = readFileSync(skillPath, "utf8");

    expect(content).toMatch(/name: review/);
    expect(content).toMatch(/trigger: \/review/);
    expect(content).toMatch(/is_core: true/);
  });

  it("should contain review checklist sections", () => {
    const skillPath = join(process.cwd(), "src/cli/commands/skills/review/SKILL.md");
    const content = readFileSync(skillPath, "utf8");

    expect(content).toMatch(/Security/);
    expect(content).toMatch(/Performance/);
    expect(content).toMatch(/Error Handling/);
    expect(content).toMatch(/Test Coverage/);
    expect(content).toMatch(/Code Quality/);
  });
});