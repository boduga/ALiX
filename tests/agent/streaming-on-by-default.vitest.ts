import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession } from "../../src/agent/session.js";
import { MockProvider } from "../../src/providers/mock-provider.js";

const mocks = vi.hoisted(() => ({
  createProvider: vi.fn(),
  shouldAutoDisableStreaming: vi.fn(),
}));

vi.mock("../../src/providers/registry.js", () => ({
  createProvider: mocks.createProvider,
}));

// This test asserts the loader default (streaming ON with no ALIX_STREAMING
// forcing), so it must run as if in a local/TTY context. The CI autodisable
// gate (shouldAutoDisableStreaming = isCI) is a separate, orthogonal concern
// covered by tests/agent/stream.test.ts — pin it off here, or the test can
// never pass under CI=true.
vi.mock("../../src/agent/stream.js", () => ({
  shouldAutoDisableStreaming: mocks.shouldAutoDisableStreaming,
  isCI: mocks.shouldAutoDisableStreaming,
}));

/**
 * Regression test for the "still not streaming" bug: `loadConfig` did not
 * default `model.streaming` to true, so `runTaskLoop` treated it as
 * `?? false` and every surface (in-process TUI included) used the blocking
 * complete path. With the loader default fixed, a real session streams by
 * default — `events.onToken` fires — with NO ALIX_STREAMING/env forcing.
 */
describe("streaming is on by default (real session)", () => {
  let cwd: string;
  let cleanup: () => void;
  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), "streaming-default-"));
    mkdirSync(join(cwd, ".alix"), { recursive: true });
    writeFileSync(
      join(cwd, ".alix", "config.json"),
      JSON.stringify({
        model: { provider: "mock", name: "mock" },
        mcpServers: [],
      })
    );
    cleanup = () => rmSync(cwd, { recursive: true, force: true });
  });
  afterAll(() => cleanup());
  beforeEach(() => {
    delete process.env.ALIX_STREAMING;
    mocks.createProvider.mockReset();
    mocks.createProvider.mockResolvedValue(new MockProvider());
    mocks.shouldAutoDisableStreaming.mockReset();
    mocks.shouldAutoDisableStreaming.mockReturnValue(false);
  });

  it("fires events.onToken during processTurn without env forcing", { timeout: 30_000 }, async () => {
    const tokens: string[] = [];
    const session = createAgentSession({
      cwd,
      task: "",
      events: {
        onToken: (t: string) => tokens.push(t),
        onToolCall: () => {},
        onToolResult: () => {},
      },
    });
    const res = await session.processTurn("make a plan");
    // Streaming path must have been used: onToken received the streamed text.
    expect(tokens.join("")).toContain("Plan:");
    // And the summary carries the model's response.
    expect(res.summary).toContain("Plan:");
  });
});
