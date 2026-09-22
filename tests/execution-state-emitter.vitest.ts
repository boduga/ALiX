// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../src/events/event-log.js";
import {
  ExecutionStateEmitter,
  isExecutionStateEmitEnabled,
} from "../src/runtime/execution-state/execution-state-emitter.js";

describe("ExecutionStateEmitter — governed live execution.* emission", () => {
  let sessionDir: string;
  let storeDir: string;

  beforeEach(async () => {
    sessionDir = await mkdtemp(join(tmpdir(), "alix-ese-session-"));
    storeDir = await mkdtemp(join(tmpdir(), "alix-ese-store-"));
  });

  afterEach(async () => {
    await rm(sessionDir, { recursive: true, force: true });
    await rm(storeDir, { recursive: true, force: true });
  });

  async function makeEmitter(): Promise<{ emitter: ExecutionStateEmitter; log: EventLog }> {
    const log = new EventLog(sessionDir);
    await log.init();
    const emitter = new ExecutionStateEmitter({
      log,
      sessionId: "sess-1",
      executionId: "sess-1",
      storeDir,
    });
    return { emitter, log };
  }

  it("is opt-in via ALIX_EXECUTION_STATE_EMIT", () => {
    expect(isExecutionStateEmitEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isExecutionStateEmitEnabled({ ALIX_EXECUTION_STATE_EMIT: "0" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isExecutionStateEmitEnabled({ ALIX_EXECUTION_STATE_EMIT: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isExecutionStateEmitEnabled({ ALIX_EXECUTION_STATE_EMIT: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("bootstraps genesis and emits execution.created + running to the EventLog", async () => {
    const { emitter, log } = await makeEmitter();
    await emitter.bootstrap("harden auth");

    const state = emitter.getState();
    expect(state).not.toBeNull();
    expect(state?.objective).toBe("harden auth");
    expect(state?.status).toBe("running");
    expect(state?.version).toBe(2);

    const types = (await log.readAll()).map((e) => e.type);
    expect(types).toContain("execution.created");
    expect(types).toContain("execution.status_changed");
  });

  it("bootstrap is idempotent", async () => {
    const { emitter, log } = await makeEmitter();
    await emitter.bootstrap("first");
    await emitter.bootstrap("second");
    expect(emitter.getState()?.objective).toBe("first");
    const created = (await log.readAll()).filter((e) => e.type === "execution.created");
    expect(created).toHaveLength(1);
  });

  it("setObjective / registerArtifact / bindCapability / applyConstraint go through the harness", async () => {
    const { emitter, log } = await makeEmitter();
    await emitter.bootstrap("obj");

    await emitter.setObjective("new objective");
    expect(emitter.getState()?.objective).toBe("new objective");

    await emitter.registerArtifact({ artifactId: "a1", uri: "out/report.md", kind: "text/markdown" });
    expect(emitter.getState()?.artifacts).toHaveLength(1);

    await emitter.bindCapability({ capabilityId: "file.read", version: "1.0.0", availability: "available" });
    expect(emitter.getState()?.activeCapabilities).toHaveLength(1);

    await emitter.applyConstraint({ kind: "deny_tool", value: "shell.run" });
    expect(emitter.getState()?.constraints).toHaveLength(1);

    const types = (await log.readAll()).map((e) => e.type);
    expect(types).toContain("execution.objective_set");
    expect(types).toContain("execution.artifact_registered");
    expect(types).toContain("execution.capability_bound");
    expect(types).toContain("execution.constraint_applied");
    expect(emitter.lastError).toBeNull();
  });

  it("fails soft when no genesis exists — records lastError, never throws", async () => {
    const { emitter } = await makeEmitter();
    await expect(emitter.setObjective("orphan")).resolves.toBeUndefined();
    expect(emitter.getState()).toBeNull();
    expect(emitter.lastError).toMatch(/bootstrap/);
  });

  it("is idempotent on repeated artifact registration", async () => {
    const { emitter } = await makeEmitter();
    await emitter.bootstrap("obj");
    await emitter.registerArtifact({ artifactId: "a1", uri: "out.md" });
    await emitter.registerArtifact({ artifactId: "a1", uri: "out.md" });
    expect(emitter.getState()?.artifacts).toHaveLength(1);
  });

  it("rejects empty genesis input without touching the log", async () => {
    const { emitter, log } = await makeEmitter();
    await emitter.bootstrap("   ");
    expect(emitter.getState()).toBeNull();
    expect(emitter.lastError).toMatch(/objective must be a non-empty string/);
    expect(await log.readAll()).toHaveLength(0);
  });

  it("accepts an injected governor and surfaces its denial", async () => {
    const log = new EventLog(sessionDir);
    await log.init();
    const emitter = new ExecutionStateEmitter({
      log,
      sessionId: "sess-1",
      executionId: "sess-1",
      storeDir,
      governor: { evaluate: () => ({ decision: "deny", reason: "policy forbids" }) },
    });
    await emitter.bootstrap("obj");
    await emitter.setObjective("other");
    expect(emitter.getState()?.objective).toBe("obj");
    expect(emitter.lastError).toMatch(/GOVERNANCE_DENIED/);
  });
});
