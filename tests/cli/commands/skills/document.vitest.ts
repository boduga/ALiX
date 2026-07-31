import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("document skill", () => {
  it("should have valid front matter", () => {
    const content = readFileSync(join(process.cwd(), "src/cli/commands/skills/document/SKILL.md"), "utf8");
    expect(content).toMatch(/name: document/);
    expect(content).toMatch(/trigger: \/document/);
    expect(content).toMatch(/is_core: true/);
  });

  it("should contain documentation guidance", () => {
    const content = readFileSync(join(process.cwd(), "src/cli/commands/skills/document/SKILL.md"), "utf8");
    expect(content).toMatch(/docstring|documentation/i);
    expect(content).toMatch(/README|api.*docs/i);
  });
});