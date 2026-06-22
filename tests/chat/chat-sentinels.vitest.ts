import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const chatDir = join("src", "chat");
const chatFiles = readdirSync(chatDir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => join(chatDir, f));

describe("Chat governance sentinels", () => {
  it("chat must not import applier modules", () => {
    for (const f of chatFiles) {
      const content = readFileSync(f, "utf-8");
      expect(content).not.toMatch(/applier/i);
    }
  });

  it("chat must not call approve/apply/reject directly", () => {
    for (const f of chatFiles) {
      const content = readFileSync(f, "utf-8");
      expect(content).not.toMatch(/\bapprove\b/);
      expect(content).not.toMatch(/\bapply\b/);
      expect(content).not.toMatch(/\breject\b/i);
    }
  });

  it("chat must not reference OutcomeStore outside inspector", () => {
    for (const f of chatFiles) {
      if (f.includes("chat-inspector")) continue;
      const content = readFileSync(f, "utf-8");
      expect(content).not.toMatch(/OutcomeStore/);
    }
  });

  it("chat must not reference ProposalStore outside skill-bridge or inspector", () => {
    for (const f of chatFiles) {
      if (f.includes("chat-skill-bridge") || f.includes("chat-inspector")) continue;
      const content = readFileSync(f, "utf-8");
      expect(content).not.toMatch(/ProposalStore/);
    }
  });
});
