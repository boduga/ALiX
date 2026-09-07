/**
 * LangfuseTraceClient adapter — SDK-mapping semantics (design §24.3).
 *
 * Uses a vi.mock('langfuse') fake — no network. Verifies:
 *   - one Langfuse trace per active runId (dup startRun never dup-creates)
 *   - getRun resolution (active → handle; unknown → null)
 *   - endRun finishes the trace and unregisters the run
 *   - unknown/ended runs produce noop spans; repeated endSpan/endRun no-op
 *   - captured (redacted + per-kind truncated) payloads reach the SDK
 *   - outcome → Langfuse level/statusMessage + metadata.alix.status translation
 *   - flush/shutdown delegate to the SDK; lifecycle never throws on SDK error
 *   - ALiX handles stay opaque (no SDK object/id escapes as a readable member)
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md
 * Task: Task 7 of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { TracingConfig } from "../../src/config/schema.js";
import { LangfuseTraceClient } from "../../src/tracing/langfuse-client.js";
import type {
  ModelSpanInput,
  RunOutcome,
  SpanOutcome,
  ToolSpanInput,
  TraceRun,
  TraceRunInput,
  TraceSpan,
} from "../../src/tracing/types.js";

// ---------------------------------------------------------------------------
// vi.mock('langfuse') fake — created via vi.hoisted so it exists before the
// adapter module is imported. Every `new Langfuse(...)` the adapter performs
// is recorded so tests can inspect the exact SDK calls.
// ---------------------------------------------------------------------------

interface FakeCalls {
  traces: Array<Record<string, unknown>>;
  traceUpdates: Array<{ id?: string; body: Record<string, unknown> }>;
  generations: Array<{ traceId?: string; body: Record<string, unknown> }>;
  generationEnds: Array<{ traceId?: string; body: Record<string, unknown> }>;
  spans: Array<{ traceId?: string; body: Record<string, unknown> }>;
  spanEnds: Array<{ traceId?: string; body: Record<string, unknown> }>;
}

interface FakeLangfuseInstance {
  options: Record<string, unknown>;
  calls: FakeCalls;
  flushCalls: number;
  shutdownCalls: number;
  failures: Set<string>;
  flushAsync: () => Promise<void>;
  shutdownAsync: () => Promise<void>;
}

const { FakeLangfuse, fakeRecorder } = vi.hoisted(() => {
  const recorder: { instances: FakeLangfuseInstance[] } = { instances: [] };

  class FakeLangfuse {
    options: Record<string, unknown>;
    calls: FakeCalls = {
      traces: [],
      traceUpdates: [],
      generations: [],
      generationEnds: [],
      spans: [],
      spanEnds: [],
    };
    flushCalls = 0;
    shutdownCalls = 0;
    failures: Set<string> = new Set();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      recorder.instances.push(this as unknown as FakeLangfuseInstance);
    }

    trace(body: Record<string, unknown>): FakeTrace {
      this.throwIf("trace");
      this.calls.traces.push(body);
      return new FakeTrace(this, body);
    }

    async flushAsync(): Promise<void> {
      this.flushCalls++;
    }

    async shutdownAsync(): Promise<void> {
      this.shutdownCalls++;
    }

    throwIf(key: string): void {
      if (this.failures.has(key)) {
        throw new Error(`fake langfuse failure: ${key}`);
      }
    }
  }

  class FakeTrace {
    readonly owner: FakeLangfuse;
    readonly body: Record<string, unknown>;

    constructor(owner: FakeLangfuse, body: Record<string, unknown>) {
      this.owner = owner;
      this.body = body;
    }

    update(body: Record<string, unknown>): FakeTrace {
      this.owner.throwIf("trace-update");
      this.owner.calls.traceUpdates.push({ id: this.body.id as string, body });
      return this;
    }

    generation(body: Record<string, unknown>): FakeGeneration {
      this.owner.throwIf("generation");
      const traceId = this.body.id as string;
      this.owner.calls.generations.push({ traceId, body });
      return new FakeGeneration(this.owner, traceId);
    }

    span(body: Record<string, unknown>): FakeSpan {
      this.owner.throwIf("span");
      const traceId = this.body.id as string;
      this.owner.calls.spans.push({ traceId, body });
      return new FakeSpan(this.owner, traceId);
    }
  }

  class FakeGeneration {
    readonly owner: FakeLangfuse;
    readonly traceId: string;

    constructor(owner: FakeLangfuse, traceId: string) {
      this.owner = owner;
      this.traceId = traceId;
    }

    end(body: Record<string, unknown>): FakeGeneration {
      this.owner.throwIf("generation-end");
      this.owner.calls.generationEnds.push({ traceId: this.traceId, body });
      return this;
    }
  }

  class FakeSpan {
    readonly owner: FakeLangfuse;
    readonly traceId: string;

    constructor(owner: FakeLangfuse, traceId: string) {
      this.owner = owner;
      this.traceId = traceId;
    }

    end(body: Record<string, unknown>): FakeSpan {
      this.owner.throwIf("span-end");
      this.owner.calls.spanEnds.push({ traceId: this.traceId, body });
      return this;
    }
  }

  return { FakeLangfuse, fakeRecorder: recorder };
});

vi.mock("langfuse", () => ({ default: FakeLangfuse }));

function lastSdk(): FakeLangfuseInstance {
  const instance = fakeRecorder.instances.at(-1);
  if (!instance) throw new Error("no fake Langfuse constructed");
  return instance;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SK_PROJ_KEY = `sk-proj-${"A".repeat(40)}`;

function baseTracingConfig(): TracingConfig {
  return {
    enabled: true,
    langfuse: {
      baseUrl: "http://langfuse.test:3000",
      publicKey: "pk-lf-test-public",
      secretKey: "sk-lf-test-secret",
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

/** Partial override arms accepted by the config/test helpers below. */
type TracingOverrides = {
  capture?: Partial<TracingConfig["capture"]>;
  langfuse?: Partial<TracingConfig["langfuse"]>;
};

