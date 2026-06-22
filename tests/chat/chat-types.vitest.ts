import { describe, it, expect } from "vitest";
import type { ChatSession, ChatMessage, ChatRoute, ChatRouteDecision } from "../../src/chat/chat-types.js";

describe("ChatSession types", () => {
  it("accepts a valid ChatSession shape", () => {
    const session: ChatSession = {
      id: "chat:2026-06-22-abc123",
      subject: "Test session",
      outcome: "captured",
      confidence: 1,
      reasons: ["Test session created"],
      generatedAt: "2026-06-22T00:00:00.000Z",
      title: "Test session",
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z",
    };
    expect(session.id).toBe("chat:2026-06-22-abc123");
  });

  it("accepts messages with user role, route metadata, and artifact references", () => {
    const msg: ChatMessage = {
      id: "msg_01",
      role: "user",
      content: "show pending proposals",
      createdAt: "2026-06-22T00:00:00.000Z",
      route: "inspect_state",
      routeConfidence: 0.95,
      sourceArtifacts: [{ type: "proposal", id: "prop_123" }],
      generatedArtifacts: [{ type: "proposal", id: "prop_456" }],
    };
    expect(msg.role).toBe("user");
    expect(msg.route).toBe("inspect_state");
    expect(msg.routeConfidence).toBe(0.95);
    expect(msg.generatedArtifacts).toHaveLength(1);
  });

  it("includes invoke_agent in ChatRoute type", () => {
    const route: ChatRoute = "invoke_agent";
    expect(route).toBe("invoke_agent");
  });

  it("accepts ChatRouteDecision with unknown route", () => {
    const decision: ChatRouteDecision = {
      route: "unknown",
      confidence: 0,
      reasons: ["Could not classify"],
    };
    expect(decision.confidence).toBe(0);
  });
});
