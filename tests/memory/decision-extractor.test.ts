import test from "node:test";
import assert from "node:assert/strict";
import {
  DECISION_PATTERNS,
  extractDecisions,
  type DecisionPattern,
} from "../../src/utils/memory/decision-extractor.js";
import type { AlixEvent } from "../../src/events/types.js";

function createEvent(
  type: string,
  payload: Record<string, unknown>,
  sessionId = "test-session"
): AlixEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    seq: 1,
    version: 1,
    sessionId,
    timestamp: new Date().toISOString(),
    type,
    actor: "user",
    payload,
  };
}

test("DECISION_PATTERNS contains all expected decision types", () => {
  assert.ok(DECISION_PATTERNS.length >= 3, "Should have at least 3 patterns");

  const types = DECISION_PATTERNS.map((p) => p.type);
  assert.ok(types.includes("project"), "Should have project pattern");
  assert.ok(types.includes("user"), "Should have user pattern");
  assert.ok(types.includes("feedback"), "Should have feedback pattern");
});

test("DECISION_PATTERNS each have required fields", () => {
  for (const pattern of DECISION_PATTERNS) {
    assert.ok(pattern.type, "Pattern should have type");
    assert.ok(Array.isArray(pattern.keywords), "Pattern should have keywords array");
    assert.ok(pattern.keywords.length > 0, "Pattern should have at least one keyword");
    assert.ok(pattern.regex instanceof RegExp, "Pattern should have regex");
  }
});

test("project pattern matches decision keywords", () => {
  const projectPattern = DECISION_PATTERNS.find((p) => p.type === "project");
  assert.ok(projectPattern, "Should have project pattern");

  const testCases = [
    "we chose SQLite for the database",
    "decided to use TypeScript",
    "picked Jest over Vitest",
    "selected React for the UI",
    "went with monorepo structure",
    "opted for a microservices approach",
  ];

  for (const text of testCases) {
    projectPattern.regex.lastIndex = 0;
    const match = projectPattern.regex.exec(text);
    assert.ok(match, `Should match: ${text}`);
  }
});

test("user pattern matches preference keywords", () => {
  const userPattern = DECISION_PATTERNS.find((p) => p.type === "user");
  assert.ok(userPattern, "Should have user pattern");

  const testCases = [
    "user prefers dark mode",
    "she likes the current layout",
    "wants a simpler interface",
    "favorite is the dark theme",
    "loves the new feature",
    "would rather use tabs",
  ];

  for (const text of testCases) {
    userPattern.regex.lastIndex = 0;
    const match = userPattern.regex.exec(text);
    assert.ok(match, `Should match: ${text}`);
  }
});

test("feedback pattern matches resolution keywords", () => {
  const feedbackPattern = DECISION_PATTERNS.find((p) => p.type === "feedback");
  assert.ok(feedbackPattern, "Should have feedback pattern");

  const testCases = [
    "fixed by updating dependencies",
    "solved by adding a retry mechanism",
    "resolved by clearing the cache",
    "worked around the issue",
    "handled by the error boundary",
  ];

  for (const text of testCases) {
    feedbackPattern.regex.lastIndex = 0;
    const match = feedbackPattern.regex.exec(text);
    assert.ok(match, `Should match: ${text}`);
  }
});

test("extractDecisions returns empty array for empty events", () => {
  const decisions = extractDecisions([]);
  assert.equal(decisions.length, 0);
});

test("extractDecisions returns empty array when no keywords in events", () => {
  const events: AlixEvent[] = [
    createEvent("user.message", { text: "Hello, how are you today?" }),
    createEvent("agent.message", { text: "I'm doing well, thank you!" }),
  ];

  const decisions = extractDecisions(events);
  assert.equal(decisions.length, 0);
});

