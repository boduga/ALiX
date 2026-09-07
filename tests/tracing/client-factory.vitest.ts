/**
 * Tracing client factory — runtime selection semantics (design §4, §10-11).
 *
 * Uses a vi.mock('langfuse') fake (no network) plus a recording subclass of the
 * real LangfuseTraceClient so both the factory's decision logic and the real
 * adapter's construction validation run hermetically. Verifies:
 *   - enabled=false → frozen NOOP_TRACE_CLIENT singleton; zero Langfuse
 *     construction attempts, zero SDK construction, no warn
 *   - enabled=false never evaluates the langfuse module graph (lazy-load
 *     regression for the Task 10 review fix: the adapter is dynamic-imported
 *     only on the enabled branch)
 *   - enabled=true + valid config → LangfuseTraceClient
 *   - enabled=true + invalid config (empty baseUrl, unresolved cred:// ref)
 *     → warn once → Noop, no throw, application continues
 *   - enabled=true + SDK construction throw → warn once → Noop
 *   - memoization: repeated calls return the same instance; the construction
 *     failure warn fires only once across calls; only one adapter attempt
 *   - the returned promise never rejects (fail-open holds across configs)
 *   - warnOnce helper dedupes per key
 *
 * Since the Task 10 review fix, createTraceClient is async (memoized promise):
 * the adapter module is loaded lazily by dynamic import inside the enabled
 * branch, so a default-disabled process never evaluates the `langfuse` module
 * graph at runtime. The resolved TraceClient's lifecycle methods stay
 * synchronous; only acquisition is async, once, at bootstrap.
 *
 * Each scenario imports the factory fresh (vi.resetModules) so the module-level
 * selection memo is isolated per test.
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md
 * Task: Task 9 of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 * Lazy adapter load: Task 10 review fix (Important #1).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { TracingConfig } from "../../src/config/schema.js";

// Hoisted state shared by the vi.mock factories below (mock factories cannot
// close over non-hoisted module variables). `langfuseModuleEvaluations` counts
// how many times the langfuse mock module is *evaluated* (its factory runs only
// when the module is actually imported) — the lazy-load regression signal.
const state = vi.hoisted(() => ({
  adapterAttempts: 0,
  sdkConstructions: 0,
  sdkCtorShouldThrow: false,
  langfuseModuleEvaluations: 0,
}));

vi.mock("langfuse", () => {
  state.langfuseModuleEvaluations += 1;
  class FakeLangfuse {
    constructor() {
      state.sdkConstructions += 1;
      if (state.sdkCtorShouldThrow) {
        throw new Error("synthetic SDK constructor failure");
      }
    }
  }
  return { default: FakeLangfuse };
});

vi.mock("../../src/tracing/langfuse-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/tracing/langfuse-client.js")>();
  const RealLangfuseTraceClient = actual.LangfuseTraceClient;
  return {
    ...actual,
    LangfuseTraceClient: class extends RealLangfuseTraceClient {
      constructor(config: TracingConfig) {
        state.adapterAttempts += 1;
        super(config);
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

function tracingConfig(over?: {
  enabled?: boolean;
  baseUrl?: string;
  publicKey?: string;
  secretKey?: string;
}): TracingConfig {
  return {
    enabled: over?.enabled ?? true,
    langfuse: {
      baseUrl: over?.baseUrl ?? "https://cloud.langfuse.com",
      publicKey: over?.publicKey ?? "pk-lf-test-public-key",
      secretKey: over?.secretKey ?? "sk-lf-test-secret-key",
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

/** Fresh factory + adapter modules (isolates the module-level selection memo). */
async function loadFactory() {
  vi.resetModules();
  const factory = await import("../../src/tracing/client-factory.js");
  const adapter = await import("../../src/tracing/langfuse-client.js");
  const noop = await import("../../src/tracing/noop-client.js");
  return {
    createTraceClient: factory.createTraceClient,
    LangfuseTraceClient: adapter.LangfuseTraceClient,
    NOOP_TRACE_CLIENT: noop.NOOP_TRACE_CLIENT,
  };
}

function stubWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createTraceClient", () => {
  beforeEach(() => {
    state.adapterAttempts = 0;
    state.sdkConstructions = 0;
    state.sdkCtorShouldThrow = false;
    state.langfuseModuleEvaluations = 0;
  });

  it("returns the frozen NOOP singleton when tracing.enabled is false", async () => {
    const { createTraceClient, NOOP_TRACE_CLIENT } = await loadFactory();
    const warn = stubWarn();

    const client = await createTraceClient(tracingConfig({ enabled: false }));

    expect(client).toBe(NOOP_TRACE_CLIENT);
    expect(state.adapterAttempts).toBe(0);
    expect(state.sdkConstructions).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("enabled=false never resolves credentials or constructs anything", async () => {
    const { createTraceClient, NOOP_TRACE_CLIENT } = await loadFactory();

    const client = await createTraceClient(tracingConfig({ enabled: false }));

    expect(client).toBe(NOOP_TRACE_CLIENT);
    expect(state.adapterAttempts).toBe(0);
    expect(state.sdkConstructions).toBe(0);
  });

  it("disabled: importing the factory and calling it never evaluates the langfuse module graph (lazy-load regression)", async () => {
    // The Task 10 review fix: the adapter (and through it the `langfuse`
    // package) must be dynamic-imported ONLY on the enabled branch. If a
    // static import crept back into client-factory, evaluating that module
    // would run the langfuse mock factory below (langfuseModuleEvaluations > 0)
    // even before createTraceClient is called. This test imports ONLY the
    // factory + noop modules (never the adapter) and asserts the langfuse
    // module graph was never evaluated on the disabled path.
    vi.resetModules();
    const factory = await import("../../src/tracing/client-factory.js");
    const noop = await import("../../src/tracing/noop-client.js");
    expect(state.langfuseModuleEvaluations).toBe(0);

    const client = await factory.createTraceClient(tracingConfig({ enabled: false }));

    expect(client).toBe(noop.NOOP_TRACE_CLIENT);
    expect(state.langfuseModuleEvaluations).toBe(0);
    expect(state.adapterAttempts).toBe(0);
    expect(state.sdkConstructions).toBe(0);
  });

  it("returns a LangfuseTraceClient for enabled=true with a valid config", async () => {
    const { createTraceClient, LangfuseTraceClient } = await loadFactory();

    const client = await createTraceClient(tracingConfig());

    expect(client).toBeInstanceOf(LangfuseTraceClient);
    expect(state.adapterAttempts).toBe(1);
    expect(state.sdkConstructions).toBe(1);
  });

  it("enabled=true with an empty baseUrl warns once and falls back to Noop", async () => {
    const { createTraceClient, NOOP_TRACE_CLIENT } = await loadFactory();
    const warn = stubWarn();

    const client = await createTraceClient(tracingConfig({ baseUrl: "" }));

    expect(client).toBe(NOOP_TRACE_CLIENT);
    expect(state.adapterAttempts).toBe(1);
    expect(state.sdkConstructions).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Langfuse tracing disabled for this process"),
    );
    warn.mockRestore();
  });

  it("enabled=true with an unresolved cred:// reference warns once and falls back to Noop", async () => {
    const { createTraceClient, NOOP_TRACE_CLIENT } = await loadFactory();
    const warn = stubWarn();

    const client = await createTraceClient(
      tracingConfig({
        publicKey: "cred://langfuse/publicKey",
        secretKey: "cred://langfuse/secretKey",
      }),
    );

    expect(client).toBe(NOOP_TRACE_CLIENT);
    expect(state.adapterAttempts).toBe(1);
    expect(state.sdkConstructions).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("enabled=true with an SDK construction throw warns once and falls back to Noop", async () => {
    const { createTraceClient, NOOP_TRACE_CLIENT } = await loadFactory();
    const warn = stubWarn();
    state.sdkCtorShouldThrow = true;

    const client = await createTraceClient(tracingConfig());

    expect(client).toBe(NOOP_TRACE_CLIENT);
    expect(state.adapterAttempts).toBe(1);
    expect(state.sdkConstructions).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("memoizes a successful enabled selection across repeated calls", async () => {
    const { createTraceClient } = await loadFactory();

    const first = await createTraceClient(tracingConfig());
    const second = await createTraceClient(tracingConfig({ baseUrl: "https://other.example" }));

    expect(first).toBe(second);
    expect(state.adapterAttempts).toBe(1);
    expect(state.sdkConstructions).toBe(1);
  });

  it("warns only once and re-uses the Noop fallback on repeated failed calls", async () => {
    const { createTraceClient, NOOP_TRACE_CLIENT } = await loadFactory();
    const warn = stubWarn();

    const first = await createTraceClient(tracingConfig({ baseUrl: "" }));
    const second = await createTraceClient(tracingConfig({ baseUrl: "" }));

    expect(first).toBe(NOOP_TRACE_CLIENT);
    expect(second).toBe(NOOP_TRACE_CLIENT);
    expect(state.adapterAttempts).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("disabled selection does not warn and shares the singleton across calls", async () => {
    const { createTraceClient, NOOP_TRACE_CLIENT } = await loadFactory();
    const warn = stubWarn();

    const first = await createTraceClient(tracingConfig({ enabled: false }));
    const second = await createTraceClient(tracingConfig({ enabled: false }));

    expect(first).toBe(NOOP_TRACE_CLIENT);
    expect(second).toBe(NOOP_TRACE_CLIENT);
    expect(warn).not.toHaveBeenCalled();
    expect(state.adapterAttempts).toBe(0);
    warn.mockRestore();
  });

  it("never rejects into the caller, regardless of config state (fail-open)", async () => {
    const warn = stubWarn();
    for (const config of [
      tracingConfig({ enabled: false }),
      tracingConfig({ baseUrl: "" }),
      tracingConfig({ publicKey: "" }),
      tracingConfig({ publicKey: "cred://langfuse/publicKey" }),
      tracingConfig({ secretKey: "" }),
    ]) {
      const { createTraceClient } = await loadFactory();
      await expect(createTraceClient(config)).resolves.toBeDefined();
    }
    warn.mockRestore();
  });
});

describe("warnOnce", () => {
  it("warns the first time and stays silent for the same key", async () => {
    vi.resetModules();
    const { warnOnce } = await import("../../src/tracing/warn-once.js");
    const warn = stubWarn();

    warnOnce("boom");
    warnOnce("boom");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("boom");
    warn.mockRestore();
  });

  it("warns for distinct messages when no explicit key is given", async () => {
    vi.resetModules();
    const { warnOnce } = await import("../../src/tracing/warn-once.js");
    const warn = stubWarn();

    warnOnce("first");
    warnOnce("second");

    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("dedupes across varying messages under one explicit key", async () => {
    vi.resetModules();
    const { warnOnce } = await import("../../src/tracing/warn-once.js");
    const warn = stubWarn();

    warnOnce("message one", "k");
    warnOnce("message two", "k");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("message one");
    warn.mockRestore();
  });
});