function makeConfig(overrides?: TracingOverrides): TracingConfig {
  const config = baseTracingConfig();
  if (overrides?.capture) config.capture = { ...config.capture, ...overrides.capture };
  if (overrides?.langfuse) config.langfuse = { ...config.langfuse, ...overrides.langfuse };
  return config;
}

function runInput(overrides: Partial<TraceRunInput> = {}): TraceRunInput {
  return {
    runId: "run-test1234",
    sessionId: "session-1",
    workflowId: "wf-1",
    actor: "coder",
    task: "Fix the integration test",
    startedAt: 1_000_000,
    ...overrides,
  };
}

function staleRunHandle(runId: string): TraceRun {
  return { runId } as unknown as TraceRun;
}

function makeClient(overrides?: TracingOverrides): {
  client: LangfuseTraceClient;
  sdk: FakeLangfuseInstance;
} {
  const client = new LangfuseTraceClient(makeConfig(overrides));
  return { client, sdk: lastSdk() };
}

// ---------------------------------------------------------------------------
// Run lifecycle + registry
// ---------------------------------------------------------------------------

describe("LangfuseTraceClient · run registry", () => {
  beforeEach(() => {
    fakeRecorder.instances.length = 0;
  });

  it("startRun creates exactly one trace and registers the run", () => {
    const { client, sdk } = makeClient();
    const run = client.startRun(runInput());

    expect(sdk.calls.traces).toHaveLength(1);
    expect(sdk.calls.traces[0].id).toBe("run-test1234");
    expect((sdk.calls.traces[0].metadata as { alix: Record<string, unknown> }).alix).toMatchObject({
      kind: "run",
      runId: "run-test1234",
      sessionId: "session-1",
      workflowId: "wf-1",
      actor: "coder",
    });
    expect(run.runId).toBe("run-test1234");
  });

  it("duplicate startRun for the same active runId returns the existing run and never dup-creates a trace", () => {
    const { client, sdk } = makeClient();
    const first = client.startRun(runInput());
    const second = client.startRun(runInput({ actor: "someone-else" }));

    expect(second).toBe(first);
    expect(sdk.calls.traces).toHaveLength(1);
  });

  it("getRun resolves an active run and returns null for unknown runs", () => {
    const { client } = makeClient();
    const run = client.startRun(runInput());

    expect(client.getRun("run-test1234")).toBe(run);
    expect(client.getRun("run-unknown")).toBeNull();
  });

  it("endRun finishes the trace, unregisters the run, and repeated endRun no-ops", () => {
    const { client, sdk } = makeClient();
    const run = client.startRun(runInput());
    client.endRun(run, { status: "success", endedAt: 2_000_000 });

    expect(client.getRun("run-test1234")).toBeNull();
    expect(sdk.calls.traceUpdates).toHaveLength(1);
    const update = sdk.calls.traceUpdates[0];
    expect(update.id).toBe("run-test1234");
    const alix = (update.body.metadata as { alix: Record<string, unknown> }).alix;
    expect(alix.status).toBe("success");
    expect(alix.durationMs).toBe(1_000_000);
    expect(alix.endedAtMs).toBe(2_000_000);

    // Second endRun on the same (now stale) handle is a no-op.
    client.endRun(run, { status: "error", error: "too late" });
    expect(sdk.calls.traceUpdates).toHaveLength(1);
  });

  it("endRun on an unknown handle is a no-op", () => {
    const { client, sdk } = makeClient();
    client.startRun(runInput());
    client.endRun(staleRunHandle("run-ghost"), { status: "success" });
    expect(sdk.calls.traceUpdates).toHaveLength(0);
  });

  it("startRun after endRun starts a fresh trace for a reused runId", () => {
    const { client, sdk } = makeClient();
    const run = client.startRun(runInput());
    client.endRun(run, { status: "success" });

    const again = client.startRun(runInput());
    expect(again).not.toBe(run);
    expect(sdk.calls.traces).toHaveLength(2);
  });

  it("run error outcome lands in metadata.alix", () => {
    const { client, sdk } = makeClient();
    const run = client.startRun(runInput());
    client.endRun(run, { status: "error", error: `boom ${SK_PROJ_KEY}` });

    const alix = (
      sdk.calls.traceUpdates[0].body.metadata as { alix: Record<string, unknown> }
    ).alix;
    expect(alix.status).toBe("error");
    expect(alix.error).toContain("<redacted>");
    expect(alix.error).not.toContain(SK_PROJ_KEY);
  });
});