test("extractDecisions finds project decisions from user.message", () => {
  const events: AlixEvent[] = [
    createEvent("user.message", { text: "We chose SQLite for the database because it's lightweight." }),
  ];

  const decisions = extractDecisions(events);
  assert.ok(decisions.length > 0, "Should find at least one decision");

  const projectDecisions = decisions.filter((d) => d.type === "project");
  assert.ok(projectDecisions.length > 0, "Should have project decision");

  const decision = projectDecisions[0];
  assert.ok(decision.content.toLowerCase().includes("chose"), "Content should include 'chose'");
  assert.ok(decision.name.includes("decision"), "Name should include 'decision' suffix");
  assert.equal(decision.confidence, 0.5, "Auto-extracted decisions start at 0.5");
  assert.equal(decision.confirmations, 0);
});

test("extractDecisions finds user preferences from agent.message", () => {
  const events: AlixEvent[] = [
    createEvent("agent.message", { text: "Based on your feedback, user prefers dark mode settings." }),
  ];

  const decisions = extractDecisions(events);
  const userDecisions = decisions.filter((d) => d.type === "user");
  assert.ok(userDecisions.length > 0, "Should find user preference");
});

test("extractDecisions finds feedback decisions from hook events", () => {
  const events: AlixEvent[] = [
    createEvent("hook.pre_task", { command: "build", reason: "Fixed by using the correct build flags" }),
    createEvent("hook.post_task", { output: "Issue solved by clearing cache first" }),
  ];

  const decisions = extractDecisions(events);
  const feedbackDecisions = decisions.filter((d) => d.type === "feedback");
  assert.ok(feedbackDecisions.length > 0, "Should find feedback decisions from hook events");
});

test("extractDecisions extracts from multiple payload fields", () => {
  const events: AlixEvent[] = [
    createEvent("user.message", { text: "decided to use Rust" }),
    createEvent("agent.message", { output: "prefers the Go approach" }),
    createEvent("hook.pre_task", { command: "test", reason: "wants faster tests" }),
  ];

  const decisions = extractDecisions(events);
  assert.ok(decisions.length >= 2, "Should find decisions in multiple event types");
});

test("extractDecisions skips non-text event types", () => {
  const events: AlixEvent[] = [
    createEvent("tool.completed", { toolCallId: "123", toolName: "file.read", status: "success" }),
    createEvent("patch.applied", { proposalId: "p1", changedFiles: ["a.ts"] }),
    createEvent("user.message", { text: "decided to use PostgreSQL" }),
  ];

  const decisions = extractDecisions(events);
  const projectDecisions = decisions.filter((d) => d.type === "project");
  assert.ok(projectDecisions.length > 0, "Should still find decisions");
});

test("extractDecisions sets correct source format", () => {
  const sessionId = "my-test-session";
  const events: AlixEvent[] = [
    createEvent("user.message", { text: "we chose a simple approach" }, sessionId),
  ];

  const decisions = extractDecisions(events);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].source, `session:${sessionId}`);
});

test("extractDecisions handles multiple matches in same event", () => {
  const events: AlixEvent[] = [
    createEvent("user.message", {
      text: "We chose TypeScript and decided to use Jest. The user prefers fast tests."
    }),
  ];

  const decisions = extractDecisions(events);
  assert.ok(decisions.length >= 2, "Should find multiple decisions in one event");
});

test("extractDecisions generates short names", () => {
  const events: AlixEvent[] = [
    createEvent("user.message", { text: "we chose this very long filename approach for the project" }),
  ];

  const decisions = extractDecisions(events);
  assert.ok(decisions.length > 0);

  const name = decisions[0].name;
  // Name should be truncated (4 words + suffix)
  assert.ok(name.length < 100, "Name should be reasonably short");
  assert.ok(name.includes("..."), "Name should indicate truncation");
});

test("extractDecisions uses keyword filter before regex", () => {
  // This tests the optimization - even without a full match,
  // the keyword presence affects processing
  const events: AlixEvent[] = [
    createEvent("user.message", { text: "The project has keywords but not patterns" }),
  ];

  const decisions = extractDecisions(events);
  // No regex match since "chose" is not followed by a proper pattern
  assert.equal(decisions.length, 0);
});