import { describe, expect, it, vi } from "vitest";
import type { AlixEvent } from "../../src/events/types.js";
import { saveDecisionsToMemory } from "../../src/run/helpers.js";
import type { MemoryStore } from "../../src/utils/memory/store.js";

function event(text: string): AlixEvent {
  return {
    id: "evt-memory-terminal",
    seq: 1,
    version: 1,
    sessionId: "session-memory-terminal",
    timestamp: new Date(0).toISOString(),
    type: "user.message",
    actor: "user",
    payload: { text },
  };
}

describe("memory decision terminal ownership", () => {
  it("keeps the routine no-decisions outcome silent", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const save = vi.fn();

    await saveDecisionsToMemory(
      [event("Is Docker installed?")],
      { save } as unknown as MemoryStore,
    );

    expect(log).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("does not print, prompt, or save while the TUI owns the raw terminal", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const save = vi.fn();

    await saveDecisionsToMemory(
      [event("We decided to use TypeScript for the project")],
      { save } as unknown as MemoryStore,
      { terminalOwned: true },
    );

    expect(log).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
