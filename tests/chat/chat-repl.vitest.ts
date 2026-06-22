import { describe, it, expect } from "vitest";
import { ChatSessionStore } from "../../src/chat/chat-session-store.js";
import { startRepl } from "../../src/chat/chat-repl.js";

describe("Chat REPL", () => {
  it("exports startRepl function", () => {
    expect(typeof startRepl).toBe("function");
  });

  it("startRepl returns a teardown function", () => {
    const store = new ChatSessionStore("/tmp/nonexistent-test-dir");
    const teardown = startRepl(store, { dryRun: true });
    expect(typeof teardown).toBe("function");
  });
});
