import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("migrate skill", () => {
  it("should have valid front matter", () => {
    const content = readFileSync(join(process.cwd(), "src/cli/commands/skills/migrate/SKILL.md"), "utf8");
    expect(content).toMatch(/name: migrate/);
    expect(content).toMatch(/trigger: \/migrate/);
    expect(content).toMatch(/is_core: true/);
  });

  it("should contain migration patterns", () => {
    const content = readFileSync(join(process.cwd(), "src/cli/commands/skills/migrate/SKILL.md"), "utf8");
    expect(content).toMatch(/expand-contract|dual-write|feature flag/i);
  });
});