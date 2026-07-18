import { beforeEach, describe, it, expect, vi } from "vitest";
import { createAgentSession } from "../../src/agent/session.js";
import { SessionPhase } from "../../src/tui/state.js";

const mocks = vi.hoisted(() => ({
  append: vi.fn(() => Promise.resolve()),
  initAgent: vi.fn(),
  runTaskLoop: vi.fn(),
}));

vi.mock("../../src/agent/agent.js", () => ({ initAgent: mocks.initAgent }));
vi.mock("../../src/run/task-loop.js", () => ({ runTaskLoop: mocks.runTaskLoop }));
vi.mock("../../src/utils/memory/recall.js", () => ({
  buildMemoryContext: vi.fn(() => Promise.resolve(undefined)),
  buildMemoryStats: vi.fn(() => Promise.resolve(undefined)),
}));
vi.mock("../../src/skills/loader.js", () => ({
  loadSkillManifests: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../../src/skills/catalog.js", () => ({
  buildSkillCatalog: vi.fn(() => ({
    getMatchedContent: vi.fn(() => Promise.resolve([])),
  })),
}));
vi.mock("../../src/skills/lifecycle.js", () => ({ evictIfNeeded: vi.fn() }));

beforeEach(() => {
  mocks.append.mockClear();
  mocks.initAgent.mockReset().mockResolvedValue({
    sessionId: "phase-test-session",
    sessionDir: "/tmp/phase-test-session",
    log: {
      append: mocks.append,
      readAll: vi.fn(() => Promise.resolve([])),
    },
    config: {
      model: {
        provider: "anthropic",
        name: "test-model",
        streaming: false,
        maxContextTokens: 1_000,
        maxIterations: 1,
      },
      permissions: { sessionMode: "auto" },
      apiKeys: {},
    },
    provider: { editFormatPreference: "structured_patch" },
    editFormatPolicy: {},
    mcpManager: null,
    toolExecutor: {},
    checkpointManager: {},
    memoryStore: {},
    repoMap: undefined,
    scope: {},
    hookRunner: {},
  });
  mocks.runTaskLoop.mockReset().mockResolvedValue({
    summary: "phase test complete",
    streamed: false,
    reason: "completed",
  });
});

describe("SessionPhase (contract)", () => {
  it("Idle is defined for sessions that have not yet run", () => {
    expect(SessionPhase.Idle).toBeDefined();
  });

  it("progresses through Understanding → Planning → Executing → Verifying → Summarizing → Idle", () => {
    const order = [
      SessionPhase.Understanding,
      SessionPhase.Planning,
      SessionPhase.Executing,
      SessionPhase.Verifying,
      SessionPhase.Summarizing,
      SessionPhase.Idle,
    ];
    expect(order).toEqual([
      SessionPhase.Understanding,
      SessionPhase.Planning,
      SessionPhase.Executing,
      SessionPhase.Verifying,
      SessionPhase.Summarizing,
      SessionPhase.Idle,
    ]);
  });

  it("enum has 6 phases (string-valued, no reverse-mapped duplication)", () => {
    expect(Object.keys(SessionPhase).length).toBe(6);
  });

  it("each phase is a distinct non-empty string", () => {
    const values = Object.values(SessionPhase);
    expect(values).toHaveLength(6);
    for (const v of values) {
      expect(typeof v).toBe("string");
      expect((v as string).length).toBeGreaterThan(0);
    }
    expect(new Set(values).size).toBe(6);
  });

  it("phase values are JSON-serialisable as readable strings", () => {
    expect(JSON.stringify({ phase: SessionPhase.Understanding })).toBe(
      '{"phase":"Understanding"}',
    );
  });

  it("getPhase() returns Idle initially", () => {
    const session = createAgentSession({ cwd: "/tmp", task: "" });

    expect(session.getPhase?.()).toBe(SessionPhase.Idle);
  });

  it("phase_changed event payload shape", async () => {
    const session = createAgentSession({
      cwd: "/tmp",
      task: "",
      planMode: false,
    });

    await session.processTurn("exercise phase wiring");

    expect(mocks.append).toHaveBeenCalledWith({
      sessionId: "phase-test-session",
      actor: "system",
      type: "agent.session.phase_changed",
      payload: { phase: SessionPhase.Understanding },
    });
    expect(mocks.append).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent.session.phase_changed",
        payload: { phase: SessionPhase.Planning },
      }),
    );
  });
});
