/**
 * shutdownProcessTraceClient — the daemon SIGTERM fail-open shutdown seam
 * (Task 14 wiring, extracted for testability in Task 15).
 *
 * Verifies the helper's contract at the daemon surface:
 *   - it shuts down the process TraceClient exactly once (the SAME memoized
 *     client the run roots created via getProcessTraceClient),
 *   - a shutdown rejection never propagates (the SIGTERM handler follows with
 *     process.exit(0) unconditionally),
 *   - a getProcessTraceClient failure (e.g. broken module graph) never
 *     propagates either.
 *
 * Boundedness itself is the adapter's contract (tests/tracing/
 * langfuse-client.vitest.ts); here we pin the surface wiring to prove tracing
 * can never block or fail daemon exit.
 *
 * Task: Task 15 of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */
import { describe, it, expect, vi } from "vitest";
import type { TraceClient } from "../../src/tracing/client.js";

vi.mock("../../src/tracing/client-factory.js", () => ({
  getProcessTraceClient: vi.fn(),
}));

import { getProcessTraceClient } from "../../src/tracing/client-factory.js";
import { shutdownProcessTraceClient } from "../../src/daemon/daemon-tracing-shutdown.js";

const getProcessTraceClientMock = getProcessTraceClient as ReturnType<typeof vi.fn>;

function fakeClient(shutdownImpl?: () => Promise<void>) {
  const shutdown = vi.fn(shutdownImpl ?? (async () => {}));
  return { client: { shutdown } as unknown as TraceClient, shutdown };
}

describe("daemon SIGTERM · shutdownProcessTraceClient (Task 15)", () => {
  it("shuts the process TraceClient down exactly once", async () => {
    const { client, shutdown } = fakeClient();
    getProcessTraceClientMock.mockResolvedValue(client);

    await shutdownProcessTraceClient();

    expect(getProcessTraceClientMock).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("resolves when the client's shutdown rejects (fail-open — daemon still exits 0)", async () => {
    const { client, shutdown } = fakeClient(async () => {
      throw new Error("shutdown transport down");
    });
    getProcessTraceClientMock.mockResolvedValue(client);

    await expect(shutdownProcessTraceClient()).resolves.toBeUndefined();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("resolves when getProcessTraceClient itself fails (broken module graph)", async () => {
    getProcessTraceClientMock.mockRejectedValue(new Error("module graph down"));

    await expect(shutdownProcessTraceClient()).resolves.toBeUndefined();
  });
});