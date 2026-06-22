import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ChatSkillBridge", () => {
  it("handleRunSkill returns error for unknown skill", async () => {
    const { handleRunSkill } = await import("../../src/chat/chat-skill-bridge.js");
    const result = await handleRunSkill("nonexistent-skill-zzz", "input");
    expect(result).toContain("not found");
  });

  it("handleCreateIntent creates intent in temp dir", async () => {
    const { handleCreateIntent } = await import("../../src/chat/chat-skill-bridge.js");
    const tmpDir = mkdtempSync(join(tmpdir(), "chat-test-"));
    const result = await handleCreateIntent("test intent", "sess_test_1", tmpDir);
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^Intent captured:/);
    expect(existsSync(join(tmpDir, "intents.jsonl"))).toBe(true);
  });

  it("handleProposeIntent returns error for missing intent", async () => {
    const { handleProposeIntent } = await import("../../src/chat/chat-skill-bridge.js");
    const result = await handleProposeIntent("nonexistent-intent-id");
    expect(result).toContain("not found");
  });
});
