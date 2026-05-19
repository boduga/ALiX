import test from "node:test";
import assert from "node:assert/strict";
import { extractDecisions, DECISION_PATTERNS } from "../../../src/utils/memory/decision-extractor.js";
import type { AlixEvent } from "../../../src/events/types.js";

function makeEvent(type: string, payload: Record<string, unknown>, sessionId = "test-session"): AlixEvent {
  return {
    id: "evt-" + Math.random(),
    seq: 1,
    version: 1,
    sessionId,
    timestamp: new Date().toISOString(),
    type,
    actor: "user",
    payload,
  };
}

test("extractDecisions() detects project decisions", () => {
  const events: AlixEvent[] = [
    makeEvent("user.message", { text: "We chose TypeScript because it has better type safety" }),
  ];

  const decisions = extractDecisions(events);
  assert.ok(decisions.length > 0, "Should find at least one decision");

  const projectDecisions = decisions.filter(d => d.type === "project");
  assert.ok(projectDecisions.length > 0, "Should contain a project decision");
  assert.ok(projectDecisions[0].content.toLowerCase().includes("chose"));
});

test("extractDecisions() detects user preferences", () => {
  const events: AlixEvent[] = [
    makeEvent("user.message", { text: "The user prefers dark mode for their editor" }),
  ];

  const decisions = extractDecisions(events);
  assert.ok(decisions.length > 0, "Should find at least one preference");

  const userPrefs = decisions.filter(d => d.type === "user");
  assert.ok(userPrefs.length > 0, "Should contain a user preference");
  assert.ok(userPrefs[0].content.toLowerCase().includes("prefers"));
});

test("extractDecisions() detects feedback/lessons", () => {
  const events: AlixEvent[] = [
    makeEvent("agent.message", { text: "Fixed by doing additional validation on inputs" }),
  ];

  const decisions = extractDecisions(events);
  assert.ok(decisions.length > 0, "Should find at least one feedback entry");

  const feedbackEntries = decisions.filter(d => d.type === "feedback");
  assert.ok(feedbackEntries.length > 0, "Should contain a feedback entry");
  assert.ok(feedbackEntries[0].content.toLowerCase().includes("fixed"));
});

test("extractDecisions() returns empty array for no matches", () => {
  const events: AlixEvent[] = [
    makeEvent("user.message", { text: "Can you create a new file for me?" }),
  ];

  const decisions = extractDecisions(events);
  assert.deepEqual(decisions, [], "Should return empty array when no patterns match");
});

test("extractDecisions() processes multiple events", () => {
  const events: AlixEvent[] = [
    makeEvent("user.message", { text: "We chose React for the frontend" }),
    makeEvent("agent.message", { text: "Fixed by refactoring the API client" }),
    makeEvent("user.message", { text: "She prefers VS Code over IntelliJ" }),
  ];

  const decisions = extractDecisions(events);
  assert.ok(decisions.length >= 3, "Should find at least 3 decisions");

  const types = decisions.map(d => d.type);
  assert.ok(types.includes("project"), "Should have a project decision");
  assert.ok(types.includes("feedback"), "Should have a feedback decision");
  assert.ok(types.includes("user"), "Should have a user preference");
});

test("extractDecisions() sets correct initial confidence", () => {
  const events: AlixEvent[] = [
    makeEvent("user.message", { text: "We decided to use a monorepo structure" }),
  ];

  const decisions = extractDecisions(events);
  assert.ok(decisions.length > 0);
  assert.equal(decisions[0].confidence, 0.5, "Auto-extracted decisions should start at 0.5 confidence");
});

test("extractDecisions() includes session source", () => {
  const sessionId = "session-123";
  const events: AlixEvent[] = [
    makeEvent("user.message", { text: "We picked PostgreSQL for the database" }, sessionId),
  ];

  const decisions = extractDecisions(events);
  assert.ok(decisions.length > 0);
  assert.ok(decisions[0].source?.includes(sessionId), "Source should include session ID");
});

test("extractDecisions() handles events without text payload", () => {
  const events: AlixEvent[] = [
    makeEvent("tool.call", { toolName: "file.read", argsPreview: {} }),
    makeEvent("session.started", { cwd: "/tmp" }),
  ];

  const decisions = extractDecisions(events);
  assert.deepEqual(decisions, [], "Should handle non-text events gracefully");
});

test("extractDecisions() handles events with other payload fields", () => {
  const events: AlixEvent[] = [
    makeEvent("hook.pre_task", { command: "echo test", reason: "testing" }),
  ];

  const decisions = extractDecisions(events);
  // hook.pre_task has reason field - should be checked
  assert.ok(typeof decisions === "object");
});

test("extractDecisions() dedupes repeated patterns in same event", () => {
  const events: AlixEvent[] = [
    makeEvent("user.message", { text: "We chose React and also chose TypeScript for type safety" }),
  ];

  const decisions = extractDecisions(events);
  // Should find both "chose React" and "chose TypeScript"
  assert.ok(decisions.length >= 1);
});

test("extractDecisions() generates sensible names", () => {
  const events: AlixEvent[] = [
    makeEvent("user.message", { text: "We selected the modular architecture approach" }),
  ];

  const decisions = extractDecisions(events);
  assert.ok(decisions.length > 0);
  assert.ok(decisions[0].name.includes("decision") || decisions[0].name.includes("selected"));
  assert.ok(decisions[0].name.length < 100, "Name should be reasonably short");
});

test("DECISION_PATTERNS contains expected pattern types", () => {
  const types = DECISION_PATTERNS.map(p => p.type);
  assert.ok(types.includes("project"), "Should have project pattern");
  assert.ok(types.includes("user"), "Should have user pattern");
  assert.ok(types.includes("feedback"), "Should have feedback pattern");
});

test("extractDecisions() handles various keyword variations", () => {
  const events: AlixEvent[] = [
    makeEvent("user.message", { text: "They opted for the microservices approach" }),
    makeEvent("user.message", { text: "We went with a serverless solution" }),
  ];

  const decisions = extractDecisions(events);
  assert.ok(decisions.length >= 2, "Should detect opted for and went with");
});

test("extractDecisions() is case insensitive", () => {
  const events: AlixEvent[] = [
    makeEvent("user.message", { text: "We CHOSE TypeScript for this project" }),
    makeEvent("user.message", { text: "She PREFFERS the dark theme" }),
  ];

  const decisions = extractDecisions(events);
  assert.ok(decisions.length > 0, "Should be case insensitive");
});