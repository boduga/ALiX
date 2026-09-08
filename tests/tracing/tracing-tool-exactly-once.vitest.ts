/**
 * Task 18 — tool exactly-once at the fake-SDK surface (design §21 tool spans,
 * §24.8 exactly-once tool span).
 *
 * The most likely tool-span duplication regressions are a tool that opens two
 * spans, double-closes, or mints a SECOND span for the terminal (throw /
 * timeout / cancellation). This file locks the invariant at the REAL SDK
 * surface, driving the REAL production seam (ToolExecutor.execute → real
 * LangfuseTraceClient → vi.mock('langfuse') fake SDK):
 *
 *     one physical tool execution  →  exactly one span  →  exactly one terminal
 *     spanEnd  (success / throw / timeout / cancellation), no orphan.
 *
 * Four tool-outcome paths are exercised, each with a REAL dispatched tool:
 *   - success    → real file.read (real file content captured on the span)
 *   - throw      → real file.create under an existing FILE parent (mkdir throws
 *                  EEXIST out of the real router — a genuine dispatched throw,
 *                  not an injected one)
 *   - timeout    → real shell.run ("sleep 5" + timeoutMs → SideEffectTimeoutError
 *                  → error RESULT, not a throw; child killed after the budget)
 *   - cancelled  → a genuine ExecutionCancelledError (produced by a REAL
 *                  CancellationToken.cancel() + throwIfCancelled()) surfacing
 *                  out of dispatch — the cancellation analog of the throw path
 *
 * Every path additionally re-runs the SAME tool call WITHOUT runId on the same
 * executor and asserts the caller-visible result/error is byte-identical —
 * tracing must never alter the underlying tool outcome.
 *
 * Double-close observability: the adapter guards repeated endSpan calls
 * (langfuse-client.ts endSpan no-ops after the first terminal end), which the
 * T7 adapter tests already pin (langfuse-client.vitest.ts: repeated endSpan is
 * a no-op after the first terminal end — NOT duplicated here). To surface a
 * hypothetical double-end at this seam anyway, the shared fake counts every
 * SDK-level span.end() invocation UNGUARDED via `rawEndCalls.span`; each
 * scenario asserts it stays 1.
 *
 * Layers — mirrors tests/tracing/tracing-e2e-wiring.vitest.ts (Task 16) but for
 * the tool-execution path specifically, with the lighter Task 12 harness (no
 * runTaskLoop): a real ToolExecutor + real EventLog + real ToolExecutor roots,
 * a real startRun per scenario, and the real memoized adapter shared across
 * scenarios (beforeAll). Scenario assertions are per-scenario deltas after a
 * beforeEach reset of the SDK call log (resetFakeCalls).
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md (§21, §24.8)
 * Task: Task 18 of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FakeLangfuse, fakeRecorder, resetFakeCalls, type FakeLangfuseInstance } from "./fakes/langfuse-sdk.js";
import { EventLog } from "../../src/events/event-log.js";
import { ToolExecutor } from "../../src/tools/executor.js";
import { createTraceClient } from "../../src/tracing/client-factory.js";
import type { TraceClient } from "../../src/tracing/client.js";
import type { AlixConfig } from "../../src/config/schema.js";
import {
  CancellationToken,
  ExecutionCancelledError,
  isCancellationError,
} from "../../src/runtime/cancellation-token.js";

vi.mock("langfuse", () => ({ default: FakeLangfuse }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUN_ID = "run-t18";

function makeConfig(): AlixConfig {
  return {
    version: 1,
    model: { provider: "mock", name: "test-model" },
    permissions: {
      default: "allow",
      tools: {},
      protectedPaths: [],
      allowNetworkDomains: [],
      denyCommands: [],
    },
    context: {
      repoMap: false,
      repoMapMode: "lite",
      maxRepoMapTokens: 1000,
      semanticSearch: false,
      includeGitStatus: false,
      pinnedFiles: [],
    },
    runtime: {
      provider: "process",
      shell: "/bin/sh",
      commandTimeoutMs: 30000,
      envAllowlist: [],
    },
    ui: { enabled: false, host: "localhost", port: 3000, transport: "sse" as const },
  } as unknown as AlixConfig;
}

function tracingConfig(): AlixConfig["tracing"] {
  return {
    enabled: true,
    langfuse: {
      baseUrl: "http://langfuse.test:3000",
      publicKey: "pk-lf-t18-public",
      secretKey: "sk-lf-t18-secret",
    },
    capture: {
      messages: "truncated",
      reasoning: "off",
      toolInput: "truncated",
      toolOutput: "truncated",
      maxMessageChars: 4000,
      maxToolOutputChars: 2000,
    },
    flushTimeoutMs: 2000,
  };
}

function toolCallReq(overrides?: Partial<{
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  executionId: string;
  invocationId: string;
  runId: string;
}>): {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  executionId: string;
  invocationId: string;
  runId: string;
} {
  return {
    toolCallId: "tool_t18",
    name: "file.read",
    args: { path: "hello.txt" },
    executionId: "exec-t18",
    invocationId: "inv-t18",
    runId: RUN_ID,
    ...overrides,
  };
}

/** The same tool call with runId removed — the no-tracing control run. */
function untraced(req: ReturnType<typeof toolCallReq>): ReturnType<typeof toolCallReq> {
  const copy = { ...req };
  delete (copy as { runId?: string }).runId;
  return copy;
}

