// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../src/events/event-log.js";
import {
  createExecutionStateEmitter,
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
});
