import { describe, it, expect } from "vitest";
import { ChatSessionStore } from "../../src/chat/chat-session-store.js";
import { startRepl } from "../../src/chat/chat-repl.js";

describe("Chat REPL", () => {
  it("exports startRepl function", () => {
    expect(typeof startRepl).toBe("function");
  });

  it("startRepl resolves after dry run", async () => {
    const store = new ChatSessionStore("/tmp/nonexistent-test-dir");
    await startRepl(store, { dryRun: true });
    // If we reach here, the promise resolved without throwing
    expect(true).toBe(true);
  });
});
