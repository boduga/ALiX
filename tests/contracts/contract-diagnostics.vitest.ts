// tests/contracts/contract-diagnostics.vitest.ts

import { describe, it, expect } from "vitest";
import { buildDiagnostic, formatDiagnostic } from "../../src/contracts/contract-diagnostics.js";
import { withProviderContracts, ContractValidationError } from "../../src/providers/provider-contract-validation.js";
import type { ModelAdapter, NormalizedRequest, NormalizedResponse, StreamChunk } from "../../src/providers/types.js";

// ---------------------------------------------------------------------------
// Diagnostics helpers
// ---------------------------------------------------------------------------

describe("buildDiagnostic", () => {
  it("builds a diagnostic with all fields", () => {
    const diag = buildDiagnostic("provider", "complete.response", "NormalizedResponseSchema", "text is wrong type");
    expect(diag.domain).toBe("provider");
    expect(diag.boundary).toBe("complete.response");
    expect(diag.schema).toBe("NormalizedResponseSchema");
    expect(diag.error).toBeTruthy();
    expect(diag.timestamp).toBeTruthy();
    expect(diag.entityId).toBeUndefined();
  });

  it("includes entityId when provided", () => {
    const diag = buildDiagnostic("provider", "complete.request", "NormalizedRequestSchema", "missing field", "call-1");
    expect(diag.entityId).toBe("call-1");
  });

  it("truncates long error messages", () => {
    const long = "x".repeat(500);
    const diag = buildDiagnostic("provider", "complete.request", "Schema", long);
    expect(diag.error.length).toBeLessThanOrEqual(203);
    expect(diag.error.endsWith("...")).toBe(true);
  });
});

describe("formatDiagnostic", () => {
  it("formats a diagnostic as readable string", () => {
    const diag = buildDiagnostic("provider", "stream.chunk", "StreamChunkSchema", "invalid chunk");
    const formatted = formatDiagnostic(diag);
    expect(formatted).toContain("provider/stream.chunk");
    expect(formatted).toContain("StreamChunkSchema");
  });
});

// ---------------------------------------------------------------------------
// Provider diagnostics via onDiagnostic callback
// ---------------------------------------------------------------------------

describe("withProviderContracts diagnostics", () => {
  function createFakeAdapter(overrides?: Partial<ModelAdapter>): ModelAdapter {
    return {
      id: "test-adapter",
      capabilities: { provider: "test", model: "test-model", inputTokenLimit: 1000, outputTokenLimit: 1000, supportsTools: true, supportsStreaming: false, supportsStructuredOutput: false, supportsVision: false },
      editFormatPreference: "structured_patch",
      longContextStrategy: "expanded_context",
      complete: async () => ({ text: "ok", toolCalls: [] }),
      ...overrides,
    };
  }

  // T1: diagnostics emitted for malformed request
  it("emits diagnostic on malformed request", async () => {
    const diagnostics: any[] = [];
    const wrapped = withProviderContracts(createFakeAdapter(), (d) => diagnostics.push(d));

    await expect(
      wrapped.complete({ messages: [] } as any),
    ).rejects.toThrow(ContractValidationError);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].domain).toBe("provider");
    expect(diagnostics[0].schema).toContain("Request");
  });

  // T2: diagnostics emitted for malformed response
  it("emits diagnostic on malformed response", async () => {
    const diagnostics: any[] = [];
    const wrapped = withProviderContracts(
      createFakeAdapter({ complete: async () => ({ text: 42 }) as any }),
      (d) => diagnostics.push(d),
    );

    await expect(
      wrapped.complete({ systemPrompt: "X", messages: [] }),
    ).rejects.toThrow(ContractValidationError);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].domain).toBe("provider");
    expect(diagnostics[0].schema).toContain("Response");
  });

  // T3: no diagnostics emitted for valid request/response
  it("does not emit diagnostic for valid flow", async () => {
    const diagnostics: any[] = [];
    const wrapped = withProviderContracts(createFakeAdapter(), (d) => diagnostics.push(d));

    await wrapped.complete({ systemPrompt: "X", messages: [{ role: "user" as const, content: "Hi" }] });

    expect(diagnostics.length).toBe(0);
  });

  // T4: diagnostics emitted for malformed stream chunk
  it("emits diagnostic on malformed stream chunk", async () => {
    const diagnostics: any[] = [];
    const wrapped = withProviderContracts(
      createFakeAdapter({
        stream: async function* () {
          yield { type: "invalid" } as any;
        },
      }),
      (d) => diagnostics.push(d),
    );

    let caught = false;
    try {
      for await (const _chunk of wrapped.stream!({ systemPrompt: "X", messages: [{ role: "user" as const, content: "" }] })) {
        // should not reach
      }
    } catch (e) {
      caught = e instanceof ContractValidationError;
    }

    expect(caught).toBe(true);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].boundary).toBe("stream.chunk");
  });

  // T5: diagnostic is emitted with proper domain
  it("emits diagnostic with correct domain and boundary on malformed request", async () => {
    const diagnostics: any[] = [];
    const wrapped = withProviderContracts(createFakeAdapter(), (d) => diagnostics.push(d));

    await expect(
      wrapped.complete({ messages: [{ role: "user" as const, content: "Hi" }] } as any),
    ).rejects.toThrow(ContractValidationError);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].domain).toBe("provider");
    expect(diagnostics[0].boundary).toBe("complete.request");
  });
});
