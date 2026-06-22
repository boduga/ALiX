import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChatSessionStore } from "../../src/chat/chat-session-store.js";

describe("ChatSessionStore", () => {
  let dir: string;
  let store: ChatSessionStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chat-test-"));
    store = new ChatSessionStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a session and loads it back with no messages", async () => {
    const session = await store.create();
    expect(session.id).toMatch(/^chat:/);

    const loaded = await store.load(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(session.id);
    expect(loaded!.messages).toHaveLength(0);
  });

  it("appends messages to a session", async () => {
    const session = await store.create();
    const msg = {
      id: "msg_01",
      role: "user" as const,
      content: "hello",
      createdAt: new Date().toISOString(),
    };
    await store.appendMessage(session.id, msg);

    const loaded = await store.load(session.id);
    expect(loaded!.messages).toHaveLength(1);
    expect(loaded!.messages[0].content).toBe("hello");
  });

  it("load returns null for missing session", async () => {
    const result = await store.load("nonexistent");
    expect(result).toBeNull();
  });

  it("lists all sessions (metadata only, no messages)", async () => {
    await store.create("Session A");
    await store.create("Session B");
    const list = await store.list();
    expect(list.length).toBeGreaterThanOrEqual(2);
    // list() returns session metadata, not full message history
    expect((list[0] as any).messages).toBeUndefined();
  });

  it("getMessages returns only messages for a given session", async () => {
    const s1 = await store.create();
    const s2 = await store.create();

    await store.appendMessage(s1.id, { id: "m1", role: "user" as const, content: "in s1", createdAt: "" });
    await store.appendMessage(s2.id, { id: "m2", role: "user" as const, content: "in s2", createdAt: "" });

    const s1msgs = await store.getMessages(s1.id);
    expect(s1msgs).toHaveLength(1);
    expect(s1msgs[0].content).toBe("in s1");
  });

  it("createSessionWithId creates session with explicit id", async () => {
    const session = await store.createSessionWithId("chat:my-session");
    expect(session.id).toBe("chat:my-session");
    const loaded = await store.load("chat:my-session");
    expect(loaded).not.toBeNull();
  });

  it("appendMessage advances updatedAt", async () => {
    const session = await store.create();
    const originalUpdatedAt = session.updatedAt;

    // Small delay so timestamps differ
    await new Promise((r) => setTimeout(r, 10));

    const msg = { id: "m1", role: "user" as const, content: "hi", createdAt: new Date().toISOString() };
    await store.appendMessage(session.id, msg);

    const loaded = await store.load(session.id);
    expect(new Date(loaded!.updatedAt).getTime()).toBeGreaterThan(new Date(originalUpdatedAt).getTime());
  });

  it("appendMessage throws for non-existent session", async () => {
    const msg = { id: "m1", role: "user" as const, content: "hi", createdAt: new Date().toISOString() };
    await expect(store.appendMessage("nonexistent", msg)).rejects.toThrow(/not found/);
  });

  it("survives corrupt lines in sessions.jsonl", async () => {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(join(dir, "sessions.jsonl"), "garbage\n");
    const session = await store.create();
    const loaded = await store.load(session.id);
    expect(loaded).not.toBeNull();
  });
});
