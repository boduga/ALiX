// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { PolicyGate } from "../../src/policy/policy-gate.js";
import type { AlixConfig } from "../../src/config/schema.js";
import type { ExecutionState } from "../../src/runtime/execution-state/execution-state.js";
import {
  createPolicyTransitionGovernor,
  createPolicyBackedEmitter,
  EXECUTION_STATE_CAPABILITY,
} from "../../src/runtime/state/policy-governor.js";

function makeConfig(overrides?: Record<string, unknown>): AlixConfig {
  const base = {
    version: 1,
    model: { provider: "mock", name: "mock", streaming: false, maxIterations: 10, maxContextTokens: 32000 },
    permissions: {
      sessionMode: "ask",
      default: "ask",
      tools: {},
      protectedPaths: [] as string[],
      allowNetworkDomains: [],
      denyCommands: [],
    },
    context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 0, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
    runtime: { provider: "process", shell: "/bin/bash", commandTimeoutMs: 10000, envAllowlist: [] },
    ui: { enabled: false, host: "", port: 0, transport: "sse" as const },
  };
  if (!overrides) return base as unknown as AlixConfig;
  return { ...base, ...overrides } as unknown as AlixConfig;
}

const NO_STATE = null as unknown as ExecutionState;

const proposal = (patch: Record<string, unknown> = { objective: "x" }) => ({
  executionId: "e1",
  baseStateVersion: 1,
  patch: patch as { objective: string },
});

describe("policy-governor — real PolicyGate behind TransitionGovernor", () => {
  it("allows when policy allows execution-state.write", async () => {
    const gate = new PolicyGate(
      makeConfig({ permissions: { tools: { [EXECUTION_STATE_CAPABILITY]: "allow" } } }),
    );
    const gov = createPolicyTransitionGovernor(gate, { sessionMode: "ask", sessionId: "s1" });
    const d = await gov.evaluate(proposal(), NO_STATE);
    expect(d.decision).toBe("allow");
  });

  it("denies when policy denies execution-state.write, surfacing the reason", async () => {
    const gate = new PolicyGate(
      makeConfig({ permissions: { tools: { [EXECUTION_STATE_CAPABILITY]: "deny" } } }),
    );
    const gov = createPolicyTransitionGovernor(gate, { sessionMode: "ask", sessionId: "s1" });
    const d = await gov.evaluate(proposal(), NO_STATE);
    expect(d.decision).toBe("deny");
    expect((d as { reason: string }).reason).toMatch(/Denied by tool policy/);
  });

  it("fails closed without an approval store (no approval created, no spam)", async () => {
    const gate = new PolicyGate(makeConfig());
    const gov = createPolicyTransitionGovernor(gate, { sessionMode: "ask", sessionId: "s1" });
    const d = await gov.evaluate(proposal(), NO_STATE);
    // Storeless gate: ask -> "approval-store-missing" deny inside the gate,
    // so the adapter denies without creating anything.
    expect(d.decision).toBe("deny");
  });

  it("escalates on ask (harness treats escalate as rejection)", async () => {
    const gate = {
      evaluateCapability: async (_request: unknown) => ({
        requestId: "r1",
        capability: EXECUTION_STATE_CAPABILITY,
        decision: "ask" as const,
        reason: "Pending approval: ap-1",
      }),
    };
    const gov = createPolicyTransitionGovernor(gate, { sessionMode: "ask" });
    const d = await gov.evaluate(proposal(), NO_STATE);
    expect(d.decision).toBe("escalate");
  });

  it("denies proposals carrying an action (patch-only)", async () => {
    const gate = new PolicyGate(
      makeConfig({ permissions: { tools: { [EXECUTION_STATE_CAPABILITY]: "allow" } } }),
    );
    const gov = createPolicyTransitionGovernor(gate, { sessionMode: "ask" });
    const d = await gov.evaluate(
      {
        executionId: "e1",
        baseStateVersion: 1,
        patch: { objective: "x" },
        action: { kind: "shell.run" },
      },
      NO_STATE,
    );
    expect(d.decision).toBe("deny");
  });

  it("fails closed when the gate throws", async () => {
    const gate = {
      evaluateCapability: async (_request: unknown): Promise<never> => {
        throw new Error("gate down");
      },
    };
    const gov = createPolicyTransitionGovernor(gate, { sessionMode: "auto" });
    const d = await gov.evaluate(proposal(), NO_STATE);
    expect(d.decision).toBe("deny");
    expect((d as { reason: string }).reason).toMatch(/gate down/);
  });

  it("createPolicyBackedEmitter wires the adapter into a working emitter", async () => {
    const { EventLog } = await import("../../src/events/event-log.js");
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const sessionDir = await mkdtemp(join(tmpdir(), "alix-pb-session-"));
    const storeDir = await mkdtemp(join(tmpdir(), "alix-pb-store-"));
    try {
      const log = new EventLog(sessionDir);
      await log.init();
      const gate = new PolicyGate(
        makeConfig({ permissions: { tools: { [EXECUTION_STATE_CAPABILITY]: "allow" } } }),
      );
      const emitter = createPolicyBackedEmitter({
        gate,
        log,
        sessionId: "s1",
        sessionMode: "ask",
        storeDir,
      });
      await emitter.bootstrap("policy objective");
      await emitter.setObjective("updated objective");
      expect(emitter.getState()?.objective).toBe("updated objective");
      expect(emitter.lastError).toBeNull();
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
      await rm(storeDir, { recursive: true, force: true });
    }
  });
});
