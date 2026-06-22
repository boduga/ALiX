import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const _tmpDirs: string[] = [];

afterEach(() => {
  for (const d of _tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  _tmpDirs.length = 0;
});

describe("ChatSkillBridge", () => {
  it("handleRunSkill returns error for unknown skill", async () => {
    const { handleRunSkill } = await import("../../src/chat/chat-skill-bridge.js");
    const result = await handleRunSkill("nonexistent-skill-zzz", "input");
    expect(result).toContain("not found");
  });

  it("handleCreateIntent creates intent in temp dir", async () => {
    const { handleCreateIntent } = await import("../../src/chat/chat-skill-bridge.js");
    const tmpDir = mkdtempSync(join(tmpdir(), "chat-test-"));
    _tmpDirs.push(tmpDir);
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
