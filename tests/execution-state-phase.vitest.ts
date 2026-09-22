// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../src/events/event-log.js";
import {
  buildLiveSendRequest,
  createExecutionStateEmitter,
  emitTurnShadow,
  initExecutionStateEmission,
  reconcileTurnArtifacts,
} from "../src/run/task-loop/execution-state-phase.js";

describe("execution-state-phase — session emitter + turn reconcile", () => {
  let sessionDir: string;
  let storeDir: string;

  beforeEach(async () => {
    sessionDir = await mkdtemp(join(tmpdir(), "alix-esp-session-"));
    storeDir = await mkdtemp(join(tmpdir(), "alix-esp-store-"));
    process.env.ALIX_EXECUTION_STATE_EMIT = "1";
  });

  afterEach(async () => {
    delete process.env.ALIX_EXECUTION_STATE_EMIT;
    delete process.env.ALIX_EXECUTION_STATE_SEND;
    await rm(sessionDir, { recursive: true, force: true });
    await rm(storeDir, { recursive: true, force: true });
  });

  it("createExecutionStateEmitter is null without the flag", () => {
    delete process.env.ALIX_EXECUTION_STATE_EMIT;
    const log = new EventLog(sessionDir);
    expect(createExecutionStateEmitter({ log, sessionId: "s1", storeDir })).toBeNull();
  });

  it("initExecutionStateEmission reuses the caller-provided instance", async () => {
    const log = new EventLog(sessionDir);
    await log.init();
    const existing = createExecutionStateEmitter({ log, sessionId: "s1", storeDir })!;
    const returned = await initExecutionStateEmission({
      log,
      sessionId: "s1",
      objective: "shared objective",
      existing,
      storeDir,
    });
    expect(returned).toBe(existing);
    expect(existing.getState()?.objective).toBe("shared objective");
  });

  it("reconcileTurnArtifacts registers only valid artifact.created since the cursor", async () => {
    const log = new EventLog(sessionDir);
    await log.init();
    const emitter = createExecutionStateEmitter({ log, sessionId: "s1", storeDir })!;
    await emitter.bootstrap("obj");

    const cursor = log.getCursor();
    await log.append({ sessionId: "s1", type: "user.message", actor: "user", payload: { text: "hi" } });
    await log.append({
      sessionId: "s1",
      type: "artifact.created",
      actor: "tool",
      payload: { artifactId: "a1", toolCallId: "c1", path: "out/a.md", mimeType: "text/markdown", size: 4, retention: "session" },
    });
    await log.append({
      sessionId: "s1",
      type: "artifact.created",
      actor: "tool",
      payload: { artifactId: "broken" },
    });

    await reconcileTurnArtifacts({ emitter, log, cursor });
    expect(emitter.getState()?.artifacts.map((a) => a.artifactId)).toEqual(["a1"]);

    // Idempotent — a second reconcile adds nothing
    await reconcileTurnArtifacts({ emitter, log, cursor });
    expect(emitter.getState()?.artifacts).toHaveLength(1);
  });

  it("reconcileTurnArtifacts is a no-op for null emitter or cursor", async () => {
    const log = new EventLog(sessionDir);
    await log.init();
    await expect(reconcileTurnArtifacts({ emitter: null, log, cursor: null })).resolves.toBeUndefined();
  });

  it("emitTurnShadow records the token delta without sending the prompt", async () => {
    const log = new EventLog(sessionDir);
    await log.init();
    const emitter = createExecutionStateEmitter({ log, sessionId: "s1", storeDir })!;
    await emitter.bootstrap("find the bug");

    await emitTurnShadow({
      emitter,
      log,
      sessionId: "s1-agent",
      invocationId: "inv-1",
      objective: "find the bug",
      tools: [{ name: "grep.search", description: "search files" }],
      liveAdmittedTokens: 5000,
    });

    const shadow = (await log.readAll()).find((e) => e.type === "context.shadow.assembled");
    expect(shadow).toBeDefined();
    expect(shadow?.sessionId).toBe("s1-agent");
    const payload = shadow?.payload as Record<string, unknown>;
    expect(payload.invocationId).toBe("inv-1");
    expect(payload.bounded).toBe(true);
    expect(typeof payload.shadowPromptTokens).toBe("number");
    expect(payload.shadowPromptTokens as number).toBeLessThan(5000);
    expect(payload.liveAdmittedTokens).toBe(5000);
  });

  it("emitTurnShadow no-ops when the emitter holds no state", async () => {
    const log = new EventLog(sessionDir);
    await log.init();
    const emitter = createExecutionStateEmitter({ log, sessionId: "s1", storeDir })!;
    await emitTurnShadow({
      emitter,
      log,
      sessionId: "s1-agent",
      invocationId: "inv-1",
      objective: "obj",
      tools: [],
      liveAdmittedTokens: 100,
    });
    expect((await log.readAll()).filter((e) => e.type === "context.shadow.assembled")).toHaveLength(0);
  });

  it("buildLiveSendRequest returns null unless send flag + research + state", async () => {
    const log = new EventLog(sessionDir);
    await log.init();
    const emitter = createExecutionStateEmitter({ log, sessionId: "s1", storeDir })!;
    const base = {
      emitter,
      objective: "obj",
      tools: [],
      messages: [{ role: "user" as const, content: "find it" }],
    };
    // No state yet
    process.env.ALIX_EXECUTION_STATE_SEND = "1";
    expect(buildLiveSendRequest({ ...base, intent: "research" })).toBeNull();

    await emitter.bootstrap("obj");
    // Wrong intent
    expect(buildLiveSendRequest({ ...base, intent: "mutation" })).toBeNull();
    // Flag off
    delete process.env.ALIX_EXECUTION_STATE_SEND;
    expect(buildLiveSendRequest({ ...base, intent: "research" })).toBeNull();
  });

  it("buildLiveSendRequest returns the state prompt plus the task cue", async () => {
    const log = new EventLog(sessionDir);
    await log.init();
    const emitter = createExecutionStateEmitter({ log, sessionId: "s1", storeDir })!;
    await emitter.bootstrap("find the bug");
    process.env.ALIX_EXECUTION_STATE_SEND = "1";

    const req = buildLiveSendRequest({
      emitter,
      intent: "research",
      objective: "find the bug",
      tools: [{ name: "grep.search", description: "search" }],
      messages: [
        { role: "user" as const, content: "first question" },
        { role: "assistant" as const, content: "working on it" },
        { role: "user" as const, content: "latest question" },
      ],
    });
    expect(req).not.toBeNull();
    expect(req!.systemPrompt).toContain("find the bug");
    expect(req!.systemPrompt).toContain("latest question");
    expect(req!.messages).toHaveLength(1);
    expect(req!.messages[0]).toMatchObject({ role: "user", content: "latest question" });
    delete process.env.ALIX_EXECUTION_STATE_SEND;
  });

  it("buildLiveSendRequest carries prior turns as bounded evidence", async () => {
    const log = new EventLog(sessionDir);
    await log.init();
    const emitter = createExecutionStateEmitter({ log, sessionId: "s1", storeDir })!;
    await emitter.bootstrap("obj");
    process.env.ALIX_EXECUTION_STATE_SEND = "1";

    const req = buildLiveSendRequest({
      emitter,
      intent: "research",
      objective: "obj",
      tools: [],
      messages: [
        { role: "user" as const, content: "first turn" },
        { role: "user" as const, content: "second turn" },
        { role: "user" as const, content: "cue turn" },
      ],
    });
    expect(req!.systemPrompt).toContain("first turn");
    expect(req!.systemPrompt).toContain("second turn");
    expect(req!.systemPrompt).toContain("relevant_evidence");
    delete process.env.ALIX_EXECUTION_STATE_SEND;
  });
});
