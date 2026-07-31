import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("test-suite skill", () => {
  it("should have valid front matter", () => {
    const content = readFileSync(join(process.cwd(), "src/cli/commands/skills/test-suite/SKILL.md"), "utf8");
    expect(content).toMatch(/name: test-suite/);
    expect(content).toMatch(/trigger: \/test-suite/);
    expect(content).toMatch(/is_core: true/);
  });

  it("should contain coverage guidance", () => {
    const content = readFileSync(join(process.cwd(), "src/cli/commands/skills/test-suite/SKILL.md"), "utf8");
    expect(content).toMatch(/coverage/i);
    expect(content).toMatch(/behavior.*not.*implementation|test.*behavior/i);
  });
});