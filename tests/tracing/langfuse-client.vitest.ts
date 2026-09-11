/**
 * LangfuseTraceClient adapter — v5/OTel SDK-mapping semantics.
 *
 * Superset fake: mocks BOTH @langfuse/tracing AND @langfuse/otel for raw
 * control over observations, flush, and shutdown.
 *
 * Verifies:
 *   - one trace per active runId (dup startRun never dup-creates)
 *   - getRun resolution (active → handle; unknown → null)
 *   - endRun finishes the trace and unregisters the run
 *   - unknown/ended runs produce noop spans; repeated endSpan/endRun no-op
 *   - captured (redacted + per-kind truncated) payloads reach the SDK
 *   - outcome → Langfuse level/status + metadata.alix.status translation
 *   - flush/shutdown delegate to the processor; lifecycle never throws
 *   - ALiX handles stay opaque (no SDK object/id escapes as a readable member)
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { TracingConfig } from "../../src/config/schema.js";
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
// Superset fake — vi.mock for both @langfuse/tracing and @langfuse/otel
//
// vi.mock factories are hoisted before all non-hoisted declarations, so
// FakeProcessor (the mock class) must be defined via vi.hoisted to avoid TDZ.
// ---------------------------------------------------------------------------

const SK_PROJ_KEY = `sk-proj-${"A".repeat(40)}`;

// Observations are mutable so beforeEach can reset between scenarios.
const fakeObservations: FakeObs[] = [];
const fakePropagateCalls: Array<Record<string, unknown>> = [];
let fakeStartThrows: (() => boolean) | null = null;
let fakeNextId = 0;

function resetFakeState(): void {
  fakeObservations.length = 0;
  fakePropagateCalls.length = 0;
  fakeStartThrows = null;
  fakeNextId = 0;
}

function fakeId(): number {
  return fakeNextId++;
}

interface FakeObs {
  name: string;
  attrs: Record<string, unknown>;
  opts: {
    asType: "span" | "generation";
    startTime?: Date;
    parentSpanContext?: { traceId: string; spanId: string };
  };
  updateCalls: number;
  endCalls: number;
  ended: boolean;
  status: { code: number; message: string };
  otelSpan: {
    spanContext: () => { traceId: string; spanId: string };
    setStatus: (s: { code: number; message?: string }) => void;
  };
  update: (attrs: Record<string, unknown>) => void;
  end: (date?: Date) => void;
}

/**
 * Mirrors the real @langfuse/tracing createObservationAttributes: flattens the
 * ALiX-shaped attributes the adapter passes into the OTel span attribute names
 * the Langfuse export pipeline emits (langfuse.observation.*), serializing
 * object/array values. The observation `type` comes from options.asType.
 */
function serialize(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "<failed to serialize>";
  }
}

function observationAttributes(
  type: "span" | "generation",
  attrs: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { "langfuse.observation.type": type };
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === "metadata") {
      for (const [mk, mv] of Object.entries(value as Record<string, unknown>)) {
        const serialized = serialize(mv);
        if (serialized !== undefined) {
          out[`langfuse.observation.metadata.${mk}`] = serialized;
        }
      }
      continue;
    }
    const name =
      key === "level"
        ? "langfuse.observation.level"
        : key === "statusMessage"
          ? "langfuse.observation.status_message"
          : key === "input"
            ? "langfuse.observation.input"
            : key === "output"
              ? "langfuse.observation.output"
              : key === "model"
                ? "langfuse.observation.model.name"
                : key === "modelParameters"
                  ? "langfuse.observation.model.parameters"
                  : key === "usageDetails"
                    ? "langfuse.observation.usage_details"
                    : `langfuse.observation.${key}`;
    const serialized = serialize(value);
    if (serialized !== undefined) out[name] = serialized;
  }
  return out;
}

function fakeObs(
  name: string,
  attrs: Record<string, unknown>,
  opts: FakeObs["opts"],
): FakeObs {
  const id = fakeId();
  const spanId = `beef${String(id).padStart(4, "0")}`;
  const traceId =
    opts.parentSpanContext?.traceId ??
    `${"deadbeef".padEnd(16, String(id)).slice(0, 16)}00000000`;
  const obs: FakeObs = {
    name,
    attrs: observationAttributes(opts.asType, attrs),
    opts,
    updateCalls: 0,
    endCalls: 0,
    ended: false,
    status: { code: 1, message: "" },
    otelSpan: {
      spanContext: () => ({ traceId, spanId }),
      setStatus: (s: { code: number; message?: string }) => {
        obs.status = { code: s.code, message: s.message ?? "" };
      },
    },
    update: () => {},
    end: () => {},
  };
  obs.update = (a: Record<string, unknown>): void => {
    obs.updateCalls++;
    Object.assign(obs.attrs, observationAttributes(obs.opts.asType, a));
  };
  obs.end = (): void => {
    obs.endCalls++;
    obs.ended = true;
  };
  return obs;
}