// ---------------------------------------------------------------------------
// Span lifecycle + idempotency + unknown-run noops
// ---------------------------------------------------------------------------

describe("LangfuseTraceClient · spans", () => {
  beforeEach(() => {
    fakeRecorder.instances.length = 0;
  });

  function makeModelSpan(
    client: LangfuseTraceClient,
    run: TraceRun,
    overrides: Partial<ModelSpanInput> = {},
  ): TraceSpan {
    return client.startModelSpan(run, {
      provider: "anthropic",
      model: "claude-sonnet-4",
      invocationId: "inv-1",
      startedAt: 1_000_000,
      ...overrides,
    });
  }

  it("startModelSpan creates a generation child of the run's trace", () => {
    const { client, sdk } = makeClient();
    const run = client.startRun(runInput());
    const span = makeModelSpan(client, run);

    expect(span).toBeDefined();
    expect(sdk.calls.generations).toHaveLength(1);
    const gen = sdk.calls.generations[0];
    expect(gen.traceId).toBe("run-test1234");
    expect(gen.body).toMatchObject({
      name: "claude-sonnet-4",
      model: "claude-sonnet-4",
      startTime: new Date(1_000_000).toISOString(),
    });
    const alix = (gen.body.metadata as { alix: Record<string, unknown> }).alix;
    expect(alix).toMatchObject({ kind: "model", provider: "anthropic", invocationId: "inv-1" });
  });

  it("startToolSpan creates a span child of the run's trace", () => {
    const { client, sdk } = makeClient();
    const run = client.startRun(runInput());
    const span = client.startToolSpan(run, {
      toolName: "shell.run",
      toolCallId: "toolcall-1",
      startedAt: 1_000_000,
    });

    expect(span).toBeDefined();
    expect(sdk.calls.spans).toHaveLength(1);
    const sp = sdk.calls.spans[0];
    expect(sp.traceId).toBe("run-test1234");
    expect(sp.body.name).toBe("shell.run");
  });

  it("unknown or already-ended runs yield noop spans that never reach the SDK", () => {
    const { client, sdk } = makeClient();
    const run = client.startRun(runInput());

    // Never-registered run handle.
    const ghost = client.startModelSpan(staleRunHandle("run-ghost"), {
      provider: "anthropic",
      model: "claude-sonnet-4",
    });
    expect(sdk.calls.generations).toHaveLength(0);

    // Run ended before the span starts.
    client.endRun(run, { status: "success" });
    const after = makeModelSpan(client, run);
    expect(sdk.calls.generations).toHaveLength(0);
    expect(sdk.calls.spans).toHaveLength(0);

    // Noop spans are end-safe.
    expect(() => {
      client.endSpan(ghost, { status: "success" });
      client.endSpan(after, { status: "error", error: "x" });
    }).not.toThrow();
    expect(sdk.calls.generationEnds).toHaveLength(0);
  });

  it("repeated endSpan is a no-op after the first terminal end", () => {
    const { client, sdk } = makeClient();
    const run = client.startRun(runInput());
    const span = makeModelSpan(client, run);

    client.endSpan(span, { status: "success", output: "first" });
    client.endSpan(span, { status: "error", error: "second end is dropped" });

    expect(sdk.calls.generationEnds).toHaveLength(1);
  });

  it("spans created under a failed-run trace are end-safe noops", () => {
    const { client, sdk } = makeClient();
    // A stale handle from a foreign client.
    client.startRun(runInput());
    const span = client.startModelSpan(staleRunHandle("run-other"), {
      provider: "openai",
      model: "gpt-5",
    });
    client.endSpan(span, { status: "success" });
    expect(sdk.calls.generationEnds).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Capture: redaction + per-kind truncation before the SDK
// ---------------------------------------------------------------------------

describe("LangfuseTraceClient · capture integration", () => {
  beforeEach(() => {
    fakeRecorder.instances.length = 0;
  });

  it("redacts secrets inside captured model messages", () => {
    const { client, sdk } = makeClient();
    const run = client.startRun(runInput());
    client.startModelSpan(run, {
      provider: "anthropic",
      model: "claude-sonnet-4",
      messages: [
        { role: "user", content: `use key ${SK_PROJ_KEY} to proceed` },
        { role: "assistant", content: "ok" },
      ],
    });

    const input = sdk.calls.generations[0].body.input as Array<{
      role: string;
      content: string;
    }>;
    expect(input[0].content).toContain("<redacted>");
    expect(input[0].content).not.toContain(SK_PROJ_KEY);
    expect(input[1].content).toBe("ok");
  });

  it("applies the per-kind message char limit from config", () => {
    const { client, sdk } = makeClient({ capture: { messages: "truncated", maxMessageChars: 123 } });
    const run = client.startRun(runInput());
    client.startModelSpan(run, {
      provider: "anthropic",
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "x".repeat(1000) }],
    });

    const input = sdk.calls.generations[0].body.input as Array<{ content: string }>;
    expect(input[0].content).toHaveLength(123);
  });

  it("omits messages input entirely when messages capture is off", () => {
    const { client, sdk } = makeClient({ capture: { messages: "off" } });
    const run = client.startRun(runInput());
    client.startModelSpan(run, {
      provider: "anthropic",
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "should not appear" }],
    });

    expect("input" in sdk.calls.generations[0].body).toBe(false);
  });

  it("redacts tool args and omits them when toolInput capture is off", () => {
    const { client, sdk } = makeClient();
    const run = client.startRun(runInput());
    client.startToolSpan(run, {
      toolName: "shell.run",
      args: { apiKey: SK_PROJ_KEY, path: "/tmp" },
    });

    const input = sdk.calls.spans[0].body.input as Record<string, unknown>;
    expect(input.path).toBe("/tmp");
    expect(input.apiKey).toBe("<redacted>");

    // toolInput off → args omitted entirely.
    const offClient = makeClient({ capture: { toolInput: "off" } }).client;
    const offRun = offClient.startRun(runInput());
    offClient.startToolSpan(offRun, { toolName: "shell.run", args: { apiKey: SK_PROJ_KEY } });
    const offSdk = lastSdk();
    expect("input" in offSdk.calls.spans[0].body).toBe(false);
  });

  it("truncates model output text and tool output text per their kind limits", () => {
    // Model output uses the messages char budget (no dedicated model-output mode).
    const { client, sdk } = makeClient({ capture: { messages: "truncated", maxMessageChars: 100 } });
    const run = client.startRun(runInput());
    const modelSpan = client.startModelSpan(run, {
      provider: "anthropic",
      model: "claude-sonnet-4",
    });
    client.endSpan(modelSpan, { status: "success", output: "y".repeat(500) });
    expect((sdk.calls.generationEnds[0].body.output as string).length).toBe(100);

    // Tool output uses the tool char limit.
    const { client: toolClient, sdk: toolSdk } = makeClient({
      capture: { toolOutput: "truncated", maxToolOutputChars: 50 },
    });
    const toolRun = toolClient.startRun(runInput());
    const toolSpan = toolClient.startToolSpan(toolRun, { toolName: "shell.run" });
    toolClient.endSpan(toolSpan, { status: "success", output: "z".repeat(500) });
    expect((toolSdk.calls.spanEnds[0].body.output as string).length).toBe(50);
  });

  it("keeps full-length redacted output when messages capture is full", () => {
    const { client, sdk } = makeClient({ capture: { messages: "full" } });
    const run = client.startRun(runInput());
    const span = client.startModelSpan(run, {
      provider: "anthropic",
      model: "claude-sonnet-4",
    });
    client.endSpan(span, { status: "success", output: `${SK_PROJ_KEY} ${"x".repeat(500)}` });

    const output = sdk.calls.generationEnds[0].body.output as string;
    expect(output).toHaveLength("<redacted>".length + 1 + 500);
    expect(output).not.toContain(SK_PROJ_KEY);
  });

  it("captures reasoning only when the reasoning level is not off", () => {
    const { client, sdk } = makeClient(); // reasoning defaults to "off"
    const run = client.startRun(runInput());
    const span = client.startModelSpan(run, { provider: "anthropic", model: "claude-sonnet-4" });
    client.endSpan(span, { status: "success", reasoning: "private chain of thought" });

    const alix = (
      sdk.calls.generationEnds[0].body.metadata as { alix: Record<string, unknown> }
    ).alix;
    expect("reasoning" in alix).toBe(false);

    const { client: onClient, sdk: onSdk } = makeClient({ capture: { reasoning: "truncated" } });
    const onRun = onClient.startRun(runInput());
    const onSpan = onClient.startModelSpan(onRun, {
      provider: "anthropic",
      model: "claude-sonnet-4",
    });
    onClient.endSpan(onSpan, {
      status: "success",
      reasoning: `chain ${SK_PROJ_KEY} of thought`,
    });
    const onAlix = (
      onSdk.calls.generationEnds[0].body.metadata as { alix: Record<string, unknown> }
    ).alix;
    expect(onAlix.reasoning).toContain("<redacted>");
  });
});

