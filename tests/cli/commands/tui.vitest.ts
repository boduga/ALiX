import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ReadlineHandler = (line: string) => void;
type ReadlineInterface = {
  setPrompt: (prompt: string) => void;
  prompt: () => void;
  once: (event: string, handler: ReadlineHandler) => ReadlineInterface;
  removeListener: (event: string, handler: ReadlineHandler) => ReadlineInterface;
  on: (event: string, handler: () => void) => ReadlineInterface;
  close: () => void;
};

type FakeStore = {
  getState: () => {
    activePanel: string;
    traceSelection: { detailOpen: boolean };
  };
};

const mocks = vi.hoisted(() => {
  const state: { lines: string[] } = { lines: [] };
  const session = {
    processTurn: vi.fn(),
    getSessionId: vi.fn(() => "session-1"),
    getState: vi.fn(),
    save: vi.fn(),
    resume: vi.fn(),
  };

  class FakeTui {
    readonly store: FakeStore = {
      getState: () => ({
        activePanel: "chat",
        traceSelection: { detailOpen: false },
      }),
    };
    readonly appendOutput = vi.fn();
    readonly resetOutput = vi.fn();
    readonly init = vi.fn(async () => undefined);
    readonly destroy = vi.fn();

    getStore(): FakeStore {
      return this.store;
    }
  }

  class FakeEventLog {
    readonly init = vi.fn(async () => undefined);
  }

  class FakeApprovalStore {
    readonly load = vi.fn(async () => undefined);
    listPending(): readonly unknown[] {
      return [];
    }
    readonly resolve = vi.fn(async () => null);
  }

  class FakeWorkspaceManager {
    readonly tryHandleCommand = vi.fn(async () => ({ handled: false }));
  }

  class FakeApprovalManager {
    readonly tryHandleCommand = vi.fn(async () => ({ handled: false }));
  }

  const createInterface = vi.fn((): ReadlineInterface => {
    let pendingLine: ReadlineHandler | undefined;
    const api: ReadlineInterface = {
      setPrompt: vi.fn(),
      prompt: vi.fn(() => {
        const line = state.lines.shift();
        if (line !== undefined && pendingLine) {
          queueMicrotask(() => pendingLine?.(line));
        }
      }),
      once: vi.fn((_event: string, handler: ReadlineHandler) => {
        pendingLine = handler;
        return api;
      }),
      removeListener: vi.fn((_event: string, _handler: ReadlineHandler) => {
        pendingLine = undefined;
        return api;
      }),
      on: vi.fn((_event: string, _handler: () => void) => api),
      close: vi.fn(),
    };
    return api;
  });

  return {
    state,
    session,
    FakeTui,
    FakeEventLog,
    FakeApprovalStore,
    FakeWorkspaceManager,
    FakeApprovalManager,
    createInterface,
    loadConfig: vi.fn(),
    createAgentSession: vi.fn(() => session),
    buildRuntimeSnapshot: vi.fn(async () => ({
      workspaceName: "test",
      workspacePath: process.cwd(),
      daemonRunning: false,
      daemonHeartbeatAge: -1,
    })),
    applySnapshotToStore: vi.fn(),
    renderPanelContent: vi.fn(),
    resolveContextLimit: vi.fn(async () => ({ maxTokens: 1000 })),
    listWorkspaces: vi.fn(async () => []),
    recordWorkspaceActivity: vi.fn(async () => undefined),
    getWorkspace: vi.fn(async () => undefined),
    submitTaskViaDaemon: vi.fn(),
    formatDaemonEvent: vi.fn(() => ""),
  };
});

vi.mock("node:readline", () => ({ createInterface: mocks.createInterface }));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  readFile: vi.fn(async () => ""),
}));
vi.mock("../../../src/tui/index.js", () => ({ Tui: mocks.FakeTui }));
vi.mock("../../../src/events/event-log.js", () => ({ EventLog: mocks.FakeEventLog }));
vi.mock("../../../src/config/loader.js", () => ({ loadConfig: mocks.loadConfig }));
vi.mock("../../../src/tui/workspace-manager.js", () => ({
  WorkspaceManager: mocks.FakeWorkspaceManager,
  promptLabel: vi.fn(() => "> "),
}));
vi.mock("../../../src/tui/approval-manager.js", () => ({ ApprovalManager: mocks.FakeApprovalManager }));
vi.mock("../../../src/agent/session.js", () => ({ createAgentSession: mocks.createAgentSession }));
vi.mock("../../../src/daemon/workspace-registry.js", () => ({
  listWorkspaces: mocks.listWorkspaces,
  recordWorkspaceActivity: mocks.recordWorkspaceActivity,
  getWorkspace: mocks.getWorkspace,
}));
vi.mock("../../../src/approvals/approval-store.js", () => ({ ApprovalStore: mocks.FakeApprovalStore }));
vi.mock("../../../src/config/context-limits.js", () => ({ resolveContextLimit: mocks.resolveContextLimit }));
vi.mock("../../../src/tui/runtime-snapshot.js", () => ({
  buildRuntimeSnapshot: mocks.buildRuntimeSnapshot,
  applySnapshotToStore: mocks.applySnapshotToStore,
}));
vi.mock("../../../src/tui/panel-renderer.js", () => ({ renderPanelContent: mocks.renderPanelContent }));
vi.mock("../../../src/tui/daemon-client.js", () => ({
  submitTaskViaDaemon: mocks.submitTaskViaDaemon,
  formatDaemonEvent: mocks.formatDaemonEvent,
}));

import { runLegacyChatTuiForCompat } from "../../../src/cli/commands/tui.js";

const config = {
  model: { provider: "anthropic", name: "test-model", streaming: true },
  permissions: { sessionMode: "bypass" },
  apiKeys: {},
};

describe("runLegacyChatTuiForCompat AgentSession integration", () => {
  let stdinDescriptor: PropertyDescriptor | undefined;
  let stdoutDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    mocks.state.lines = ["?", "hello from the TUI", "exit"];
    mocks.loadConfig.mockResolvedValue(config);
    mocks.createAgentSession.mockClear();
    mocks.session.processTurn.mockReset();
    mocks.session.processTurn.mockResolvedValue({
      summary: "session completed",
      sessionId: "session-1",
      toolCalls: [],
      streamed: false,
    });
    stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  });

  afterEach(() => {
    if (stdinDescriptor) Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
    if (stdoutDescriptor) Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
  });

  it("lazily creates an AgentSession for the first free-form task", async () => {
    await runLegacyChatTuiForCompat({});

    expect(mocks.createAgentSession).toHaveBeenCalledTimes(1);
    expect(mocks.createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      task: "hello from the TUI",
      sessionId: expect.any(String),
      sessionMode: "bypass",
      events: expect.objectContaining({
        onToken: expect.any(Function),
        onToolCall: expect.any(Function),
        onToolResult: expect.any(Function),
      }),
    }));
    expect(mocks.session.processTurn).toHaveBeenCalledTimes(1);
    expect(mocks.session.processTurn).toHaveBeenCalledWith("hello from the TUI");
  });
});
