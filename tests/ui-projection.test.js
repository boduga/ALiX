import test from "node:test";
import assert from "node:assert/strict";
import { buildUiProjection, createReplayState, visibleEventsForReplay } from "../src/ui/projection.js";

const events = [
  { seq: 1, type: "session.started", actor: "system", timestamp: "2026-01-01T00:00:00Z", payload: {} },
  { seq: 2, type: "tool.requested", actor: "system", timestamp: "2026-01-01T00:00:01Z", payload: { toolCallId: "s1", toolName: "shell.run", argsPreview: { command: "npm test" } } },
  { seq: 3, type: "tool.completed", actor: "system", timestamp: "2026-01-01T00:00:02Z", payload: { toolCallId: "s1", toolName: "shell.run", status: "success", outputPreview: "ok" } },
  { seq: 4, type: "verification.check_finished", actor: "verifier", timestamp: "2026-01-01T00:00:03Z", payload: { command: "npm test", status: "passed" } },
];

test("buildUiProjection derives panel counts from raw events", () => {
  const projection = buildUiProjection(events);
  assert.equal(projection.summary.eventCount, 4);
  assert.equal(projection.summary.toolCount, 2);
  assert.equal(projection.terminal[0].command, "npm test");
  assert.equal(projection.verification[0].status, "passed");
});

test("visibleEventsForReplay returns events up to cursor", () => {
  const state = createReplayState(events);
  state.cursor = 2;
  assert.deepEqual(visibleEventsForReplay(state).map((event) => event.seq), [1, 2]);
});

test("buildUiProjection extracts diff and approval data", () => {
  const withDiff = [
    { seq: 1, type: "tool.completed", actor: "system", timestamp: "2026-01-01T00:00:01Z", payload: { toolCallId: "p1", toolName: "patch.apply", changedFiles: ["src/a.ts"] } },
  ];
  const projection = buildUiProjection(withDiff);
  assert.equal(projection.diffs[0].changedFiles[0], "src/a.ts");
});

test("buildUiProjection extracts token usage", () => {
  const withTokens = [
    { seq: 1, type: "model.usage", actor: "agent", timestamp: "2026-01-01T00:00:01Z", payload: { provider: "anthropic", inputTokens: 100, outputTokens: 20 } },
  ];
  const projection = buildUiProjection(withTokens);
  assert.equal(projection.tokens.totalInputTokens, 100);
  assert.equal(projection.tokens.totalOutputTokens, 20);
});

test("createReplayState sorts events by seq", () => {
  const unsorted = [
    { seq: 3, type: "session.ended", actor: "system", timestamp: "2026-01-01T00:00:03Z", payload: {} },
    { seq: 1, type: "session.started", actor: "system", timestamp: "2026-01-01T00:00:01Z", payload: {} },
    { seq: 2, type: "tool.requested", actor: "system", timestamp: "2026-01-01T00:00:02Z", payload: {} },
  ];
  const state = createReplayState(unsorted);
  assert.deepEqual(state.events.map((e) => e.seq), [1, 2, 3]);
  assert.equal(state.cursor, 3);
});