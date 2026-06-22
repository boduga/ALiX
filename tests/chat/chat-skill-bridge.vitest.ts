import { describe, it, expect } from "vitest";

describe("ChatSkillBridge", () => {
  it("handleRunSkill returns error for unknown skill", async () => {
    const { handleRunSkill } = await import("../../src/chat/chat-skill-bridge.js");
    const result = await handleRunSkill("nonexistent-skill-zzz", "input");
    expect(result).toContain("not found");
  });

  it("handleCreateIntent returns a string", async () => {
    const { handleCreateIntent } = await import("../../src/chat/chat-skill-bridge.js");
    const result = await handleCreateIntent("test intent description", null as any, "sess_test_1");
    expect(typeof result).toBe("string");
  });

  it("handleProposeIntent returns error for missing intent", async () => {
    const { handleProposeIntent } = await import("../../src/chat/chat-skill-bridge.js");
    const result = await handleProposeIntent("nonexistent-intent-id", "sess_test_1");
    expect(result).toContain("not found");
  });
});