vi.mock("@langfuse/tracing", () => ({
  startObservation(
    name: string,
    attrs: Record<string, unknown>,
    opts: { asType: "span" | "generation"; startTime?: Date; parentSpanContext?: unknown },
  ): FakeObs {
    if (fakeStartThrows?.()) {
      // Record the observation then throw — the run still registers and any
      // stored handle stays end-safe, exactly like a real SDK create failure.
      const obs = fakeObs(name, attrs, opts as FakeObs["opts"]);
      fakeObservations.push(obs);
      throw new Error("fake startObservation failure");
    }
    const obs = fakeObs(name, attrs, opts as FakeObs["opts"]);
    fakeObservations.push(obs);
    return obs;
  },
  propagateAttributes(
    params: Record<string, unknown>,
    fn: () => unknown,
  ): unknown {
    fakePropagateCalls.push({ ...params });
    const result = fn();
    // Merge propagated trace-level attributes onto the observation, mirroring
    // the real processor's onStart copying the parent context onto the span.
    if (result && typeof result === "object" && "attrs" in result) {
      const target = result as FakeObs;
      if (params.sessionId !== undefined) {
        target.attrs["session.id"] = params.sessionId as string;
      }
      if (params.traceName !== undefined) {
        target.attrs["langfuse.trace.name"] = params.traceName as string;
      }
    }
    return result;
  },
  setLangfuseTracerProvider: vi.fn(),
}));

// FakeProcessor must be defined via vi.hoisted so the vi.mock factory below
// can reference it — vi.mock is hoisted before non-hoisted class declarations.
const { FakeProcessor, fakeProcessorInstances } = vi.hoisted(() => {
  const instances: FakeProcessor[] = [];

  class FakeProcessor {
    options: Record<string, unknown>;
    flushCalls = 0;
    shutdownCalls = 0;
    flushHang: Promise<never> | null = null;
    flushReject: Error | null = null;
    shutdownReject: Error | null = null;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      instances.push(this);
    }

    async forceFlush(): Promise<void> {
      this.flushCalls++;
      if (this.flushHang) return this.flushHang;
      if (this.flushReject) throw this.flushReject;
    }

    async shutdown(): Promise<void> {
      this.shutdownCalls++;
      if (this.shutdownReject) throw this.shutdownReject;
    }
  }

  return { FakeProcessor, fakeProcessorInstances: instances };
});

vi.mock("@langfuse/otel", () => ({ LangfuseSpanProcessor: FakeProcessor }));

// The adapter is dynamically imported by createTraceClient on the enabled path.
// Static import here is fine: vi.mock is hoisted before module evaluation.
import { LangfuseTraceClient } from "../../src/tracing/langfuse-client.js";

