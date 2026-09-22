// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../src/events/event-log.js";
import { ExecutionStateEmitter } from "../src/runtime/execution-state/execution-state-emitter.js";
import {
  STATE_PROPOSAL_TOOL,
  STATE_PROPOSAL_TOOL_NAME,
  executeStateProposal,
  renderStateProposalResult,
  tryHandleStateProposal,
} from "../src/tools/state-proposal-tool.js";

describe("state-proposal-tool — model emits StateTransitionProposal", () => {
  let sessionDir: string;
  let storeDir: string;

  beforeEach(async () => {
    sessionDir = await mkdtemp(join(tmpdir(), "alix-spt-session-"));
    storeDir = await mkdtemp(join(tmpdir(), "alix-spt-store-"));
    process.env.ALIX_EXECUTION_STATE_EMIT = "1";
    process.env.ALIX_EXECUTION_STATE_SEND = "1";
  });

  afterEach(async () => {
    delete process.env.ALIX_EXECUTION_STATE_EMIT;
    delete process.env.ALIX_EXECUTION_STATE_SEND;
    await rm(sessionDir, { recursive: true, force: true });
    await rm(storeDir, { recursive: true, force: true });
  });

  async function makeEmitter(): Promise<ExecutionStateEmitter> {
    const log = new EventLog(sessionDir);
    await log.init();
    const emitter = new ExecutionStateEmitter({
      log,
      sessionId: "s1",
      executionId: "s1",
      storeDir,
    });
    await emitter.bootstrap("obj");
    return emitter;
  }

  const call = (args: unknown) => ({ id: "call-1", name: STATE_PROPOSAL_TOOL_NAME, args: args as Record<string, unknown> });

  it("exposes a well-formed tool definition", () => {
    expect(STATE_PROPOSAL_TOOL.name).toBe("execution_state_propose");
    expect(STATE_PROPOSAL_TOOL.input_schema.required).toContain("patch");
  });

  it("commits a valid model patch through the harness", async () => {
    const emitter = await makeEmitter();
    const outcome = await executeStateProposal(emitter, call({
      patch: { artifacts: [{ artifactId: "a1", uri: "out.md" }] },
    }));
    expect(outcome.committed).toBe(true);
    expect(emitter.getState()?.artifacts).toHaveLength(1);
    expect(renderStateProposalResult(outcome, "call-1")).toContain("committed");
  });

  it("rejects a non-object patch without touching state", async () => {
    const emitter = await makeEmitter();
    const before = emitter.getState()?.version;
    const outcome = await executeStateProposal(emitter, call({ patch: "nope" }));
    expect(outcome.committed).toBe(false);
    expect(outcome.reason).toBe("INVALID_PATCH");
    expect(emitter.getState()?.version).toBe(before);
    expect(renderStateProposalResult(outcome, "call-1")).toContain("rejected");
  });

  it("rejects unknown patch keys", async () => {
    const emitter = await makeEmitter();
    const outcome = await executeStateProposal(emitter, call({ patch: { bogus: 1 } }));
    expect(outcome.committed).toBe(false);
    expect(outcome.reason).toBe("INVALID_PATCH");
  });

  it("tryHandleStateProposal ignores other tools and missing emitters", async () => {
    const emitter = await makeEmitter();
    expect(await tryHandleStateProposal({ id: "c", name: "grep.search", args: {} }, emitter)).toBeNull();
    expect(await tryHandleStateProposal(call({ patch: {} }), null)).toBeNull();
  });

  it("tryHandleStateProposal returns a continuing tool result", async () => {
    const emitter = await makeEmitter();
    const res = await tryHandleStateProposal(call({ patch: { objective: "new objective" } }), emitter);
    expect(res).not.toBeNull();
    expect(res?.continue).toBe(true);
    expect(res?.message.role).toBe("user");
    expect(emitter.getState()?.objective).toBe("new objective");
  });

  it("tryHandleStateProposal stays inert unless SEND is on", async () => {
    const emitter = await makeEmitter();
    delete process.env.ALIX_EXECUTION_STATE_SEND;
    const res = await tryHandleStateProposal(call({ patch: { objective: "x" } }), emitter);
    expect(res).toBeNull();
    expect(emitter.getState()?.objective).toBe("obj");
  });
});