function alix(record: { body: Record<string, unknown> }): Record<string, unknown> {
  const meta = record.body.metadata as { alix: Record<string, unknown> };
  return meta.alix;
}

/**
 * Minimal EventLog-shaped stub with a deliberate append failure so a throw (or
 * cancellation) can be forced deterministically out of dispatch — the executor
 * awaits log.append for tool.requested BEFORE any router work (the same lighter
 * seam tests/tools/tool-span-wiring.vitest.ts uses).
 */
function failLog(append: (event: { type: string }) => void): EventLog {
  return {
    sessionDir: join(tmpdir(), "sessions", "t18-fail"),
    append: async (event: { type: string }) => {
      append(event);
    },
    readAll: async () => [],
  } as unknown as EventLog;
}

interface Harness {
  dir: string;
  executor: ToolExecutor;
}

async function makeHarness(opts?: { log?: EventLog }): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "t18-"));
  cleanup.push(dir);
  const sessionDir = join(dir, ".alix", "sessions", "t18-session");
  await mkdir(sessionDir, { recursive: true });
  let log: EventLog;
  if (opts?.log) {
    log = opts.log;
  } else {
    log = new EventLog(sessionDir);
    await log.init();
  }
  const executor = new ToolExecutor(makeConfig(), log, dir);
  return { dir, executor };
}

const cleanup: string[] = [];

// ---------------------------------------------------------------------------
// Shared real adapter. The factory memoizes the first enabled client per
// process (per vitest fork), so ONE real LangfuseTraceClient is created and
// shared across all scenarios; each scenario registers its own run via
// startRun and asserts counts as deltas (resetFakeCalls in beforeEach), proving
// no cross-scenario leak.
// ---------------------------------------------------------------------------

let client: TraceClient;
let sdk: FakeLangfuseInstance;

beforeAll(async () => {
  client = await createTraceClient(tracingConfig());
  sdk = fakeRecorder.instances[0];
});

beforeEach(() => {
  resetFakeCalls(sdk);
});

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

afterAll(async () => {
  await client.shutdown();
});

