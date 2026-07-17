// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Tests for REPL resume/sessions command handlers.
 *
 * Coverage:
 *  - `/resume <id>` calls `session.resume(id)` after a positive existence check.
 *  - `/resume` with no id prints usage hint.
 *  - `/resume <id>` with multiple ids prints usage hint.
 *  - Unknown id → "not found" message, session.resume not called.
 *  - `/sessions` lists available sessions when store is wired.
 *  - `/sessions` without a store prints a hint instead of throwing.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  handleResumeCommand,
  handleSessionsCommand,
} from "../../../src/cli/renderers/repl.js";
import {
  JsonlSessionStore,
} from "../../../src/agent/session-store-jsonl.js";
import type {
  SessionSnapshot,
  SessionStore,
} from "../../../src/agent/session-store.js";
import type { AgentSession } from "../../../src/agent/session.js";

function freshTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "repl-resume-test-"));
}

function makeSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: "11111111-2222-3333-4444-555555555555",
    task: "Test task",
    sessionMode: "auto",
    messages: [{ role: "user", content: "hello" }],
    toolHistory: [],
    turnCount: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completed: false,
    ...overrides,
  };
}

function makeSessionStub(): AgentSession & {
  resume: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
} {
  return {
    resume: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    processTurn: vi.fn(),
    getSessionId: vi.fn().mockReturnValue("current"),
    getState: vi.fn().mockReturnValue({
      sessionId: "current",
      messages: [],
      toolHistory: [],
      turnCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
  };
}

describe("REPL /resume command", () => {
  let store: JsonlSessionStore;
  let session: ReturnType<typeof makeSessionStub>;

  beforeEach(() => {
    store = new JsonlSessionStore(freshTmpDir());
    session = makeSessionStub();
  });

  it("/resume <id> calls session.resume with the provided id", async () => {
    await store.save(makeSnapshot({ sessionId: "abc-123" }));
    await handleResumeCommand("/resume abc-123", session, store);
    expect(session.resume).toHaveBeenCalledWith("abc-123");
  });

  it("/resume with no id prints usage hint and does not call resume()", async () => {
    await handleResumeCommand("/resume", session, store);
    expect(session.resume).not.toHaveBeenCalled();
  });

  it("/resume with extra arguments prints usage hint", async () => {
    await handleResumeCommand("/resume one two", session, store);
    expect(session.resume).not.toHaveBeenCalled();
  });

  it("unknown session id prints not-found and does not call resume()", async () => {
    await handleResumeCommand("/resume missing-id", session, store);
    expect(session.resume).not.toHaveBeenCalled();
  });

  it("/resume still works without a wired store (delegates to AgentSession.resume)", async () => {
    // When the store is omitted, handleResumeCommand skips the existence
    // check and forwards directly to session.resume — this preserves the
    // legacy in-memory behavior.
    await handleResumeCommand("/resume legacy-id", session, undefined);
    expect(session.resume).toHaveBeenCalledWith("legacy-id");
  });
});

describe("REPL /sessions command", () => {
  let store: JsonlSessionStore;

  beforeEach(() => {
    store = new JsonlSessionStore(freshTmpDir());
  });

  it("lists persisted sessions when store is wired", async () => {
    await store.save(
      makeSnapshot({
        sessionId: "11111111-2222-3333-4444-555555555555",
        task: "Build a parser",
        updatedAt: "2026-02-01T00:00:00.000Z",
        turnCount: 4,
      }),
    );
    await store.save(
      makeSnapshot({
        sessionId: "22222222-2222-3333-4444-555555555555",
        task: "Refactor module",
        updatedAt: "2026-02-02T00:00:00.000Z",
        turnCount: 7,
      }),
    );

    const captured: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
      captured.push(String(msg ?? ""));
    });
    try {
      await handleSessionsCommand(store);
    } finally {
      spy.mockRestore();
    }
    const output = captured.join("\n");
    expect(output).toContain("Saved sessions (newest first):");
    // Newest first
    expect(output.indexOf("Refactor module")).toBeLessThan(
      output.indexOf("Build a parser"),
    );
  });

  it("prints a hint when no store is wired", async () => {
    const captured: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
      captured.push(String(msg ?? ""));
    });
    try {
      await handleSessionsCommand(undefined);
    } finally {
      spy.mockRestore();
    }
    expect(captured.join("\n")).toContain("No SessionStore");
  });

  it("reports empty list when no sessions exist", async () => {
    const captured: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
      captured.push(String(msg ?? ""));
    });
    try {
      await handleSessionsCommand(store);
    } finally {
      spy.mockRestore();
    }
    expect(captured.join("\n")).toContain("No saved sessions");
  });
});
