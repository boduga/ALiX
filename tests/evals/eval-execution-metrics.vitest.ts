/**
 * eval-execution-metrics.vitest.ts — pins the Gate B tool/retry/approval counts
 * captured from an eval case's session log.
 *
 * The bug class this guards is the same one `eval-usage-capture` guards: the
 * runner deletes the case cwd in a `finally`, so anything not read while the log
 * exists is lost. The second contract is null-vs-zero: an unreadable log is
 * UNKNOWN, never a measured zero, because a zero would read as "the agent made
 * no tool calls" and quietly deflate a failure.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureEvalExecutionMetrics } from "../../src/operations/evals/eval-execution-metrics.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

function makeCase(): string {
  return mkdtempSync(join(tmpdir(), "eval-metrics-"));
}

function writeSession(cwd: string, sessionId: string, events: unknown[]): void {
  const dir = join(cwd, ".alix", "sessions", sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "events.jsonl"), events.map(e => JSON.stringify(e)).join("\n") + "\n");
}

function requested(toolCallId: string, toolName: string, argsPreview: unknown = {}) {
  return { type: "tool.requested", payload: { toolCallId, toolName, argsPreview } };
}

function completed(toolCallId: string) {
  return { type: "tool.completed", payload: { toolCallId, status: "success" } };
}

function failed(toolCallId: string, error = "boom") {
  return { type: "tool.failed", payload: { toolCallId, error } };
}

function approval(approvalId: string) {
  return { type: "approval.resolved", payload: { approvalId, decision: "approved" } };
}

describe("captureEvalExecutionMetrics", () => {
  it("reports observed=false and null counts when no session log exists", () => {
    const cwd = makeCase();
    const m = captureEvalExecutionMetrics(cwd);
    expect(m.observed).toBe(false);
    expect(m.toolCalls).toBeNull();
    expect(m.toolCallsCompleted).toBeNull();
    expect(m.toolCallsFailed).toBeNull();
    expect(m.repeatedCalls).toBeNull();
    expect(m.toolRetries).toBeNull();
    expect(m.operatorInterventions).toBeNull();
    expect(m.unobserved.length).toBeGreaterThan(0);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("counts requested, completed and failed calls", () => {
    const cwd = makeCase();
    writeSession(cwd, "s1", [
      requested("c1", "alix_file_read"),
      completed("c1"),
      requested("c2", "alix_shell_run"),
      failed("c2", "exit 1"),
      requested("c3", "alix_grep_search"),
      completed("c3"),
    ]);
    const m = captureEvalExecutionMetrics(cwd);
    expect(m.observed).toBe(true);
    expect(m.toolCalls).toBe(3);
    expect(m.toolCallsCompleted).toBe(2);
    expect(m.toolCallsFailed).toBe(1);
    expect(m.repeatedCalls).toBe(0);
    expect(m.toolRetries).toBe(0);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("counts a measured zero when the log was read but held no tool events", () => {
    const cwd = makeCase();
    writeSession(cwd, "s1", [{ type: "session.started", payload: {} }]);
    const m = captureEvalExecutionMetrics(cwd);
    expect(m.observed).toBe(true);
    expect(m.toolCalls).toBe(0);
    expect(m.toolCallsCompleted).toBe(0);
    expect(m.toolCallsFailed).toBe(0);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("counts a repeat only when the same identity is requested twice", () => {
    const cwd = makeCase();
    writeSession(cwd, "s1", [
      requested("c1", "alix_file_read", { path: "a.ts" }),
      completed("c1"),
      requested("c2", "alix_file_read", { path: "b.ts" }),
      completed("c2"),
      requested("c3", "alix_file_read", { path: "a.ts" }),
      completed("c3"),
    ]);
    const m = captureEvalExecutionMetrics(cwd);
    expect(m.toolCalls).toBe(3);
    expect(m.repeatedCalls).toBe(1);
    expect(m.toolRetries).toBe(0);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("treats argument key order as the same call", () => {
    const cwd = makeCase();
    writeSession(cwd, "s1", [
      requested("c1", "alix_file_create", { path: "a.ts", content: "x" }),
      completed("c1"),
      requested("c2", "alix_file_create", { content: "x", path: "a.ts" }),
      completed("c2"),
    ]);
    const m = captureEvalExecutionMetrics(cwd);
    expect(m.repeatedCalls).toBe(1);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("counts a tool retry only after the previous attempt failed", () => {
    const cwd = makeCase();
    writeSession(cwd, "s1", [
      requested("c1", "alix_shell_run", { command: "pnpm test" }),
      failed("c1", "exit 1"),
      requested("c2", "alix_shell_run", { command: "pnpm test" }),
      completed("c2"),
    ]);
    const m = captureEvalExecutionMetrics(cwd);
    expect(m.repeatedCalls).toBe(1);
    expect(m.toolRetries).toBe(1);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("does not count a retry when a repeated call follows success", () => {
    const cwd = makeCase();
    writeSession(cwd, "s1", [
      requested("c1", "alix_file_read", { path: "a.ts" }),
      completed("c1"),
      requested("c2", "alix_file_read", { path: "a.ts" }),
      completed("c2"),
    ]);
    const m = captureEvalExecutionMetrics(cwd);
    expect(m.repeatedCalls).toBe(1);
    expect(m.toolRetries).toBe(0);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("counts approval.resolved as an operator intervention", () => {
    const cwd = makeCase();
    writeSession(cwd, "s1", [approval("a1"), approval("a2"), requested("c1", "alix_shell_run"), completed("c1")]);
    const m = captureEvalExecutionMetrics(cwd);
    expect(m.operatorInterventions).toBe(2);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("skips malformed lines without discarding valid counts", () => {
    const cwd = makeCase();
    const dir = join(cwd, ".alix", "sessions", "s1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "events.jsonl"),
      [
        JSON.stringify(requested("c1", "alix_file_read")),
        "{ not json",
        "",
        JSON.stringify(completed("c1")),
        '{"type":"tool.requested","payload":{"toolCallId":"c2',
      ].join("\n"),
    );
    const m = captureEvalExecutionMetrics(cwd);
    expect(m.observed).toBe(true);
    expect(m.toolCalls).toBe(1);
    expect(m.toolCallsCompleted).toBe(1);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("reads across multiple session directories", () => {
    const cwd = makeCase();
    writeSession(cwd, "s1", [requested("c1", "alix_file_read"), completed("c1")]);
    writeSession(cwd, "s2", [requested("c1", "alix_shell_run"), failed("c1")]);
    const m = captureEvalExecutionMetrics(cwd);
    expect(m.toolCalls).toBe(2);
    expect(m.toolCallsCompleted).toBe(1);
    expect(m.toolCallsFailed).toBe(1);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("does not count repeated requests in different sessions as repeats", () => {
    const cwd = makeCase();
    writeSession(cwd, "s1", [requested("c1", "alix_file_read", { path: "a.ts" }), completed("c1")]);
    writeSession(cwd, "s2", [requested("c1", "alix_file_read", { path: "a.ts" }), completed("c1")]);
    const m = captureEvalExecutionMetrics(cwd);
    expect(m.toolCalls).toBe(2);
    expect(m.repeatedCalls).toBe(0);
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("runner ordering", () => {
  it("captures execution metrics BEFORE the cleanup that deletes the session log", () => {
    // Source-order contract, mirroring the usage-capture test. If capture moved
    // after rmSync every sweep row would report unknown tool counts.
    const src = readFileSync(
      join(repoRoot, "src", "operations", "evals", "evals-runner.ts"),
      "utf-8",
    );
    const capture = src.indexOf("captureEvalExecutionMetrics(cwd)");
    const cleanup = src.indexOf("rmSync(fixtureRoot, { recursive: true, force: true })");
    expect(capture).toBeGreaterThan(-1);
    expect(cleanup).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(cleanup);
  });
});
