// tests/providers/provider-contract-validation.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ModelAdapter, NormalizedRequest, NormalizedResponse, StreamChunk } from "../../src/providers/types.js";
import { withProviderContracts, ContractValidationError } from "../../src/providers/provider-contract-validation.js";

// ---------------------------------------------------------------------------
// Fake adapter for testing
// ---------------------------------------------------------------------------

function createFakeAdapter(overrides?: Partial<ModelAdapter>): ModelAdapter {
  return {
    id: "test-adapter",
    capabilities: {
      provider: "test",
      model: "test-model",
      inputTokenLimit: 1000,
      outputTokenLimit: 1000,
      supportsTools: true,
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsVision: false,
    },
    editFormatPreference: "structured_patch",
    longContextStrategy: "expanded_context",
    complete: async (_request: NormalizedRequest): Promise<NormalizedResponse> => ({
      text: "Hello from fake adapter",
      toolCalls: [],
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("withProviderContracts", () => {
  // -----------------------------------------------------------------------
  // Valid request + response
  // -----------------------------------------------------------------------

  it("passes valid request and response through", async () => {
    const adapter = createFakeAdapter();
    const wrapped = withProviderContracts(adapter);

    const response = await wrapped.complete({
      systemPrompt: "You are a helper",
      messages: [{ role: "user" as const, content: "Hi" }],
    });

    assert.strictEqual(response.text, "Hello from fake adapter");
    assert.deepStrictEqual(response.toolCalls, []);
  });

  // -----------------------------------------------------------------------
  // Malformed request
  // -----------------------------------------------------------------------

  it("rejects malformed request before calling adapter", async () => {
    let adapterCalled = false;
    const adapter = createFakeAdapter({
      complete: async () => {
        adapterCalled = true;
        return { text: "should not reach", toolCalls: [] };
      },
    });
    const wrapped = withProviderContracts(adapter);

    // Missing systemPrompt (required field)
    await assert.rejects(
      () =>
        wrapped.complete({
          messages: [{ role: "user" as const, content: "Hi" }],
        } as any),
      ContractValidationError,
    );

    assert.equal(adapterCalled, false, "adapter.complete must not be called on malformed request");
  });

  it("rejects request with missing messages", async () => {
    const adapter = createFakeAdapter();
    const wrapped = withProviderContracts(adapter);

    await assert.rejects(
      () =>
        wrapped.complete({
          systemPrompt: "X",
        } as any),
      ContractValidationError,
    );
  });

  // -----------------------------------------------------------------------
  // Malformed response
  // -----------------------------------------------------------------------

  it("rejects malformed response from adapter", async () => {
    const adapter = createFakeAdapter({
      complete: async () =>
        ({ text: 42 }) as any, // text must be string, not number
    });
    const wrapped = withProviderContracts(adapter);

    await assert.rejects(
      () =>
        wrapped.complete({
          systemPrompt: "You are a helper",
          messages: [{ role: "user" as const, content: "Hi" }],
        }),
      ContractValidationError,
    );
  });

  it("rejects response missing text", async () => {
    const adapter = createFakeAdapter({
      complete: async () =>
        ({ toolCalls: [] }) as any, // text is required
    });
    const wrapped = withProviderContracts(adapter);

    await assert.rejects(
      () =>
        wrapped.complete({
          systemPrompt: "X",
          messages: [],
        }),
      ContractValidationError,
    );
  });

  // -----------------------------------------------------------------------
  // Adapter metadata preserved
  // -----------------------------------------------------------------------

  it("preserves adapter id and capabilities", () => {
    const adapter = createFakeAdapter();
    const wrapped = withProviderContracts(adapter);

    assert.strictEqual(wrapped.id, "test-adapter");
    assert.strictEqual(wrapped.capabilities.provider, "test");
    assert.strictEqual(wrapped.capabilities.supportsTools, true);
  });

  it("preserves editFormatPreference and longContextStrategy", () => {
    const adapter = createFakeAdapter({
      editFormatPreference: "search_replace",
      longContextStrategy: "trimmed_context",
    });
    const wrapped = withProviderContracts(adapter);

    assert.strictEqual(wrapped.editFormatPreference, "search_replace");
    assert.strictEqual(wrapped.longContextStrategy, "trimmed_context");
  });

  // -----------------------------------------------------------------------
  // Passthrough methods
  // -----------------------------------------------------------------------

  it("passes negotiate through when defined", async () => {
    let negotiateCalled = false;
    const adapter = createFakeAdapter({
      negotiate: async () => {
        negotiateCalled = true;
        return {
          contextBudget: 1000,
          outputBudget: 500,
          editFormat: "structured_patch" as const,
          toolsEnabled: true,
          structuredOutputEnabled: false,
          visionEnabled: false,
        };
      },
    });
    const wrapped = withProviderContracts(adapter);

    const result = await wrapped.negotiate!({
      systemPrompt: "test",
      messages: [{ role: "user" as const, content: "Hi" }],
    });

    assert.ok(negotiateCalled);
    assert.strictEqual(result.contextBudget, 1000);
  });

  it("sets negotiate to undefined when adapter has none", () => {
    const adapter = createFakeAdapter({ negotiate: undefined });
    const wrapped = withProviderContracts(adapter);

    assert.strictEqual(wrapped.negotiate, undefined);
  });

  it("sets stream to undefined when adapter has none", () => {
    const adapter = createFakeAdapter({ stream: undefined });
    const wrapped = withProviderContracts(adapter);

    assert.strictEqual(wrapped.stream, undefined);
  });

  // -----------------------------------------------------------------------
  // Multiple calls
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // Streaming validation
  // -----------------------------------------------------------------------

  it("adapter without stream still works", async () => {
    const adapter = createFakeAdapter({ stream: undefined });
    const wrapped = withProviderContracts(adapter);

    assert.strictEqual(wrapped.stream, undefined);

    const response = await wrapped.complete({
      systemPrompt: "No stream",
      messages: [{ role: "user" as const, content: "Hi" }],
    });
    assert.strictEqual(response.text, "Hello from fake adapter");
  });

  it("valid stream request and chunks pass through", async () => {
    const adapter = createFakeAdapter({
      stream: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: "text_delta", text: "Hello" };
        yield { type: "done" };
      },
    });
    const wrapped = withProviderContracts(adapter);
    const chunks: StreamChunk[] = [];

    for await (const chunk of wrapped.stream!({
      systemPrompt: "Stream test",
      messages: [{ role: "user" as const, content: "Hi" }],
    })) {
      chunks.push(chunk);
    }

    assert.strictEqual(chunks.length, 2);
    assert.strictEqual(chunks[0].type, "text_delta");
    assert.strictEqual((chunks[0] as any).text, "Hello");
    assert.strictEqual(chunks[1].type, "done");
  });

  it("all 5 stream chunk variants pass through", async () => {
    const adapter = createFakeAdapter({
      stream: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: "text_delta", text: "A" };
        yield { type: "tool_call", toolCall: { id: "tc-1", name: "shell.run", args: { command: "ls" } } };
        yield { type: "usage", usage: { inputTokens: 5, outputTokens: 10 } };
        yield { type: "done" };
        yield { type: "error", error: "oops" };
      },
    });
    const wrapped = withProviderContracts(adapter);
    let count = 0;

    for await (const _chunk of wrapped.stream!({
      systemPrompt: "All chunks",
      messages: [{ role: "user" as const, content: "X" }],
    })) {
      count++;
    }

    assert.strictEqual(count, 5);
  });

  it("malformed stream request fails before calling adapter", async () => {
    let adapterCalled = false;
    const adapter = createFakeAdapter({
      stream: async function* (): AsyncGenerator<StreamChunk> {
        adapterCalled = true;
        yield { type: "done" };
      },
    });
    const wrapped = withProviderContracts(adapter);

    await assert.rejects(
      async () => {
        for await (const _chunk of wrapped.stream!({
          messages: [{ role: "user" as const, content: "X" }],
        } as any)) {
          // should not reach
        }
      },
      ContractValidationError,
    );

    assert.equal(adapterCalled, false, "adapter.stream must not be called");
  });

  it("malformed yielded chunk fails during iteration", async () => {
    const adapter = createFakeAdapter({
      stream: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: "invalid_type" } as any;
      },
    });
    const wrapped = withProviderContracts(adapter);

    await assert.rejects(
      async () => {
        for await (const _chunk of wrapped.stream!({
          systemPrompt: "Broken stream",
          messages: [{ role: "user" as const, content: "" }],
        })) {
          // should throw on first chunk
        }
      },
      ContractValidationError,
    );
  });

  it("validates multiple sequential calls", async () => {
    const adapter = createFakeAdapter();
    const wrapped = withProviderContracts(adapter);

    const r1 = await wrapped.complete({
      systemPrompt: "First call",
      messages: [{ role: "user" as const, content: "Hello" }],
    });
    assert.strictEqual(r1.text, "Hello from fake adapter");

    const r2 = await wrapped.complete({
      systemPrompt: "Second call",
      messages: [{ role: "user" as const, content: "Again" }],
    });
    assert.strictEqual(r2.text, "Hello from fake adapter");
  });

  // -----------------------------------------------------------------------
  // Stream idle timeout
  // -----------------------------------------------------------------------

  it("stream yielding chunks within idle timeout succeeds", async () => {
    const adapter = createFakeAdapter({
      stream: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: "text_delta", text: "A" };
        yield { type: "text_delta", text: "B" };
        yield { type: "done" };
      },
    });
    const wrapped = withProviderContracts(adapter, undefined, undefined, 5000);
    const chunks: StreamChunk[] = [];

    for await (const chunk of wrapped.stream!({
      systemPrompt: "Fast stream",
      messages: [{ role: "user" as const, content: "Hi" }],
    })) {
      chunks.push(chunk);
    }

    assert.strictEqual(chunks.length, 3);
  });

  it("stream stalling before first chunk throws SideEffectTimeoutError", async () => {
    const adapter = createFakeAdapter({
      stream: async function* (): AsyncGenerator<StreamChunk> {
        await new Promise((r) => setTimeout(r, 5000));
        yield { type: "done" };
      },
    });
    const wrapped = withProviderContracts(adapter, undefined, undefined, 30);

    await assert.rejects(
      async () => {
        for await (const _chunk of wrapped.stream!({
          systemPrompt: "Slow start",
          messages: [{ role: "user" as const, content: "" }],
        })) {
          // should not reach
        }
      },
      (err: unknown) =>
        err instanceof Error && err.message.includes("stream.idle"),
    );
  });

  it("stream stalling between chunks throws SideEffectTimeoutError", async () => {
    const adapter = createFakeAdapter({
      stream: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: "text_delta", text: "First" };
        await new Promise((r) => setTimeout(r, 5000));
        yield { type: "done" };
      },
    });
    const wrapped = withProviderContracts(adapter, undefined, undefined, 30);

    await assert.rejects(
      async () => {
        for await (const _chunk of wrapped.stream!({
          systemPrompt: "Stall between",
          messages: [{ role: "user" as const, content: "" }],
        })) {
          // should get first chunk then timeout
        }
      },
      (err: unknown) =>
        err instanceof Error && err.message.includes("stream.idle"),
    );
  });
});