// ---------------------------------------------------------------------------
// Outcome → Langfuse semantics
// ---------------------------------------------------------------------------

describe("LangfuseTraceClient · outcome translation", () => {
  beforeEach(() => {
    fakeRecorder.instances.length = 0;
  });

  it("maps an errored model span to level ERROR with statusMessage + alix.status", () => {
    const { client, sdk } = makeClient();
    const run = client.startRun(runInput());
    const span = client.startModelSpan(run, { provider: "anthropic", model: "claude-sonnet-4" });
    client.endSpan(span, {
      status: "error",
      error: `rate limited ${SK_PROJ_KEY}`,
      inputTokens: 10,
      outputTokens: 5,
      finishReason: "error",
    });

    const end = sdk.calls.generationEnds[0].body;
    expect(end.level).toBe("ERROR");
    expect(end.statusMessage).toContain("<redacted>");
    expect(end.statusMessage).not.toContain(SK_PROJ_KEY);
    expect(end.usage).toEqual({ input: 10, output: 5, unit: "TOKENS" });
    const alix = (end.metadata as { alix: Record<string, unknown> }).alix;
    expect(alix.status).toBe("error");
    expect(alix.finishReason).toBe("error");
  });

  it("maps success and cancelled to DEFAULT level while preserving the ALiX status", () => {
    const { client, sdk } = makeClient();
    const run = client.startRun(runInput());
    const ok = client.startModelSpan(run, { provider: "anthropic", model: "claude-sonnet-4" });
    client.endSpan(ok, { status: "success", output: "done" });
    const cancelled = client.startToolSpan(run, { toolName: "shell.run" });
    client.endSpan(cancelled, { status: "cancelled" });

    expect(sdk.calls.generationEnds[0].body.level).toBe("DEFAULT");
    expect(
      (sdk.calls.generationEnds[0].body.metadata as { alix: Record<string, unknown> }).alix.status,
    ).toBe("success");

    const end = sdk.calls.spanEnds[0].body;
    expect(end.level).toBe("DEFAULT");
    expect("statusMessage" in end).toBe(false);
    expect((end.metadata as { alix: Record<string, unknown> }).alix.status).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// Transport + fail-open
// ---------------------------------------------------------------------------

describe("LangfuseTraceClient · flush/shutdown and never-throw", () => {
  beforeEach(() => {
    fakeRecorder.instances.length = 0;
  });

  it("flush and shutdown delegate to the SDK", async () => {
    const { client, sdk } = makeClient();
    await client.flush();
    await client.flush();
    await client.shutdown();
    await client.shutdown();

    expect(sdk.flushCalls).toBe(2);
    expect(sdk.shutdownCalls).toBe(1);
  });

  it("flush/shutdown resolve even when the SDK rejects", async () => {
    const { client, sdk } = makeClient();
    sdk.flushAsync = async () => {
      throw new Error("flush transport down");
    };
    sdk.shutdownAsync = async () => {
      throw new Error("shutdown transport down");
    };

    await expect(client.flush()).resolves.toBeUndefined();
    await expect(client.shutdown()).resolves.toBeUndefined();
  });

  it("lifecycle never throws when the SDK throws", () => {
    const { client, sdk } = makeClient();

    // Trace creation fails → run still registers; spans become noops.
    sdk.failures.add("trace");
    let run: TraceRun;
    expect(() => {
      run = client.startRun(runInput());
    }).not.toThrow();
    const ghostSpan = client.startModelSpan(run!, {
      provider: "anthropic",
      model: "claude-sonnet-4",
    });
    client.endSpan(ghostSpan, { status: "success" });
    expect(() => client.endRun(run!, { status: "success" })).not.toThrow();

    // Span creation / span-end failures never propagate.
    sdk.failures.delete("trace");
    sdk.failures.add("generation");
    const run2 = client.startRun(runInput({ runId: "run-abc1234" }));
    let noopSpan: TraceSpan;
    expect(() => {
      noopSpan = client.startModelSpan(run2, { provider: "openai", model: "gpt-5" });
    }).not.toThrow();
    client.endSpan(noopSpan!, { status: "success" });

    sdk.failures.delete("generation");
    sdk.failures.add("generation-end");
    const realSpan = client.startModelSpan(run2, { provider: "openai", model: "gpt-5" });
    expect(() => client.endSpan(realSpan, { status: "success", output: "x" })).not.toThrow();

    sdk.failures.add("trace-update");
    expect(() => client.endRun(run2, { status: "success" })).not.toThrow();
    expect(() => client.endRun(run2, { status: "error" })).not.toThrow();
  });

  it("keeps ALiX handles opaque — no SDK id/object is a readable handle member", () => {
    const { client } = makeClient();
    const run = client.startRun(runInput());
    const span = client.startModelSpan(run, { provider: "anthropic", model: "claude-sonnet-4" });

    expect(Object.keys(run)).toEqual(["runId"]);
    expect(Object.keys(span)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Parent-run translation (design §23, Task 8)
// ---------------------------------------------------------------------------

describe("LangfuseTraceClient · parent-run translation", () => {
  beforeEach(() => {
    fakeRecorder.instances.length = 0;
  });

  /** Child run input that names a parent but carries no session of its own. */
  function childRunInput(parentRunId: string, overrides: Partial<TraceRunInput> = {}): TraceRunInput {
    return runInput({
      runId: "run-child001",
      sessionId: undefined,
      task: "child delegated task",
      ...overrides,
      parentRunId,
    });
  }

  function alixOf(trace: Record<string, unknown>): Record<string, unknown> {
    return (trace.metadata as { alix: Record<string, unknown> }).alix;
  }

  it("links an in-process child (no own session) into the active parent's session and keeps one trace per runId", () => {
    const { client, sdk } = makeClient();
    const parent = client.startRun(runInput()); // session-1

    const child = client.startRun(childRunInput("run-test1234"));

    // Exactly two traces, one per ALiX runId — no invented second identity.
    expect(sdk.calls.traces).toHaveLength(2);
    expect(sdk.calls.traces.map((t) => t.id)).toEqual(["run-test1234", "run-child001"]);
    expect(child.runId).toBe("run-child001");

    // The child trace is grouped into the parent's Langfuse session (Langfuse's
    // cross-trace relationship container) while keeping its own trace id.
    const childTrace = sdk.calls.traces[1];
    expect(childTrace.id).toBe("run-child001");
    expect(childTrace.sessionId).toBe("session-1");
    expect(alixOf(childTrace)).toMatchObject({
      kind: "run",
      runId: "run-child001",
      sessionId: "session-1",
      parentRunId: "run-test1234",
    });
    // The parent trace keeps its own session and no parentRunId.
    expect(sdk.calls.traces[0].sessionId).toBe("session-1");
    expect(alixOf(sdk.calls.traces[0])).not.toHaveProperty("parentRunId");

    // The child's model/tool spans stay under the CHILD trace.
    const span = client.startModelSpan(child, { provider: "anthropic", model: "claude-sonnet-4" });
    client.endSpan(span, { status: "success", output: "child done" });
    expect(sdk.calls.generations).toHaveLength(1);
    expect(sdk.calls.generations[0].traceId).toBe("run-child001");
    expect(sdk.calls.generationEnds[0].traceId).toBe("run-child001");

    // Both runs resolve independently; lifecycle is clean.
    expect(client.getRun("run-test1234")).toBe(parent);
    expect(client.getRun("run-child001")).toBe(child);
  });

  it("keeps an explicit child session authoritative over parent-session grouping", () => {
    const { client, sdk } = makeClient();
    client.startRun(runInput()); // parent session-1

    const child = client.startRun(
      runInput({
        runId: "run-child002",
        sessionId: "session-child-9",
        parentRunId: "run-test1234",
      }),
    );
    expect(sdk.calls.traces).toHaveLength(2);
    const childTrace = sdk.calls.traces[1];
    expect(childTrace.sessionId).toBe("session-child-9");
    expect(alixOf(childTrace).parentRunId).toBe("run-test1234");
    expect(client.getRun("run-child002")).toBe(child);
  });

  it("degrades to a standalone child trace for an unknown parent — no throw, parentRunId still recorded", () => {
    const { client, sdk } = makeClient();

    const child = client.startRun(childRunInput("run-ghost"));
    expect(sdk.calls.traces).toHaveLength(1);
    const childTrace = sdk.calls.traces[0];
    expect(childTrace.id).toBe("run-child001");
    // No active parent → no session inheritance; trace is standalone.
    expect("sessionId" in childTrace).toBe(false);
    expect(alixOf(childTrace)).toMatchObject({
      runId: "run-child001",
      parentRunId: "run-ghost",
    });
    expect("sessionId" in alixOf(childTrace)).toBe(false);

    // The standalone child still traces its own spans.
    const span = client.startModelSpan(child, { provider: "anthropic", model: "claude-sonnet-4" });
    client.endSpan(span, { status: "success" });
    expect(sdk.calls.generations).toHaveLength(1);
    expect(sdk.calls.generations[0].traceId).toBe("run-child001");
  });

  it("degrades to a standalone child trace when the parent already ended — no throw", () => {
    const { client, sdk } = makeClient();
    const parent = client.startRun(runInput());
    client.endRun(parent, { status: "success" });

    const child = client.startRun(childRunInput("run-test1234"));
    expect(sdk.calls.traces).toHaveLength(2);
    const childTrace = sdk.calls.traces[1];
    expect(childTrace.id).toBe("run-child001");
    expect("sessionId" in childTrace).toBe(false);
    expect(alixOf(childTrace).parentRunId).toBe("run-test1234");
  });

  it("lifecycle stays safe when the child startRun names an active parent whose own trace creation failed", () => {
    const { client, sdk } = makeClient();
    sdk.failures.add("trace");
    client.startRun(runInput({ runId: "run-parent-fail", sessionId: "session-p" }));
    sdk.failures.delete("trace");

    // Parent registered (active) even though its trace never reached the SDK.
    expect(client.getRun("run-parent-fail")).not.toBeNull();
    const child = client.startRun(
      childRunInput("run-parent-fail", { runId: "run-child003" }),
    );
    // Child still starts standalone-safe: no throw, no duplicate trace bodies.
    expect(sdk.calls.traces).toHaveLength(1);
    expect(child.runId).toBe("run-child003");
    expect(() => client.endRun(child, { status: "success" })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Construction validation (fail-open hook for the Task 9 factory)
// ---------------------------------------------------------------------------

describe("LangfuseTraceClient · construction", () => {
  it("constructs with the SDK receiving explicit store-resolved keys", () => {
    const { sdk } = makeClient();
    expect(sdk.options).toMatchObject({
      baseUrl: "http://langfuse.test:3000",
      publicKey: "pk-lf-test-public",
      secretKey: "sk-lf-test-secret",
    });
  });

  it("throws on genuinely invalid config so the factory can degrade to Noop", () => {
    const disabled = makeConfig();
    disabled.enabled = false;
    expect(() => new LangfuseTraceClient(disabled)).toThrow();
    expect(() =>
      new LangfuseTraceClient(makeConfig({ langfuse: { baseUrl: "" } })),
    ).toThrow();
    expect(() =>
      new LangfuseTraceClient(makeConfig({ langfuse: { baseUrl: "not a url" } })),
    ).toThrow();
    expect(() =>
      new LangfuseTraceClient(makeConfig({ langfuse: { baseUrl: "ftp://x" } })),
    ).toThrow();
    expect(() =>
      new LangfuseTraceClient(makeConfig({ langfuse: { publicKey: "" } })),
    ).toThrow();
    expect(() =>
      new LangfuseTraceClient(
        makeConfig({ langfuse: { publicKey: "cred://langfuse/publicKey" } }),
      ),
    ).toThrow();
  });
});
