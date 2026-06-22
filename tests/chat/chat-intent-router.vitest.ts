import { describe, it, expect } from "vitest";
import { routeMessage } from "../../src/chat/chat-intent-router.js";

describe("ChatIntentRouter", () => {
  it("routes 'show pending proposals' to inspect_state", () => {
    const result = routeMessage("show pending proposals");
    expect(result.route).toBe("inspect_state");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("routes 'run skill X' to run_skill", () => {
    const result = routeMessage("run skill architecture-review");
    expect(result.route).toBe("run_skill");
  });

  it("routes 'create intent' to create_intent", () => {
    const result = routeMessage("create an intent from this");
    expect(result.route).toBe("create_intent");
  });

  it("routes 'propose' to propose_intent", () => {
    const result = routeMessage("make this a proposal");
    expect(result.route).toBe("propose_intent");
  });

  it("routes greeting to answer", () => {
    const result = routeMessage("hello, what can you do?");
    expect(result.route).toBe("answer");
  });

  it("routes 'build me an app' to run_task", () => {
    const result = routeMessage("build me an app that tracks expenses");
    expect(result.route).toBe("run_task");
  });

  it("returns unknown for unclear input", () => {
    const result = routeMessage("banana phone");
    expect(result.route).toBe("unknown");
    expect(result.confidence).toBeLessThan(0.5);
  });
});
