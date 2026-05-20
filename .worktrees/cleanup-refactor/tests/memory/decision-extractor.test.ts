import test from "node:test";
import assert from "node:assert/strict";
import {
  extractDecisions,
  DECISION_PATTERNS,
  promptDecisionConfirmation,
} from "../../src/utils/memory/decision-extractor.js";

// Test DECISION_PATTERNS structure
test("DECISION_PATTERNS has project type pattern", () => {
  const projectPattern = DECISION_PATTERNS.find((p) => p.type === "project");
  assert.ok(projectPattern);
  assert.deepEqual(projectPattern.keywords, ["chose", "decided", "picked", "selected", "went with", "opted for"]);
});

test("DECISION_PATTERNS has user type pattern", () => {
  const userPattern = DECISION_PATTERNS.find((p) => p.type === "user");
  assert.ok(userPattern);
  assert.deepEqual(userPattern.keywords, ["prefers", "likes", "wants", "favorite", "loves", "rather"]);
});

test("DECISION_PATTERNS has feedback type pattern", () => {
  const feedbackPattern = DECISION_PATTERNS.find((p) => p.type === "feedback");
  assert.ok(feedbackPattern);
  assert.deepEqual(feedbackPattern.keywords, ["fixed", "solved", "resolved", "worked around", "handled by"]);
});

// Test extractDecisions function
test("extractDecisions returns empty array for empty events", () => {
  const decisions = extractDecisions([]);
  assert.deepEqual(decisions, []);
});

test("extractDecisions skips non-text events", () => {
  // Pass as any since extractDecisions only uses sessionId, type, and payload fields
  const events = [
    { sessionId: "test", timestamp: "2024-01-01T00:00:00Z", actor: "system", type: "session.started", payload: {} },
  ] as any[];
  const decisions = extractDecisions(events);
  assert.deepEqual(decisions, []);
});

test("extractDecisions extracts project decisions from user messages", () => {
  const events = [
    { sessionId: "test", timestamp: "2024-01-01T00:00:00Z", actor: "user", type: "user.message", payload: { text: "I decided to use TypeScript for the project" } },
  ] as any[];
  const decisions = extractDecisions(events);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].type, "project");
  assert.ok(decisions[0].content.includes("decided"));
});

test("extractDecisions extracts user preference decisions", () => {
  const events = [
    { sessionId: "test", timestamp: "2024-01-01T00:00:00Z", actor: "user", type: "user.message", payload: { text: "I prefer using yarn over npm" } },
  ] as any[];
  const decisions = extractDecisions(events);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].type, "user");
  assert.ok(decisions[0].content.includes("prefers"));
});

test("extractDecisions extracts feedback decisions", () => {
  const events = [
    { sessionId: "test", timestamp: "2024-01-01T00:00:00Z", actor: "user", type: "user.message", payload: { text: "This was fixed by switching to ES modules" } },
  ] as any[];
  const decisions = extractDecisions(events);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].type, "feedback");
  assert.ok(decisions[0].content.includes("fixed"));
});

test("extractDecisions handles hook events with output field", () => {
  const events = [
    { sessionId: "test", timestamp: "2024-01-01T00:00:00Z", actor: "system", type: "hook.pre_task", payload: { output: "I chose the monorepo approach" } },
  ] as any[];
  const decisions = extractDecisions(events);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].type, "project");
});

test("extractDecisions handles agent message events", () => {
  const events = [
    { sessionId: "test", timestamp: "2024-01-01T00:00:00Z", actor: "agent", type: "agent.message", payload: { text: "I selected the vanilla JS option" } },
  ] as any[];
  const decisions = extractDecisions(events);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].type, "project");
});

test("extractDecisions returns memory entries with required fields", () => {
  const events = [
    { sessionId: "test-session", timestamp: "2024-01-01T00:00:00Z", actor: "user", type: "user.message", payload: { text: "I went with the microservices architecture" } },
  ] as any[];
  const decisions = extractDecisions(events);
  assert.equal(decisions.length, 1);
  const decision = decisions[0];
  assert.ok(decision.name);
  assert.ok(decision.description);
  assert.ok(decision.content);
  assert.ok(decision.createdAt);
  assert.ok(decision.modifiedAt);
  assert.ok(typeof decision.confidence === "number");
  assert.equal(typeof decision.confirmations === "number", true);
  assert.ok(decision.source.includes("session:test-session"));
});

test("extractDecisions uses initial confidence of 0.5", () => {
  const events = [
    { sessionId: "test", timestamp: "2024-01-01T00:00:00Z", actor: "user", type: "user.message", payload: { text: "I picked React for the frontend" } },
  ] as any[];
  const decisions = extractDecisions(events);
  assert.equal(decisions[0].confidence, 0.5);
});

test("extractDecisions generates names with type suffix", () => {
  const events = [
    { sessionId: "test", timestamp: "2024-01-01T00:00:00Z", actor: "user", type: "user.message", payload: { text: "I chose to use TypeScript" } },
  ] as any[];
  const decisions = extractDecisions(events);
  assert.ok(decisions[0].name.includes("..."));
  assert.ok(decisions[0].name.includes("decision"));
});

// Test promptDecisionConfirmation in non-TTY mode (auto-confirms)
test("promptDecisionConfirmation auto-confirms in non-TTY", async () => {
  const decisions = [
    {
      id: "1",
      name: "test decision",
      description: "test",
      type: "project" as const,
      content: "decided to use TypeScript",
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      confidence: 0.5,
      confirmations: 0,
      source: "test",
    },
  ];
  const confirmed = await promptDecisionConfirmation(decisions);
  assert.equal(confirmed.length, 1);
  // In non-TTY, confidence is bumped to 0.6
  assert.equal(confirmed[0].confidence, 0.6);
});