describe("T18 tool exactly-once at the fake SDK surface", () => {
  it("success — real file.read → exactly ONE terminal success span; untraced result identical", async () => {
    const runId = "t18-success";
    const run = client.startRun({
      runId,
      sessionId: "t18-s",
      task: "tool exactly-once success",
      actor: "agent",
      startedAt: Date.now(),
    });
    const h = await makeHarness();
    await writeFile(join(h.dir, "hello.txt"), "Hello, World!", "utf8");

    // Traced run + the no-tracing control run on the same executor.
    const req = toolCallReq({ runId });
    const traced = await h.executor.execute(req);
    const plain = await h.executor.execute(untraced(req));

    // The underlying tool result — identical with and without tracing.
    expect(plain.kind).toBe("success");
    expect((plain as { content?: string }).content).toBe("Hello, World!");
    expect(traced).toEqual(plain);

    // EXACTLY ONCE at the SDK surface: one span started, one terminal end, one
    // unguarded SDK end call.
    expect(sdk.calls.spans).toHaveLength(1);
    expect(sdk.calls.spanEnds).toHaveLength(1);
    expect(sdk.calls.spanEnds.length).toBe(sdk.calls.spans.length);
    expect(sdk.rawEndCalls.span).toBe(1);
    expect(sdk.calls.spans.filter((x) => x.traceId === runId)).toHaveLength(1);

    const span = sdk.calls.spans[0]!;
    expect(span.traceId).toBe(runId);
    expect(span.body.name).toBe("file.read");
    expect(span.body.input).toEqual({ path: "hello.txt" });
    const spanAlix = alix({ body: span.body });
    expect(spanAlix).toMatchObject({
      kind: "tool",
      toolName: "file.read",
      capability: "file.read",
      toolCallId: "tool_t18",
      invocationId: "inv-t18",
      executionId: "exec-t18",
    });

    const end = sdk.calls.spanEnds[0]!;
    const endAlix = alix({ body: end.body });
    expect(endAlix.status).toBe("success");
    // Success → DEFAULT level, tool output captured verbatim, no error.
    expect(end.body.level).toBe("DEFAULT");
    expect(end.body.output).toBe("Hello, World!");
    expect(end.body.statusMessage).toBeUndefined();
    expect(endAlix.error).toBeUndefined();
    // Ordering fold-in (T16 minor): endedAt >= startedAt on the same span.
    expect(endAlix.endedAtMs as number).toBeGreaterThanOrEqual(spanAlix.startedAtMs as number);
    expect(endAlix.durationMs as number).toBeGreaterThanOrEqual(0);

    await client.endRun(run, { status: "success", endedAt: Date.now() });
  });

  it("throw — real file.create under an existing file → exactly ONE terminal error span; original error rethrown unchanged", async () => {
    const runId = "t18-throw";
    const run = client.startRun({
      runId,
      sessionId: "t18-s",
      task: "tool exactly-once throw",
      actor: "agent",
      startedAt: Date.now(),
    });
    const h = await makeHarness();
    // `parent.txt` is a real FILE, so the real file.create router's recursive
    // mkdir(dirname) throws EEXIST — a genuine dispatched tool throw, no
    // injection (verified: FileToolRouter has no try/catch around mkdir).
    await writeFile(join(h.dir, "parent.txt"), "I am a file, not a directory.", "utf8");
    const req = toolCallReq({
      runId,
      name: "file.create",
      args: { path: "parent.txt/child.txt", content: "x" },
    });

    let tracedErr: unknown;
    try {
      await h.executor.execute(req);
    } catch (e) {
      tracedErr = e;
    }
    expect(tracedErr).toBeDefined();

    // The no-tracing control run rethrows the SAME underlying error.
    let plainErr: unknown;
    try {
      await h.executor.execute(untraced(req));
    } catch (e) {
      plainErr = e;
    }
    expect(tracedErr).toBeInstanceOf(Error);
    expect(plainErr).toBeInstanceOf(Error);
    expect((tracedErr as Error).message).toBe((plainErr as Error).message);
    // And it is the real filesystem error from the real router.
    expect((tracedErr as Error).message).toMatch(/file already exists|ENOTDIR|EEXIST/);

    // EXACTLY ONCE — one error span closed exactly once, rethrown unchanged.
    expect(sdk.calls.spans).toHaveLength(1);
    expect(sdk.calls.spanEnds).toHaveLength(1);
    expect(sdk.calls.spanEnds.length).toBe(sdk.calls.spans.length);
    expect(sdk.rawEndCalls.span).toBe(1);
    expect(sdk.calls.spans.filter((x) => x.traceId === runId)).toHaveLength(1);

    const span = sdk.calls.spans[0]!;
    expect(span.body.name).toBe("file.create");
    expect(span.body.input).toEqual({ path: "parent.txt/child.txt", content: "x" });

    const end = sdk.calls.spanEnds[0]!;
    const endAlix = alix({ body: end.body });
    expect(endAlix.status).toBe("error");
    expect(end.body.level).toBe("ERROR");
    const msg = (tracedErr as Error).message;
    expect(String(end.body.statusMessage)).toContain(msg.slice(0, 40));
    expect(String(endAlix.error)).toContain(msg.slice(0, 40));
    // Honest capture note: the error terminal carries no partial output.
    expect(end.body.output).toBeUndefined();
    expect(endAlix.endedAtMs as number).toBeGreaterThanOrEqual(alix({ body: span.body }).startedAtMs as number);

    await client.endRun(run, { status: "error", endedAt: Date.now() });
  });

  it("timeout — real shell.run (sleep 5, timeoutMs 150) → exactly ONE terminal error span; timeout is an error RESPONSE, not a throw", async () => {
    const runId = "t18-timeout";
    const run = client.startRun({
      runId,
      sessionId: "t18-s",
      task: "tool exactly-once timeout",
      actor: "agent",
      startedAt: Date.now(),
    });
    const h = await makeHarness();

    const req = toolCallReq({ runId, name: "shell.run", args: { command: "sleep 5", timeoutMs: 150 } });
    const traced = await h.executor.execute(req);
    const plain = await h.executor.execute(untraced(req));

    // The timeout is a caller-visible error RESULT (SideEffectTimeoutError →
    // kind:"error") — identical with and without tracing; the child was killed.
    expect(plain.kind).toBe("error");
    expect(String((plain as { message?: string }).message)).toMatch(/timed out after 150ms/);
    expect(traced).toEqual(plain);

    // EXACTLY ONE — the timeout maps to a single error span (executor
    // status mapping: timeouts → "error", never a second/neutral span).
    expect(sdk.calls.spans).toHaveLength(1);
    expect(sdk.calls.spanEnds).toHaveLength(1);
    expect(sdk.calls.spanEnds.length).toBe(sdk.calls.spans.length);
    expect(sdk.rawEndCalls.span).toBe(1);
    expect(sdk.calls.spans.filter((x) => x.traceId === runId)).toHaveLength(1);

    const span = sdk.calls.spans[0]!;
    expect(span.body.name).toBe("shell.run");
    expect(span.body.input).toEqual({ command: "sleep 5", timeoutMs: 150 });

    const end = sdk.calls.spanEnds[0]!;
    const endAlix = alix({ body: end.body });
    expect(endAlix.status).toBe("error");
    expect(end.body.level).toBe("ERROR");
    expect(String(end.body.statusMessage)).toContain("timed out after 150ms");
    expect(String(endAlix.error)).toContain("timed out after 150ms");
    expect(end.body.output).toBeUndefined();
    expect(endAlix.endedAtMs as number).toBeGreaterThanOrEqual(alix({ body: span.body }).startedAtMs as number);

    await client.endRun(run, { status: "error", endedAt: Date.now() });
  });

  it("cancel — a genuine CancellationToken ExecutionCancelledError out of dispatch → exactly ONE terminal cancelled span; original error rethrown unchanged", async () => {
    const runId = "t18-cancel";
    const run = client.startRun({
      runId,
      sessionId: "t18-s",
      task: "tool exactly-once cancellation",
      actor: "agent",
      startedAt: Date.now(),
    });

    // A REAL cancellation token produces the error (an operator cancel before
    // the awaited step completes): token.cancel() then throwIfCancelled() throw
    // the genuine ExecutionCancelledError the executor maps to "cancelled".
    const token = new CancellationToken();
    token.cancel("operator cancelled tool");

    const h = await makeHarness({
      log: failLog((event) => {
        if (event.type === "tool.requested") token.throwIfCancelled();
      }),
    });
    const req = toolCallReq({ runId });

    let tracedErr: unknown;
    try {
      await h.executor.execute(req);
    } catch (e) {
      tracedErr = e;
    }
    expect(tracedErr).toBeDefined();
    expect(tracedErr).toBeInstanceOf(ExecutionCancelledError);
    expect(isCancellationError(tracedErr)).toBe(true);
    expect((tracedErr as Error).message).toBe("Execution cancelled: operator cancelled tool");

    // The no-tracing control run surfaces the SAME genuine cancellation error.
    let plainErr: unknown;
    try {
      await h.executor.execute(untraced(req));
    } catch (e) {
      plainErr = e;
    }
    expect(plainErr).toBeInstanceOf(ExecutionCancelledError);
    expect((plainErr as Error).message).toBe((tracedErr as Error).message);

    // EXACTLY ONE — cancellation maps to a single terminal "cancelled" span.
    expect(sdk.calls.spans).toHaveLength(1);
    expect(sdk.calls.spanEnds).toHaveLength(1);
    expect(sdk.calls.spanEnds.length).toBe(sdk.calls.spans.length);
    expect(sdk.rawEndCalls.span).toBe(1);
    expect(sdk.calls.spans.filter((x) => x.traceId === runId)).toHaveLength(1);

    const span = sdk.calls.spans[0]!;
    expect(span.body.name).toBe("file.read");

    const end = sdk.calls.spanEnds[0]!;
    const endAlix = alix({ body: end.body });
    // Operator cancellation → alix.status "cancelled" (executor status mapping:
    // isCancellationError → cancelled). Langfuse has no cancelled level, so
    // level stays DEFAULT while statusMessage/alix.error carry the reason — the
    // same convention the model-span cancel terminal uses (Task 17).
    expect(endAlix.status).toBe("cancelled");
    expect(end.body.level).toBe("DEFAULT");
    expect(String(end.body.statusMessage)).toContain("Execution cancelled: operator cancelled tool");
    expect(String(endAlix.error)).toContain("Execution cancelled: operator cancelled tool");
    expect(end.body.output).toBeUndefined();
    expect(endAlix.endedAtMs as number).toBeGreaterThanOrEqual(alix({ body: span.body }).startedAtMs as number);

    await client.endRun(run, { status: "cancelled", endedAt: Date.now() });
  });
});