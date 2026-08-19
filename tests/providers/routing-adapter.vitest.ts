import { describe, it, expect, vi } from "vitest";
import { RoutingModelAdapter, type RoutingCandidate } from "../../src/providers/routing-adapter.js";
import { streamToResponse } from "../../src/run/helpers.js";
import { ApiError } from "../../src/providers/base.js";
import type { ModelAdapter, ModelCapabilities, NormalizedRequest, NormalizedResponse, StreamChunk } from "../../src/providers/types.js";

const req: NormalizedRequest = { systemPrompt: "s", messages: [{ role: "user", content: "hi" }] };

function fake(capabilities: Partial<ModelCapabilities>, behavior: {
  complete?: () => Promise<NormalizedResponse> | NormalizedResponse;
  stream?: () => AsyncGenerator<StreamChunk>;
  model?: string;
}): ModelAdapter {
  return {
    id: behavior.model ?? "fake",
    editFormatPreference: "search_replace",
    longContextStrategy: "trimmed_context",
    capabilities: {
      provider: "fake", model: behavior.model ?? "fake", inputTokenLimit: 100_000, outputTokenLimit: 8_192,
      supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true,
      ...capabilities,
    },
    async complete(r: NormalizedRequest): Promise<NormalizedResponse> {
      if (behavior.complete) {
        const res = await behavior.complete();
        if (res instanceof Error) throw res;
        return res;
      }
      return { text: "ok", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop" };
    },
    async *stream(r: NormalizedRequest): AsyncGenerator<StreamChunk> {
      if (behavior.stream) {
        yield* behavior.stream();
        return;
      }
      yield { type: "text_delta", text: "ok" };
      yield { type: "done" };
    },
  };
}

const err = (status: number) => new ApiError(status, `boom ${status}`);

function candidate(adapter: ModelAdapter, key = adapter.id): RoutingCandidate {
  return { key, label: key, adapter };
}

describe("RoutingModelAdapter complete", () => {
  it("primary succeeds → its response returned", async () => {
    const primary = fake({}, { complete: () => ({ text: "primary", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop" as const }) });
    const adapter = new RoutingModelAdapter([candidate(primary, "primary")]);
    const res = await adapter.complete(req);
    expect(res.text).toBe("primary");
    expect(res.resolvedModel).toBe("primary");
  });

  it("primary 429 → fallback response returned, resolvedModel = fallback label", async () => {
    const primary = fake({}, { complete: () => { throw err(429); } });
    const fallback = fake({}, { complete: () => ({ text: "fallback", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop" as const }) });
    const adapter = new RoutingModelAdapter([candidate(primary, "primary"), candidate(fallback, "free")]);
    const res = await adapter.complete(req);
    expect(res.text).toBe("fallback");
    expect(res.resolvedModel).toBe("free");
  });

  it("primary 500/502/503/504 → fallback", async () => {
    for (const status of [500, 502, 503, 504]) {
      const primary = fake({}, { complete: () => { throw err(status); } });
      const fallback = fake({}, { complete: () => ({ text: `fb-${status}`, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop" as const }) });
      const adapter = new RoutingModelAdapter([candidate(primary, "primary"), candidate(fallback, "free")]);
      const res = await adapter.complete(req);
      expect(res.text).toBe(`fb-${status}`);
    }
  });

  it("primary 400/401/403/404 → error propagates (no fallback)", async () => {
    for (const status of [400, 401, 403, 404]) {
      const primary = fake({}, { complete: () => { throw err(status); } });
      const fallback = fake({}, { complete: () => ({ text: "never", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop" as const }) });
      const adapter = new RoutingModelAdapter([candidate(primary, "primary"), candidate(fallback, "free")]);
      await expect(adapter.complete(req)).rejects.toThrow(`API error ${status}`);
    }
  });

  it("all candidates fail → 'All routing candidates failed' thrown", async () => {
    const primary = fake({}, { complete: () => { throw err(503); } });
    const fallback = fake({}, { complete: () => { throw err(503); } });
    const adapter = new RoutingModelAdapter([candidate(primary, "primary"), candidate(fallback, "free")]);
    await expect(adapter.complete(req)).rejects.toThrow("All routing candidates failed");
  });

  it("capability-incompatible candidate is skipped, never invoked", async () => {
    const called: string[] = [];
    const primary = fake({ supportsVision: false }, { complete: () => { called.push("primary"); return { text: "p", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop" as const }; } });
    const fallback = fake({}, { complete: () => { called.push("free"); return { text: "f", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop" as const }; } });
    const adapter = new RoutingModelAdapter([candidate(primary, "primary"), candidate(fallback, "free")]);
    const res = await adapter.complete({
      ...req,
      messages: [{ role: "user", content: [{ type: "image" as const, source: "https://x/y.png" }] }],
    });
    expect(called).toEqual(["free"]);
    expect(res.text).toBe("f");
  });

  it("retryable failures trip breaker at threshold (2); open candidate skipped via shouldAttempt()", async () => {
    const primary = fake({}, { complete: () => { throw err(429); } });
    const fallback = fake({}, { complete: () => { throw err(429); } });
    const adapter = new RoutingModelAdapter([candidate(primary, "primary"), candidate(fallback, "free")], { breakerFailureThreshold: 2 });

    // Round 1: both fail with retryable → primary breaker = 1 failure, fallback = 1.
    await expect(adapter.complete(req)).rejects.toThrow();
    // Round 2: primary breaker trips open (2), skip → fallback fails → trips (2). all fail.
    await expect(adapter.complete(req)).rejects.toThrow("All routing candidates failed");
    // Round 3: both breakers open → lastErr = "Circuit breaker is open" from fallback skip.
    await expect(adapter.complete(req)).rejects.toThrow("Circuit breaker is open — provider unavailable");
  });

  it("cooldownMs elapses → shouldAttempt() returns true (half-open probe); success closes the circuit", async () => {
    vi.useFakeTimers();
    try {
      let primaryCalls = 0;
      const primary = fake({}, {
        complete: () => {
          primaryCalls++;
          if (primaryCalls <= 2) throw err(429);
          return { text: "recovered", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop" as const };
        },
      });
const fallback = fake({}, {
      complete: () => { throw err(429); },
      stream: () => { throw err(429); },
    });
      const adapter = new RoutingModelAdapter([candidate(primary, "primary"), candidate(fallback, "free")], { breakerFailureThreshold: 2, breakerCooldownMs: 1000 });

      // Round 1: primary fails (1), fallback fails (1) → all failed.
      await expect(adapter.complete(req)).rejects.toThrow("All routing candidates failed");
      // Round 2: primary fails (2) → open, fallback fails (2) → open → all failed.
      await expect(adapter.complete(req)).rejects.toThrow("All routing candidates failed");
      // Round 3: primary open (still cooling) → skipped; fallback open → skipped.
      await expect(adapter.complete(req)).rejects.toThrow("Circuit breaker is open — provider unavailable");

      vi.advanceTimersByTime(1100);
      // Round 4: primary half-open probe → succeeds → closes circuit.
      const res = await adapter.complete(req);
      expect(res.text).toBe("recovered");
      expect(primaryCalls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("non-retryable error calls reset(), never accumulates toward open", async () => {
    let calls = 0;
    const primary = fake({}, {
      complete: () => {
        calls++;
        if (calls === 1) throw err(400);
        return { text: "ok", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop" as const };
      },
    });
    const fallback = fake({}, { complete: () => ({ text: "fb", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop" as const }) });
    const adapter = new RoutingModelAdapter([candidate(primary, "primary"), candidate(fallback, "free")], { breakerFailureThreshold: 1 });

    // 400 must propagate (no fallback), but must NOT trip the primary breaker.
    await expect(adapter.complete(req)).rejects.toThrow("API error 400");
    // Next request: primary breaker must still be closed.
    const res = await adapter.complete(req);
    expect(res.text).toBe("ok");
    expect(calls).toBe(2);
  });

  it("complete and stream share one breaker per candidate (consistent accounting)", async () => {
    const primary = fake({}, {
      complete: () => { throw err(429); },
      stream: () => { throw err(429); },
    });
    const fallback = fake({}, { complete: () => { throw err(429); }, stream: () => { throw err(429); } });
    const adapter = new RoutingModelAdapter([candidate(primary, "primary"), candidate(fallback, "free")], { breakerFailureThreshold: 2 });

    await expect(adapter.complete(req)).rejects.toThrow(); // complete: primary+fallback 1 failure each
    const gen = adapter.stream(req);
    await expect(gen.next()).rejects.toThrow(); // stream: primary+fallback 2nd failure → both trip open
    // Now both candidates are open for the streaming path too.
    const gen2 = adapter.stream(req);
    await expect(gen2.next()).rejects.toThrow("Circuit breaker is open");
  });

  it("does not fall back after text has been emitted (INV-5)", async () => {
    const primary = fake({}, {
      stream: () => (async function* () {
        yield { type: "text_delta", text: "hello" };
        yield { type: "error", error: "mid-stream drop" };
      })(),
    });
    const fallback = fake({}, {
      stream: () => (async function* () {
        yield { type: "text_delta", text: "fallback" };
        yield { type: "done" };
      })(),
    });
    const adapter = new RoutingModelAdapter([candidate(primary, "primary"), candidate(fallback, "free")]);
    const out: { type: string; text?: string }[] = [];
    for await (const c of adapter.stream(req)) {
      if (c.type === "text_delta" || c.type === "error") out.push(c);
    }
    // Committed text forwards, then the error chunk — fallback never runs.
    expect(out).toEqual([{ type: "text_delta", text: "hello" }, { type: "error", error: "mid-stream drop" }]);
  });

  it("falls back when stream fails before any committed chunk", async () => {
    const primary = fake({}, {
      stream: () => (async function* () {
        throw err(503);
      })(),
    });
    const fallback = fake({}, {
      stream: () => (async function* () {
        yield { type: "text_delta", text: "fallback" };
        yield { type: "done" };
      })(),
    });
    const adapter = new RoutingModelAdapter([candidate(primary, "primary"), candidate(fallback, "free")]);
    const out: string[] = [];
    for await (const c of adapter.stream(req)) {
      if (c.type === "text_delta") out.push(c.text);
    }
    expect(out).toEqual(["fallback"]);
  });

  it("returns fallback resolvedModel when fallback stream succeeds", async () => {
    const primary = fake({}, {
      stream: () => (async function* () {
        throw err(503);
      })(),
    });
    const fallback = fake({}, {
      stream: () => (async function* () {
        yield { type: "text_delta", text: "fallback" };
        yield { type: "done" };
      })(),
    });
    const adapter = new RoutingModelAdapter([candidate(primary, "primary"), candidate(fallback, "free")]);
    const out: { type: string; text?: string; resolvedModel?: string }[] = [];
    for await (const c of adapter.stream(req)) out.push(c);
    const done = out.find((c) => c.type === "done");
    expect(done?.resolvedModel).toBe("free");
  });

  it("forwards committed chunks verbatim", async () => {
    const primary = fake({}, {
      stream: () => (async function* () {
        yield { type: "text_delta", text: "a" };
        yield { type: "tool_call", toolCall: { name: "t", args: {} } as never };
        yield { type: "usage", usage: { inputTokens: 1, outputTokens: 1 } };
        yield { type: "done" };
      })(),
    });
    const adapter = new RoutingModelAdapter([candidate(primary, "primary")]);
    const out: { type: string }[] = [];
    for await (const c of adapter.stream(req)) out.push(c);
    expect(out.map((c) => c.type)).toEqual(["text_delta", "tool_call", "usage", "done"]);
  });

  it("streamToResponse rejects (no concatenation) after post-commit stream error on a routed provider (INV-5)", async () => {
    const routed = fake({}, {
      stream: () => (async function* () {
        yield { type: "text_delta", text: "partial" };
        yield { type: "error", error: "mid-stream drop" };
      })(),
    });
    const adapter = new RoutingModelAdapter([candidate(routed, "primary")]);
    await expect(streamToResponse(adapter, req)).rejects.toThrow("mid-stream drop");
  });
});