// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../src/events/event-log.js";
import {
  mapSessionEventsToProjectorHistory,
  measureSessionShadow,
} from "../benchmark/session-shadow.js";
import { project, toExecutionState } from "../src/runtime/execution-state/execution-state-projector.js";

describe("benchmark session-shadow — real-session bounded prompt measurement", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "alix-session-shadow-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(): Promise<EventLog> {
    const log = new EventLog(dir);
    await log.init();
    await log.append({ sessionId: "s1", type: "session.started", actor: "system", payload: {} });
    await log.append({
      sessionId: "s1",
      type: "user.message",
      actor: "user",
      payload: { text: "harden the auth path" },
    });
    await log.append({
      sessionId: "s1",
      type: "tool.requested",
      actor: "agent",
      payload: { toolCallId: "c1", toolName: "grep.search", capability: "file.search", argsPreview: {} },
    });
    await log.append({
      sessionId: "s1",
      type: "tool.output",
      actor: "tool",
      payload: { toolCallId: "c1", outputPreview: "match A\nmatch B", outputSize: 16 },
    });
    await log.append({
      sessionId: "s1",
      type: "tool.completed",
      actor: "tool",
      payload: { toolCallId: "c1", toolName: "grep.search", status: "success", durationMs: 5 },
    });
    await log.append({
      sessionId: "s1",
      type: "artifact.created",
      actor: "tool",
      payload: { artifactId: "a1", toolCallId: "c1", path: "out/report.md", mimeType: "text/markdown", size: 12, retention: "session" },
    });
    await log.append({
      sessionId: "s1",
      type: "context.assembled",
      actor: "system",
      payload: { invocationId: "inv-1", admittedTokens: 5000, droppedTokens: 0 },
    });
    return log;
  }

  it("bridges tool lifecycle + artifacts onto the projector vocabulary", async () => {
    const log = await seed();
    const events = await log.readAll();
    const { projectorEvents, coverage } = mapSessionEventsToProjectorHistory(events, {
      executionId: "s1",
      objective: "harden the auth path",
    });

    expect(coverage.proposedActions).toBe(1);
    expect(coverage.completedActions).toBe(1);
    expect(coverage.artifacts).toBe(1);

    const state = toExecutionState(project(projectorEvents));
    expect(state.executionId).toBe("s1");
    expect(state.objective).toBe("harden the auth path");
    // proposed then completed → net zero pending
    expect(state.pendingActions).toHaveLength(0);
    expect(state.artifacts).toHaveLength(1);
    expect(state.artifacts[0].uri).toBe("out/report.md");
  });

  it("measures a bounded prompt and reads the live admitted tokens", async () => {
    await seed();
    const report = await measureSessionShadow(dir);

    expect(report.ok).toBe(true);
    expect(report.bounded).toBe(true);
    expect(report.livePromptTokens).toBe(5000);
    expect(report.shadowPromptTokens).toBeGreaterThan(0);
    expect(report.shadowPromptTokens).toBeLessThan(5000);
    expect(report.state?.objective).toBe("harden the auth path");
    expect(report.state?.artifacts).toBe(1);
    expect(report.sections?.historyIncluded).toBe(false);
  });

  it("is deterministic — same history → same shadow tokens", async () => {
    await seed();
    const a = await measureSessionShadow(dir);
    const b = await measureSessionShadow(dir);
    expect(a.shadowPromptTokens).toBe(b.shadowPromptTokens);
    expect(a.state).toEqual(b.state);
  });

  it("is fail-soft on empty history (seeds execution.created)", async () => {
    const log = new EventLog(dir);
    await log.init();
    const report = await measureSessionShadow(dir, { objective: "explicit objective" });
    expect(report.ok).toBe(true);
    expect(report.state?.objective).toBe("explicit objective");
    expect(report.livePromptTokens).toBeNull();
  });

  it("forwards real execution.* events instead of synthesizing a duplicate genesis", async () => {
    const log = new EventLog(dir);
    await log.init();
    await log.append({
      sessionId: "s1",
      type: "execution.created",
      actor: "system",
      payload: { executionId: "s1", objective: "live emitted objective" },
    });
    await log.append({
      sessionId: "s1",
      type: "execution.status_changed",
      actor: "system",
      payload: { status: "running" },
    });

    const report = await measureSessionShadow(dir);
    expect(report.ok).toBe(true);
    expect(report.state?.objective).toBe("live emitted objective");
    expect(report.state?.status).toBe("running");
  });
});
