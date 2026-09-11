/**
 * `alix run` handler — Task 14 bounded-shutdown integration.
 *
 * Verifies that the run CLI composition root (src/cli/commands/run.ts) is the
 * entry mode's single "app closing down" choke point:
 *   - it shuts down the process TraceClient exactly once on BOTH the success
 *     path and the error path (the finally runs before any return settles),
 *   - a shutdown rejection never changes the CLI's exit code (fail-open at the
 *     surface, in addition to the adapter's own fail-open),
 *   - the interactive `--chat` REPL path shuts the client down when the REPL
 *     exits,
 *   - a usage error that never creates a client never calls shutdown.
 *
 * The agent session, config loader, and tracing factory are mocked; run.ts's
 * real parseRunArgs / EXIT_CODES behavior is exercised. Boundedness itself is
 * the adapter's contract (tests/tracing/langfuse-client.vitest.ts); here we pin
 * the surface wiring.
 *
 * Task: Task 14 of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { TraceClient } from "../../../src/tracing/client.js";

vi.mock("../../../src/agent/session.js", () => ({
  createAgentSession: vi.fn(),
}));
vi.mock("../../../src/agent/session-store-jsonl.js", () => ({
  JsonlSessionStore: class {
    constructor() {}
  },
}));
vi.mock("../../../src/config/loader.js", () => ({
  loadConfig: vi.fn(async () => ({ tracing: { enabled: true } })),
}));
vi.mock("../../../src/tracing/client-factory.js", () => ({
  createTraceClient: vi.fn(),
}));
vi.mock("../../../src/providers/base.js", () => ({
  ApiError: class extends Error {},
}));
vi.mock("../../../src/cli/renderers/repl.js", () => ({
  createReplEvents: () => ({ on: vi.fn(), emit: vi.fn() }),
  createReplRenderer: () => ({ start: vi.fn(async () => {}) }),
}));

import { handler } from "../../../src/cli/commands/run.js";
import { createAgentSession } from "../../../src/agent/session.js";
import { createTraceClient } from "../../../src/tracing/client-factory.js";

/** Recording TraceClient the factory mock resolves — only shutdown() is used. */
function fakeTraceClient(shutdownImpl?: () => Promise<void>) {
  const shutdown = vi.fn(shutdownImpl ?? (async () => {}));
  return { client: { shutdown } as unknown as TraceClient, shutdown };
}

function stubConsole() {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  return () => {
    error.mockRestore();
    log.mockRestore();
  };
}

const okTurn = {
  streamed: true,
  sessionId: undefined,
  toolCalls: [],
  reason: "completed",
};

describe("run handler · bounded shutdown at the composition root (Task 14)", () => {
  let restoreConsole: () => void;

  beforeEach(() => {
    restoreConsole = stubConsole();
    vi.clearAllMocks();
    (createAgentSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      processTurn: vi.fn(async () => okTurn),
      processChat: vi.fn(async () => okTurn),
    });
  });

  afterEach(() => {
    restoreConsole();
  });

  it("shuts the process TraceClient down exactly once after a successful run and returns 0", async () => {
    const { client, shutdown } = fakeTraceClient();
    (createTraceClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const code = await handler(["refactor the double lookup"]);

    expect(code).toBe(0);
    expect(createTraceClient).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("shuts the TraceClient down exactly once (in the finally) when the run throws and returns 1", async () => {
    const { client, shutdown } = fakeTraceClient();
    (createTraceClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    (
      createAgentSession as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValueOnce({
      processTurn: vi.fn(async () => {
        throw new Error("run boom");
      }),
    });

    const code = await handler(["task that blows up"]);

    expect(code).toBe(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("never lets a shutdown rejection change the CLI exit code (fail-open at the surface)", async () => {
    const { client, shutdown } = fakeTraceClient(async () => {
      throw new Error("shutdown boom");
    });
    (createTraceClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const code = await handler(["refactor the double lookup"]);

    expect(code).toBe(0);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("shuts the TraceClient down when the interactive --chat REPL exits", async () => {
    const { client, shutdown } = fakeTraceClient();
    (createTraceClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const code = await handler(["--chat"]);

    expect(code).toBe(0);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("never creates or shuts down a client on a usage error", async () => {
    const code = await handler([]);

    expect(code).toBe(1);
    expect(createTraceClient).not.toHaveBeenCalled();
  });
});