function lastProcessor(): InstanceType<typeof FakeProcessor> {
  const p = fakeProcessorInstances.at(-1);
  if (!p) throw new Error("no fake processor constructed");
  return p;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

type TracingOverrides = {
  capture?: Partial<TracingConfig["capture"]>;
  langfuse?: Partial<TracingConfig["langfuse"]>;
  timeoutMs?: number;
};

function makeConfig(overrides?: TracingOverrides): TracingConfig {
  const config = baseTracingConfig();
  if (overrides?.capture) config.capture = { ...config.capture, ...overrides.capture };
  if (overrides?.langfuse) config.langfuse = { ...config.langfuse, ...overrides.langfuse };
  if (overrides?.timeoutMs !== undefined) config.flushTimeoutMs = overrides.timeoutMs;
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
  processor: InstanceType<typeof FakeProcessor>;
} {
  const client = new LangfuseTraceClient(makeConfig(overrides));
  return { client, processor: lastProcessor() };
}

function alixOfObs(obs: FakeObs): Record<string, unknown> {
  const raw = obs.attrs["langfuse.observation.metadata.alix"];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (raw as Record<string, unknown> | undefined) ?? {};
}

function attrOfObs(obs: FakeObs, key: string): unknown {
  const raw = obs.attrs[`langfuse.observation.${key}`];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function allObs(): FakeObs[] {
  return fakeObservations;
}

function rootObs(runId: string): FakeObs | undefined {
  return fakeObservations.find((o) => {
    const alix = alixOfObs(o);
    return alix.kind === "run" && alix.runId === runId && !o.opts.parentSpanContext;
  });
}

function childObsOf(runId: string): FakeObs[] {
  const root = rootObs(runId);
  if (!root) return [];
  const traceId = root.otelSpan.spanContext().traceId;
  return fakeObservations.filter((o) => o.otelSpan.spanContext().traceId === traceId);
}

// ---------------------------------------------------------------------------
// Run lifecycle + registry
// ---------------------------------------------------------------------------

describe("LangfuseTraceClient · run registry", () => {
  beforeEach(resetFakeState);

  it("startRun creates exactly one observation and registers the run", () => {
    const { client } = makeClient();
    const run = client.startRun(runInput());

    const obs = rootObs("run-test1234");
    expect(obs).toBeDefined();
    expect(obs!.name).toBe("Fix the integration test");
    const alix = alixOfObs(obs!);
    expect(alix).toMatchObject({
      kind: "run",
      runId: "run-test1234",
      sessionId: "session-1",
      workflowId: "wf-1",
      actor: "coder",
    });
    expect(obs!.opts.asType).toBe("span");
    expect(obs!.attrs["langfuse.observation.type"]).toBe("span");
    // Session propagated onto the root observation via propagateAttributes.
    expect(obs!.attrs["session.id"]).toBe("session-1");
    // Trace name propagated via propagateAttributes.
    expect(obs!.attrs["langfuse.trace.name"]).toBe("Fix the integration test");
    expect(run.runId).toBe("run-test1234");
  });

  it("duplicate startRun for the same active runId returns the existing run and never dup-creates", () => {
    const { client } = makeClient();
    const first = client.startRun(runInput());
    const second = client.startRun(runInput({ actor: "someone-else" }));

    expect(second).toBe(first);
    // Only one root observation.
    expect(fakeObservations.filter((o) => alixOfObs(o).kind === "run")).toHaveLength(1);
  });

  it("getRun resolves an active run and returns null for unknown runs", () => {
    const { client } = makeClient();
    const run = client.startRun(runInput());

    expect(client.getRun("run-test1234")).toBe(run);
    expect(client.getRun("run-unknown")).toBeNull();
  });

  it("endRun finishes the observation, unregisters the run, and repeated endRun no-ops", () => {
    const { client } = makeClient();
    const run = client.startRun(runInput());
    client.endRun(run, { status: "success", endedAt: 2_000_000 });

    expect(client.getRun("run-test1234")).toBeNull();
    const obs = rootObs("run-test1234");
    expect(obs).toBeDefined();
    expect(obs!.updateCalls).toBe(1);
    expect(obs!.endCalls).toBe(1);
    expect(obs!.ended).toBe(true);
    const alix = alixOfObs(obs!);
    expect(alix.status).toBe("success");
    expect(alix.durationMs).toBe(1_000_000);
    expect(alix.endedAtMs).toBe(2_000_000);

    // Second endRun on the same (now stale) handle is a no-op.
    client.endRun(run, { status: "error", error: "too late" });
    expect(obs!.updateCalls).toBe(1);
    expect(obs!.endCalls).toBe(1);
  });

  it("endRun on an unknown handle is a no-op", () => {
    const { client } = makeClient();
    client.startRun(runInput());
    client.endRun(staleRunHandle("run-ghost"), { status: "success" });
    expect(fakeObservations.filter((o) => alixOfObs(o).kind === "run")).toHaveLength(1);
  });

  it("startRun after endRun starts a fresh observation for a reused runId", () => {
    const { client } = makeClient();
    const run = client.startRun(runInput());
    client.endRun(run, { status: "success" });

    const again = client.startRun(runInput());
    expect(again).not.toBe(run);
    expect(fakeObservations.filter((o) => alixOfObs(o).kind === "run")).toHaveLength(2);
  });

  it("two live runs with distinct runIds stay independent — ending A leaves B active", async () => {
    const { client } = makeClient();
    const runA = client.startRun(runInput({ runId: "run-live-a" }));
    const runB = client.startRun(runInput({ runId: "run-live-b" }));

    const rootA = rootObs("run-live-a");
    const rootB = rootObs("run-live-b");
    expect(rootA).toBeDefined();
    expect(rootB).toBeDefined();
    expect(rootA!.otelSpan.spanContext().traceId).not.toBe(rootB!.otelSpan.spanContext().traceId);

    await client.endRun(runA, { status: "success", endedAt: 2_000_000 });
    expect(rootA!.ended).toBe(true);
    expect(rootB!.ended).toBe(false);
    expect(client.getRun("run-live-a")).toBeNull();
    expect(client.getRun("run-live-b")).toBe(runB);

    // B keeps honoring spans after A ended (independent lifecycle).
    expect(() => client.startModelSpan(runB, { provider: "openai", model: "gpt-5" })).not.toThrow();
  });

  it("run error outcome lands in metadata.alix", () => {
    const { client } = makeClient();
    const run = client.startRun(runInput());
    client.endRun(run, { status: "error", error: `boom ${SK_PROJ_KEY}` });

    const obs = rootObs("run-test1234");
    const alix = alixOfObs(obs!);
    expect(alix.status).toBe("error");
    expect(alix.error).toContain("<redacted>");
    expect(alix.error).not.toContain(SK_PROJ_KEY);
  });
});

// ---------------------------------------------------------------------------
// Span lifecycle + idempotency + unknown-run noops
// ---------------------------------------------------------------------------

describe("LangfuseTraceClient · spans", () => {
  beforeEach(resetFakeState);

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

  it("startModelSpan creates a generation child observation", () => {
    const { client } = makeClient();
    const run = client.startRun(runInput());
    const span = makeModelSpan(client, run);

    expect(span).toBeDefined();
    const gens = fakeObservations.filter((o) => o.opts.asType === "generation");
    expect(gens).toHaveLength(1);
    const gen = gens[0];
    expect(gen.name).toBe("claude-sonnet-4");
    expect(gen.opts.parentSpanContext).toBeDefined();
    expect(gen.opts.parentSpanContext!.traceId).toBe(rootObs("run-test1234")!.otelSpan.spanContext().traceId);
    expect(attrOfObs(gen, "model.name")).toBe("claude-sonnet-4");
    const alix = alixOfObs(gen);
    expect(alix).toMatchObject({ kind: "model", provider: "anthropic", invocationId: "inv-1" });
  });

  it("startToolSpan creates a span child observation", () => {
    const { client } = makeClient();
    const run = client.startRun(runInput());
    const span = client.startToolSpan(run, {
      toolName: "shell.run",
      toolCallId: "toolcall-1",
      startedAt: 1_000_000,
    });

    expect(span).toBeDefined();
    const spans = fakeObservations.filter((o) => o.opts.asType === "span" && alixOfObs(o).kind === "tool");
    expect(spans).toHaveLength(1);
    const sp = spans[0];
    expect(sp.name).toBe("shell.run");
    expect(sp.opts.parentSpanContext).toBeDefined();
    expect(sp.opts.parentSpanContext!.traceId).toBe(rootObs("run-test1234")!.otelSpan.spanContext().traceId);
  });

  it("unknown or already-ended runs yield noop spans that never create observations", () => {
    const { client } = makeClient();
    const run = client.startRun(runInput());

    // Never-registered run handle.
    const ghost = client.startModelSpan(staleRunHandle("run-ghost"), {
      provider: "anthropic",
      model: "claude-sonnet-4",
    });
    expect(fakeObservations.filter((o) => o.opts.asType === "generation")).toHaveLength(0);

    // Run ended before the span starts.
    client.endRun(run, { status: "success" });
    const after = makeModelSpan(client, run);
    expect(fakeObservations.filter((o) => o.opts.asType === "generation")).toHaveLength(0);

    // Noop spans are end-safe.
    expect(() => {
      client.endSpan(ghost, { status: "success" });
      client.endSpan(after, { status: "error", error: "x" });
    }).not.toThrow();
  });

  it("repeated endSpan is a no-op after the first terminal end", () => {
    const { client } = makeClient();
    const run = client.startRun(runInput());
    const span = makeModelSpan(client, run);

    client.endSpan(span, { status: "success", output: "first" });
    client.endSpan(span, { status: "error", error: "second end is dropped" });

    const gen = fakeObservations.find((o) => o.opts.asType === "generation");
    expect(gen!.endCalls).toBe(1);
    expect(gen!.ended).toBe(true);
  });

  it("spans created under a failed-run trace are end-safe noops", () => {
    const { client } = makeClient();
    client.startRun(runInput());
    const span = client.startModelSpan(staleRunHandle("run-other"), {
      provider: "openai",
      model: "gpt-5",
    });
    client.endSpan(span, { status: "success" });
    // No generation observation created for the ghost run.
    expect(fakeObservations.filter((o) => o.opts.asType === "generation")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Capture: redaction + per-kind truncation before the SDK
// ---------------------------------------------------------------------------

describe("LangfuseTraceClient · capture integration", () => {
  beforeEach(resetFakeState);

  it("redacts secrets inside captured model messages", () => {
    const { client } = makeClient();
    const run = client.startRun(runInput());
    client.startModelSpan(run, {
      provider: "anthropic",
      model: "claude-sonnet-4",
      messages: [
        { role: "user", content: `use key ${SK_PROJ_KEY} to proceed` },
        { role: "assistant", content: "ok" },
      ],
    });

    const gen = fakeObservations.find((o) => o.opts.asType === "generation");
    const input = attrOfObs(gen!, "input") as Array<{ role: string; content: string }>;
    expect(input[0].content).toContain("<redacted>");
    expect(input[0].content).not.toContain(SK_PROJ_KEY);
    expect(input[1].content).toBe("ok");
  });

  it("applies the per-kind message char limit from config", () => {
    const { client } = makeClient({ capture: { messages: "truncated", maxMessageChars: 123 } });
    const run = client.startRun(runInput());
    client.startModelSpan(run, {
      provider: "anthropic",
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "x".repeat(1000) }],
    });

    const gen = fakeObservations.find((o) => o.opts.asType === "generation");
    const input = attrOfObs(gen!, "input") as Array<{ content: string }>;
    expect(input[0].content).toHaveLength(123);
  });

  it("omits messages input entirely when messages capture is off", () => {
    const { client } = makeClient({ capture: { messages: "off" } });
    const run = client.startRun(runInput());
    client.startModelSpan(run, {
      provider: "anthropic",
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "should not appear" }],
    });

    const gen = fakeObservations.find((o) => o.opts.asType === "generation");
    expect("langfuse.observation.input" in gen!.attrs).toBe(false);
  });

  it("redacts tool args and omits them when toolInput capture is off", () => {
    const { client } = makeClient();
    const run = client.startRun(runInput());
    client.startToolSpan(run, {
      toolName: "shell.run",
      args: { apiKey: SK_PROJ_KEY, path: "/tmp" },
    });

    const tool = fakeObservations.find((o) => alixOfObs(o).kind === "tool");
    const input = attrOfObs(tool!, "input") as Record<string, unknown>;
    expect(input.path).toBe("/tmp");
    expect(input.apiKey).toBe("<redacted>");

    // toolInput off → args omitted entirely.
    const offClient = makeClient({ capture: { toolInput: "off" } }).client;
    const offRun = offClient.startRun(runInput());
    offClient.startToolSpan(offRun, { toolName: "shell.run", args: { apiKey: SK_PROJ_KEY } });
    const offTool = fakeObservations[fakeObservations.length - 1];
    expect("langfuse.observation.input" in offTool.attrs).toBe(false);
  });

  it("truncates model output text and tool output text per their kind limits", () => {
    // Model output uses the messages char budget (no dedicated model-output mode).
    const { client } = makeClient({ capture: { messages: "truncated", maxMessageChars: 100 } });
    const run = client.startRun(runInput());
    const modelSpan = client.startModelSpan(run, {
      provider: "anthropic",
      model: "claude-sonnet-4",
    });
    client.endSpan(modelSpan, { status: "success", output: "y".repeat(500) });
    const gen = fakeObservations.find((o) => o.opts.asType === "generation");
    expect((attrOfObs(gen!, "output") as string).length).toBe(100);

    // Tool output uses the tool char limit.
    const { client: toolClient } = makeClient({
      capture: { toolOutput: "truncated", maxToolOutputChars: 50 },
    });
    const toolRun = toolClient.startRun(runInput());
    const toolSpan = toolClient.startToolSpan(toolRun, { toolName: "shell.run" });
    toolClient.endSpan(toolSpan, { status: "success", output: "z".repeat(500) });
    const tool = fakeObservations[fakeObservations.length - 1];
    expect((attrOfObs(tool, "output") as string).length).toBe(50);
  });

  it("keeps full-length redacted output when messages capture is full", () => {
    const { client } = makeClient({ capture: { messages: "full" } });
    const run = client.startRun(runInput());
    const span = client.startModelSpan(run, {
      provider: "anthropic",
      model: "claude-sonnet-4",
    });
    client.endSpan(span, { status: "success", output: `${SK_PROJ_KEY} ${"x".repeat(500)}` });

    const gen = fakeObservations.find((o) => o.opts.asType === "generation");
    const output = attrOfObs(gen!, "output") as string;
    expect(output).toHaveLength("<redacted>".length + 1 + 500);
    expect(output).not.toContain(SK_PROJ_KEY);
  });

  it("captures reasoning only when the reasoning level is not off", () => {
    const { client } = makeClient(); // reasoning defaults to "off"
    const run = client.startRun(runInput());
    const span = client.startModelSpan(run, { provider: "anthropic", model: "claude-sonnet-4" });
    client.endSpan(span, { status: "success", reasoning: "private chain of thought" });

    const gen = fakeObservations.find((o) => o.opts.asType === "generation");
    const alix = alixOfObs(gen!);
    expect("reasoning" in alix).toBe(false);

    const { client: onClient } = makeClient({ capture: { reasoning: "truncated" } });
    const onRun = onClient.startRun(runInput());
    const onSpan = onClient.startModelSpan(onRun, {
      provider: "anthropic",
      model: "claude-sonnet-4",
    });
    onClient.endSpan(onSpan, {
      status: "success",
      reasoning: `chain ${SK_PROJ_KEY} of thought`,
    });
    const onGenAll = fakeObservations.filter((o) => o.opts.asType === "generation");
    const latest = onGenAll[onGenAll.length - 1];
    const onAlix = alixOfObs(latest);
    expect(onAlix.reasoning).toContain("<redacted>");
  });
});

// ---------------------------------------------------------------------------
// Outcome → Langfuse semantics
// ---------------------------------------------------------------------------

describe("LangfuseTraceClient · outcome translation", () => {
  beforeEach(resetFakeState);

  it("maps an errored model span to level ERROR with status + alix.status", () => {
    const { client } = makeClient();
    const run = client.startRun(runInput());
    const span = client.startModelSpan(run, { provider: "anthropic", model: "claude-sonnet-4" });
    client.endSpan(span, {
      status: "error",
      error: `rate limited ${SK_PROJ_KEY}`,
      inputTokens: 10,
      outputTokens: 5,
      finishReason: "error",
    });

    const gen = fakeObservations.find((o) => o.opts.asType === "generation");
    expect(attrOfObs(gen!, "level")).toBe("ERROR");
    expect(attrOfObs(gen!, "status_message")).toContain("<redacted>");
    expect(attrOfObs(gen!, "status_message")).not.toContain(SK_PROJ_KEY);
    expect(attrOfObs(gen!, "usage_details")).toEqual({ input: 10, output: 5 });
    const alix = alixOfObs(gen!);
    expect(alix.status).toBe("error");
    expect(alix.finishReason).toBe("error");
    expect(gen!.status.code).toBe(2);
    expect(gen!.status.message).toContain("rate limited");
  });

  it("maps success and cancelled to DEFAULT level while preserving the ALiX status", () => {
    const { client } = makeClient();
    const run = client.startRun(runInput());
    const ok = client.startModelSpan(run, { provider: "anthropic", model: "claude-sonnet-4" });
    client.endSpan(ok, { status: "success", output: "done" });
    const cancelled = client.startToolSpan(run, { toolName: "shell.run" });
    client.endSpan(cancelled, { status: "cancelled" });

    const gen = fakeObservations.find((o) => o.opts.asType === "generation");
    expect(attrOfObs(gen!, "level")).toBe("DEFAULT");
    expect(alixOfObs(gen!).status).toBe("success");
    expect(gen!.status.code).toBe(1);

    const tool = fakeObservations.find((o) => alixOfObs(o).kind === "tool");
    expect(attrOfObs(tool!, "level")).toBe("DEFAULT");
    expect("langfuse.observation.status_message" in tool!.attrs).toBe(false);
    expect(alixOfObs(tool!).status).toBe("cancelled");
    expect(tool!.status.code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Bounded flush (Task 13, design §12)
// ---------------------------------------------------------------------------

describe("LangfuseTraceClient · bounded flush", () => {
  beforeEach(resetFakeState);

  it("flush resolves normally when the processor forceFlush resolves", async () => {
    const { client, processor } = makeClient();
    await client.flush();
    expect(processor.flushCalls).toBe(1);
  });

  it("flush that rejects warns once and continues — no throw, no hang", async () => {
    const { client, processor } = makeClient();
    processor.flushReject = new Error("flush transport down");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(client.flush()).resolves.toBeUndefined();

    // warn-once: a second failing flush with the same key stays silent.
    await client.flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("flush failed"),
    );
    expect(processor.flushCalls).toBe(2);
    warn.mockRestore();
  });

  it("transient transport failure recovers — the same client still transports on the next flush", async () => {
    const { client, processor } = makeClient();
    // First flush: Langfuse is temporarily down → warn once, no throw.
    processor.flushReject = new Error("langfuse temporarily down");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(client.flush()).resolves.toBeUndefined();
    warn.mockRestore();

    // Transport recovers.
    processor.flushReject = null;
    const warnAfter = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(client.flush()).resolves.toBeUndefined();
    expect(warnAfter).not.toHaveBeenCalled();
    expect(processor.flushCalls).toBe(2);
    warnAfter.mockRestore();
  });

  it("flush hangs forever → resolves after flushTimeoutMs, not later (bounded wait)", async () => {
    vi.useFakeTimers();
    try {
      const { client, processor } = makeClient({ timeoutMs: 50 });
      processor.flushHang = new Promise<never>(() => {});
      const flushPromise = client.flush();
      await vi.advanceTimersByTimeAsync(50);
      // Agent continues: flush resolves (undefined), never rejects.
      await expect(flushPromise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("endRun with a permanently hanging flush completes within flushTimeoutMs", async () => {
    vi.useFakeTimers();
    try {
      const { client, processor } = makeClient({ timeoutMs: 100 });
      processor.flushHang = new Promise<never>(() => {});
      const run = client.startRun(runInput());

      const endPromise = client.endRun(run, { status: "success" });

      await vi.advanceTimersByTimeAsync(50);
      let settledEarly = false;
      await Promise.race([
        endPromise.then(() => { settledEarly = true; }),
        Promise.resolve().then(() => {}),
      ]);
      expect(settledEarly).toBe(false);

      await vi.advanceTimersByTimeAsync(50);
      await expect(endPromise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("endRun with a rejecting flush still resolves and records the outcome", async () => {
    const { client, processor } = makeClient();
    processor.flushReject = new Error("flush transport down");
    const run = client.startRun(runInput());

    await expect(client.endRun(run, { status: "success", endedAt: 2_000_000 })).resolves.toBeUndefined();
    const obs = rootObs("run-test1234");
    expect(obs!.updateCalls).toBe(1);
    expect(obs!.endCalls).toBe(1);
    const alix = alixOfObs(obs!);
    expect(alix.status).toBe("success");
  });

  it("flush is fail-open even when forceFlush throws synchronously", async () => {
    const { client, processor } = makeClient();
    processor.forceFlush = (() => {
      throw new Error("sync flush throw");
    }) as () => Promise<void>;

    await expect(client.flush()).resolves.toBeUndefined();
  });

  it("unknown/ended run endRun resolves immediately and never flushes late-arrival noise", async () => {
    const { client, processor } = makeClient();
    await expect(
      client.endRun(staleRunHandle("run-ghost"), { status: "success" }),
    ).resolves.toBeUndefined();
    expect(processor.flushCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bounded shutdown (Task 14, design §12/§14)
// ---------------------------------------------------------------------------

describe("LangfuseTraceClient · bounded shutdown", () => {
  beforeEach(resetFakeState);

  it("shutdown delegates to the processor and resolves", async () => {
    const { client, processor } = makeClient();
    await expect(client.shutdown()).resolves.toBeUndefined();
    expect(processor.shutdownCalls).toBe(1);
  });

  it("shutdown hangs forever → resolves after flushTimeoutMs, not later (bounded wait)", async () => {
    vi.useFakeTimers();
    try {
      const { client, processor } = makeClient({ timeoutMs: 50 });
      processor.shutdownReject = undefined as unknown as Error;
      // Make shutdown hang by replacing it.
      const hangPromise = new Promise<never>(() => {});
      processor.shutdown = () => hangPromise;
      const shutdownPromise = client.shutdown();
      await vi.advanceTimersByTimeAsync(50);
      await expect(shutdownPromise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is idempotent — a repeated shutdown is a no-op even while the first is pending", async () => {
    vi.useFakeTimers();
    try {
      const { client, processor } = makeClient({ timeoutMs: 50 });
      let sdkShutdownCalls = 0;
      const origShutdown = processor.shutdown.bind(processor);
      processor.shutdown = () => {
        sdkShutdownCalls++;
        return new Promise<void>(() => {});
      };
      const first = client.shutdown();
      // Idempotency guard already tripped: the second call returns immediately.
      await expect(client.shutdown()).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(50);
      await expect(first).resolves.toBeUndefined();
      expect(sdkShutdownCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shutdown rejection is fail-open and warned once", async () => {
    const { client, processor } = makeClient();
    processor.shutdownReject = new Error("shutdown transport down");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(client.shutdown()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("shutdown failed"));

    const { client: fresh, processor: freshProc } = makeClient();
    freshProc.shutdownReject = new Error("shutdown transport down");
    await expect(fresh.shutdown()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("shutdown is fail-open even when shutdown throws synchronously", async () => {
    const { client, processor } = makeClient();
    processor.shutdown = (() => {
      throw new Error("sync shutdown throw");
    }) as () => Promise<void>;

    await expect(client.shutdown()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Transport + fail-open
// ---------------------------------------------------------------------------

describe("LangfuseTraceClient · flush/shutdown and never-throw", () => {
  beforeEach(resetFakeState);

  it("flush and shutdown delegate to the processor", async () => {
    const { client, processor } = makeClient();
    await client.flush();
    await client.flush();
    await client.shutdown();
    await client.shutdown();

    expect(processor.flushCalls).toBe(2);
    expect(processor.shutdownCalls).toBe(1);
  });

  it("flush/shutdown resolve even when the processor rejects", async () => {
    const { client, processor } = makeClient();
    processor.flushReject = new Error("flush transport down");
    processor.shutdownReject = new Error("shutdown transport down");

    await expect(client.flush()).resolves.toBeUndefined();
    await expect(client.shutdown()).resolves.toBeUndefined();
  });

  it("lifecycle never throws when startObservation throws", () => {
    const { client } = makeClient();

    // Root observation creation fails → run still registers; spans become noops.
    fakeStartThrows = () => true;
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

    // Generation creation fails → noop span returned.
    fakeStartThrows = () => false;
    const run2 = client.startRun(runInput({ runId: "run-abc1234" }));
    fakeStartThrows = () => true;
    let noopSpan: TraceSpan;
    expect(() => {
      noopSpan = client.startModelSpan(run2, { provider: "openai", model: "gpt-5" });
    }).not.toThrow();
    client.endSpan(noopSpan!, { status: "success" });

    // endSpan on a successfully-created span never throws.
    fakeStartThrows = () => false;
    const realSpan = client.startModelSpan(run2, { provider: "openai", model: "gpt-5" });
    expect(() => client.endSpan(realSpan, { status: "success", output: "x" })).not.toThrow();

    // endRun on a successful run never throws.
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
  beforeEach(resetFakeState);

  function childRunInput(parentRunId: string, overrides: Partial<TraceRunInput> = {}): TraceRunInput {
    return runInput({
      runId: "run-child001",
      sessionId: undefined,
      task: "child delegated task",
      ...overrides,
      parentRunId,
    });
  }

  it("links an in-process child (no own session) into the active parent's session and keeps one trace per runId", () => {
    const { client } = makeClient();
    const parent = client.startRun(runInput()); // session-1

    const child = client.startRun(childRunInput("run-test1234"));

    // Exactly two root observations, one per ALiX runId.
    const parentRoot = rootObs("run-test1234");
    const childRoot = rootObs("run-child001");
    expect(parentRoot).toBeDefined();
    expect(childRoot).toBeDefined();
    expect(childRoot!.otelSpan.spanContext().traceId).not.toBe(parentRoot!.otelSpan.spanContext().traceId);
    expect(child.runId).toBe("run-child001");

    // The child inherits the parent's session via propagateAttributes.
    expect(childRoot!.attrs["session.id"]).toBe("session-1");
    const childAlix = alixOfObs(childRoot!);
    expect(childAlix).toMatchObject({
      kind: "run",
      runId: "run-child001",
      parentRunId: "run-test1234",
    });
    // The parent keeps its own session.
    expect(parentRoot!.attrs["session.id"]).toBe("session-1");
    expect(alixOfObs(parentRoot!)).not.toHaveProperty("parentRunId");

    // Child spans stay under the child root.
    const span = client.startModelSpan(child, { provider: "anthropic", model: "claude-sonnet-4" });
    client.endSpan(span, { status: "success", output: "child done" });
    const childGens = fakeObservations.filter(
      (o) => o.opts.asType === "generation" && o.otelSpan.spanContext().traceId === childRoot!.otelSpan.spanContext().traceId,
    );
    expect(childGens).toHaveLength(1);

    expect(client.getRun("run-test1234")).toBe(parent);
    expect(client.getRun("run-child001")).toBe(child);
  });

  it("keeps an explicit child session authoritative over parent-session grouping", () => {
    const { client } = makeClient();
    client.startRun(runInput()); // parent session-1

    const child = client.startRun(
      runInput({
        runId: "run-child002",
        sessionId: "session-child-9",
        parentRunId: "run-test1234",
      }),
    );
    const childRoot = rootObs("run-child002");
    expect(childRoot!.attrs["session.id"]).toBe("session-child-9");
    expect(alixOfObs(childRoot!).parentRunId).toBe("run-test1234");
    expect(client.getRun("run-child002")).toBe(child);
  });

  it("degrades to a standalone child trace for an unknown parent — no throw, parentRunId still recorded", () => {
    const { client } = makeClient();

    const child = client.startRun(childRunInput("run-ghost"));
    const childRoot = rootObs("run-child001");
    expect(childRoot).toBeDefined();
    // No active parent → no session inheritance.
    expect(childRoot!.attrs["session.id"]).toBeUndefined();
    const alix = alixOfObs(childRoot!);
    expect(alix).toMatchObject({ runId: "run-child001", parentRunId: "run-ghost" });

    // The standalone child still traces its own spans.
    const span = client.startModelSpan(child, { provider: "anthropic", model: "claude-sonnet-4" });
    client.endSpan(span, { status: "success" });
    const gens = fakeObservations.filter((o) => o.opts.asType === "generation");
    expect(gens).toHaveLength(1);
    expect(gens[0].otelSpan.spanContext().traceId).toBe(childRoot!.otelSpan.spanContext().traceId);
  });

  it("degrades to a standalone child trace when the parent already ended — no throw", () => {
    const { client } = makeClient();
    const parent = client.startRun(runInput());
    client.endRun(parent, { status: "success" });

    const child = client.startRun(childRunInput("run-test1234"));
    const childRoot = rootObs("run-child001");
    expect(childRoot).toBeDefined();
    expect(childRoot!.attrs["session.id"]).toBeUndefined();
    expect(alixOfObs(childRoot!).parentRunId).toBe("run-test1234");
  });

  it("lifecycle stays safe when the parent's own observation creation failed", () => {
    const { client } = makeClient();
    fakeStartThrows = () => true;
    client.startRun(runInput({ runId: "run-parent-fail", sessionId: "session-p" }));
    fakeStartThrows = () => false;

    // Parent registered (active) even though its root observation never succeeded.
    expect(client.getRun("run-parent-fail")).not.toBeNull();
    const child = client.startRun(
      childRunInput("run-parent-fail", { runId: "run-child003" }),
    );
    const parentRoot = rootObs("run-parent-fail");
    expect(parentRoot).toBeDefined(); // The throw itself was recorded before throwing.
    const childRoot = rootObs("run-child003");
    expect(childRoot).toBeDefined();
    expect(child.runId).toBe("run-child003");
    expect(() => client.endRun(child, { status: "success" })).not.toThrow();
  });

  it("keeps parallel siblings under one active parent independent", () => {
    const { client } = makeClient();
    const parent = client.startRun(runInput()); // session-1

    const siblingA = client.startRun(childRunInput("run-test1234", { runId: "run-sib-a" }));
    const siblingB = client.startRun(childRunInput("run-test1234", { runId: "run-sib-b" }));

    // One root observation per runId: parent + two siblings.
    const rootA = rootObs("run-sib-a");
    const rootB = rootObs("run-sib-b");
    expect(rootA).toBeDefined();
    expect(rootB).toBeDefined();
    expect(rootA!.otelSpan.spanContext().traceId).not.toBe(rootB!.otelSpan.spanContext().traceId);
    for (const r of [rootA!, rootB!]) {
      expect(r.attrs["session.id"]).toBe("session-1");
      expect(alixOfObs(r).parentRunId).toBe("run-test1234");
    }

    // Ending sibling A must not disturb sibling B's lifecycle or span routing.
    client.endRun(siblingA, { status: "success" });
    expect(client.getRun("run-sib-b")).toBe(siblingB);

    const span = client.startModelSpan(siblingB, { provider: "anthropic", model: "claude-sonnet-4" });
    client.endSpan(span, { status: "success", output: "sibling b still alive" });
    const gens = fakeObservations.filter(
      (o) => o.opts.asType === "generation" && o.otelSpan.spanContext().traceId === rootB!.otelSpan.spanContext().traceId,
    );
    expect(gens).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Construction validation (fail-open hook for the Task 9 factory)
// ---------------------------------------------------------------------------

describe("LangfuseTraceClient · construction", () => {
  beforeEach(resetFakeState);

  it("constructs with the processor receiving explicit store-resolved keys", () => {
    const { processor } = makeClient();
    expect(processor.options).toMatchObject({
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
