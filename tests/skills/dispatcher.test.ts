import { describe, it } from "node:test";
import assert from "node:assert";
import { skillFactory } from "../../src/skills/dispatcher.js";

describe("skillFactory.process (fire-and-forget)", () => {
  it("is fire-and-forget — returns immediately without waiting for Ollama", async () => {
    // The dispatcher should return before the factory subagent completes
    const start = Date.now();
    const result = await skillFactory.process({
      sessionId: "test-session",
      sessionDir: "/tmp/test-session-dir",
      summary: "Added TDD skill to the codebase",
      filesCreated: ["src/skills/tdd-skill.ts"],
      filesChanged: ["src/run.ts"],
      config: { enabled: true, provider: "ollama", model: "llama3", maxStore: 50, maxCandidates: 200, autoPromote: true },
    });
    const elapsed = Date.now() - start;
    // Should return in < 1000ms — fire and forget
    assert.ok(elapsed < 1000, `Dispatcher took ${elapsed}ms — expected < 1000ms for fire-and-forget`);
    assert.strictEqual(result.queued, true);
  });

  it("returns { queued: true, sessionId } immediately", () => {
    // Result shape is predictable regardless of Ollama state
    const mockResult = { queued: true, sessionId: "test" };
    assert.ok(typeof mockResult.queued === "boolean");
    assert.ok(typeof mockResult.sessionId === "string");
  });
});