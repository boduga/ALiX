/**
 * model-replan-adapter.test.ts — Unit tests for ModelReplanAdapter.
 *
 * Tests:
 * - Returns parsed draft on success
 * - Retries on transient failure (mock fails twice, succeeds third)
 * - Throws after exhausting retries
 * - Schema error → fail fast (no retry)
 * - JSON parse error → fail fast
 * - Abort signal works
 * - Provider/usage evidence collected
 * - Fills defaults for missing optional arrays
 */

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { ModelAdapter, NormalizedRequest, NormalizedResponse } from "../../src/providers/types.js";
import type { ModelReplanContext, PlanRevisionDraft } from "../../src/kernel/replan-types.js";
import { ModelReplanAdapter, ReplanAdapterError } from "../../src/kernel/model-replan-adapter.js";
import type { ReplanAdapterOptions } from "../../src/kernel/model-replan-adapter.js";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeMinimalContext(overrides?: Partial<ModelReplanContext>): ModelReplanContext {
  return {
    runId: "run-1",
    trigger: "worker_completed",
    triggerEvidence: {
      workerId: "worker-1",
      findingIds: [],
      conflictIds: [],
      reason: "Worker completed successfully",
    },
    completedWorkers: [],
    activeConflicts: [],
    recentFindings: [],
    workerGraph: [],
    dependencyGraph: [],
    tokenBudget: { allocated: 10000, consumed: 2000, omittedFindings: 0, omittedStaleFindings: 0, omittedConflicts: 0 },
    fingerprint: "abc123",
    warnings: [],
    untrustedContent: true,
    ...overrides,
  };
}

function makeValidDraftJson(overrides?: Partial<PlanRevisionDraft>): string {
  const draft: PlanRevisionDraft = {
    triggerKind: "worker_completed",
    triggerEvidence: {
      workerId: "worker-1",
      findingIds: ["finding-1"],
      conflictIds: [],
      reason: "Worker completed successfully, proposing optimizations",
    },
    workersToAdd: [],
    workersToReplace: [],
    workersToCancel: [],
    workersToModify: [],
    dependencyRewiring: [],
    expectedBenefit: "Improved parallelism and reduced latency",
    confidence: 0.85,
    unresolvedConcerns: [],
    ...overrides,
  };
  return JSON.stringify(draft);
}

function makeValidDraft(overrides?: Partial<PlanRevisionDraft>): PlanRevisionDraft {
  return JSON.parse(makeValidDraftJson(overrides)) as PlanRevisionDraft;
}

// ─── Mock Adapter Factory ─────────────────────────────────────────────

interface MockAdapterConfig {
  /** Response text to return on success. Default: a valid draft JSON. */
  responseText?: string;
  /** Throws this error on complete() call. Overrides responseText when set. */
  throwError?: Error;
  /** If set, this many initial calls throw before succeeding. */
  failCount?: number;
  /** Error to throw for initial failures. */
  failError?: Error;
  /** Number of times complete() has been called. */
  callCount?: number;
  /** Usage to include in the response. */
  usage?: NormalizedResponse["usage"];
}

function createMockAdapter(config: MockAdapterConfig = {}): ModelAdapter {
  let failuresRemaining = config.failCount ?? 0;

  return {
    id: "mock-adapter",
    capabilities: {
      provider: "mock-provider",
      model: "mock-model-v2",
      inputTokenLimit: 128_000,
      outputTokenLimit: 4_000,
      effectiveContextBudget: 96_000,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: false,
    },
    editFormatPreference: "structured_patch",
    longContextStrategy: "trimmed_context",
    async complete(_request: NormalizedRequest): Promise<NormalizedResponse> {
      if (config.throwError) {
        throw config.throwError;
      }

      if (failuresRemaining > 0) {
        failuresRemaining--;
        throw config.failError ?? new Error("timeout: request timed out");
      }

      return {
        text: config.responseText ?? makeValidDraftJson(),
        toolCalls: [],
        usage: config.usage ?? { inputTokens: 100, outputTokens: 50 },
      };
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("ModelReplanAdapter", () => {
  let context: ModelReplanContext;

  beforeEach(() => {
    context = makeMinimalContext();
  });

  afterEach(() => {
    mock.reset();
  });

  // ── Success Path ──────────────────────────────────────────────────

  it("returns parsed draft on success", async () => {
    const adapter = new ModelReplanAdapter(createMockAdapter());
    const draft = await adapter.proposeRevision(context);

    assert.equal(draft.triggerKind, "worker_completed");
    assert.equal(draft.triggerEvidence.workerId, "worker-1");
    assert.deepEqual(draft.workersToAdd, []);
    assert.deepEqual(draft.workersToReplace, []);
    assert.deepEqual(draft.workersToCancel, []);
    assert.deepEqual(draft.workersToModify, []);
    assert.deepEqual(draft.dependencyRewiring, []);
    assert.equal(draft.expectedBenefit, "Improved parallelism and reduced latency");
    assert.equal(draft.confidence, 0.85);
    assert.deepEqual(draft.unresolvedConcerns, []);
  });

  it("works with non-empty draft fields", async () => {
    const draftJson = makeValidDraftJson({
      triggerKind: "conflict_detected",
      workersToAdd: [
        {
          draftWorkerId: "dw-1",
          taskLabel: "Investigate conflict",
          goalPrompt: "Analyze the ownership conflict and propose resolution",
          requiredCapabilities: ["file.read"],
          dependencies: ["worker-1"],
          verificationRequirements: ["conflict-free"],
        },
      ],
      workersToCancel: ["worker-2"],
      confidence: 0.72,
      unresolvedConcerns: ["May need human approval for ownership changes"],
    });
    const adapter = new ModelReplanAdapter(createMockAdapter({ responseText: draftJson }));
    const draft = await adapter.proposeRevision(context);

    assert.equal(draft.triggerKind, "conflict_detected");
    assert.equal(draft.workersToAdd.length, 1);
    assert.equal(draft.workersToAdd[0].draftWorkerId, "dw-1");
    assert.deepEqual(draft.workersToCancel, ["worker-2"]);
    assert.equal(draft.confidence, 0.72);
    assert.equal(draft.unresolvedConcerns.length, 1);
  });

  // ── Retry Behavior ────────────────────────────────────────────────

  it("retries on transient failure and succeeds on retry", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };

    const adapter = new ModelReplanAdapter(
      createMockAdapter({
        failCount: 2,
        failError: new Error("timeout: request timed out"),
      }),
      { sleep },
    );

    const draft = await adapter.proposeRevision(context);
    assert.equal(draft.confidence, 0.85);
    // Should have slept twice: 1s then 2s (exponential backoff)
    assert.equal(sleeps.length, 2);
    assert.equal(sleeps[0], 1_000);
    assert.equal(sleeps[1], 2_000);
  });

  it("retries on network error", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };

    const adapter = new ModelReplanAdapter(
      createMockAdapter({
        failCount: 1,
        failError: new Error("ECONNREFUSED connection refused"),
      }),
      { sleep },
    );

    const draft = await adapter.proposeRevision(context);
    assert.equal(draft.confidence, 0.85);
    assert.equal(sleeps.length, 1);
    assert.equal(sleeps[0], 1_000);
  });

  it("retries on 429 rate limit", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };

    const adapter = new ModelReplanAdapter(
      createMockAdapter({
        failCount: 1,
        failError: new Error("429 Too Many Requests"),
      }),
      { sleep },
    );

    const draft = await adapter.proposeRevision(context);
    assert.equal(draft.confidence, 0.85);
    assert.equal(sleeps.length, 1);
  });

  it("retries on 503 service unavailable", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };

    const adapter = new ModelReplanAdapter(
      createMockAdapter({
        failCount: 1,
        failError: new Error("503 Service Unavailable"),
      }),
      { sleep },
    );

    const draft = await adapter.proposeRevision(context);
    assert.equal(draft.confidence, 0.85);
    assert.equal(sleeps.length, 1);
  });

  it("throws after exhausting transient retries", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };

    const adapter = new ModelReplanAdapter(
      createMockAdapter({
        failCount: 10, // more than max retries
        failError: new Error("timeout: request timed out"),
      }),
      { sleep },
    );

    await assert.rejects(
      () => adapter.proposeRevision(context),
      (err: unknown) =>
        err instanceof ReplanAdapterError &&
        err.code === "max_retries_exceeded" &&
        err.message.includes("Failed after 3 attempts"),
    );

    // Max retries = 2, so we attempt 3 times total, sleeping between each
    assert.equal(sleeps.length, 2); // 2 sleeps for 3 attempts
  });

  // ── Fail Fast (No Retry) ──────────────────────────────────────────

  it("schema error → fail fast (no retry)", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    const badJson = JSON.stringify({ triggerKind: "worker_completed" }); // missing fields

    const adapter = new ModelReplanAdapter(
      createMockAdapter({ responseText: badJson }),
      { sleep },
    );

    await assert.rejects(
      () => adapter.proposeRevision(context),
      (err: unknown) =>
        err instanceof ReplanAdapterError &&
        err.code === "validation_error",
    );

    // No retries for validation errors
    assert.equal(sleeps.length, 0);
  });

  it("JSON parse error → fail fast (no retry)", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };

    const adapter = new ModelReplanAdapter(
      createMockAdapter({ responseText: "not valid json" }),
      { sleep },
    );

    await assert.rejects(
      () => adapter.proposeRevision(context),
      (err: unknown) =>
        err instanceof ReplanAdapterError &&
        err.code === "parse_error",
    );

    // No retries for parse errors
    assert.equal(sleeps.length, 0);
  });

  it("invalid triggerKind → fail fast (no retry)", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    const badJson = makeValidDraftJson({ triggerKind: "invalid_trigger" as never });

    const adapter = new ModelReplanAdapter(
      createMockAdapter({ responseText: badJson }),
      { sleep },
    );

    await assert.rejects(
      () => adapter.proposeRevision(context),
      (err: unknown) =>
        err instanceof ReplanAdapterError &&
        err.code === "validation_error" &&
        err.message.includes("Invalid triggerKind"),
    );

    assert.equal(sleeps.length, 0);
  });

  it("confidence out of range → fail fast", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    const badJson = makeValidDraftJson({ confidence: 42 });

    const adapter = new ModelReplanAdapter(
      createMockAdapter({ responseText: badJson }),
      { sleep },
    );

    await assert.rejects(
      () => adapter.proposeRevision(context),
      (err: unknown) =>
        err instanceof ReplanAdapterError &&
        err.code === "validation_error" &&
        err.message.includes("confidence"),
    );

    assert.equal(sleeps.length, 0);
  });

  // ── Abort Signal ──────────────────────────────────────────────────

  it("abort signal works before request", async () => {
    const adapter = new ModelReplanAdapter(createMockAdapter());
    const ac = new AbortController();
    ac.abort();

    await assert.rejects(
      () => adapter.proposeRevision(context, ac.signal),
      (err: unknown) =>
        err instanceof ReplanAdapterError &&
        err.code === "aborted",
    );
  });

  it("abort signal cancels a pending request", async () => {
    // A mock that never resolves
    const neverAdapter: ModelAdapter = {
      id: "mock-hanging",
      capabilities: {
        provider: "mock",
        model: "mock-hanging",
        inputTokenLimit: 32_000,
        outputTokenLimit: 4_000,
        supportsTools: false,
        supportsStreaming: false,
        supportsStructuredOutput: true,
        supportsVision: false,
      },
      editFormatPreference: "structured_patch",
      longContextStrategy: "trimmed_context",
      complete: () => new Promise<never>(() => {}), // never resolves
    };

    const adapter = new ModelReplanAdapter(neverAdapter);
    const ac = new AbortController();

    // Schedule abort after a tick
    const promise = adapter.proposeRevision(context, ac.signal);
    ac.abort();

    await assert.rejects(
      () => promise,
      (err: unknown) =>
        err instanceof ReplanAdapterError &&
        err.code === "aborted",
    );
  });

  it("abort signal checked after response", async () => {
    // Mock that succeeds but we abort before processing
    let aborted = false;
    const adapter = new ModelReplanAdapter(createMockAdapter());
    const ac = new AbortController();

    // We'll manually check by passing a signal that gets aborted during processing
    const promise = adapter.proposeRevision(context, ac.signal);
    ac.abort();

    await assert.rejects(
      () => promise,
      (err: unknown) =>
        err instanceof ReplanAdapterError &&
        err.code === "aborted",
    );
  });

  // ── Evidence ──────────────────────────────────────────────────────

  it("collects provider/model/usage evidence", async () => {
    const adapter = new ModelReplanAdapter(
      createMockAdapter({
        usage: { inputTokens: 250, outputTokens: 120 },
      }),
    );

    await adapter.proposeRevision(context);

    assert.ok(adapter.lastEvidence);
    assert.equal(adapter.lastEvidence!.provider, "mock-provider");
    assert.equal(adapter.lastEvidence!.model, "mock-model-v2");
    assert.deepEqual(adapter.lastEvidence!.usage, { inputTokens: 250, outputTokens: 120 });
  });

  it("updates evidence on each call", async () => {
    const adapter = new ModelReplanAdapter(
      createMockAdapter({
        usage: { inputTokens: 100, outputTokens: 50 },
      }),
    );

    await adapter.proposeRevision(context);
    assert.equal(adapter.lastEvidence!.usage!.inputTokens, 100);

    // Second call with different usage
    const adapter2 = new ModelReplanAdapter(
      createMockAdapter({
        usage: { inputTokens: 200, outputTokens: 80 },
      }),
    );
    await adapter2.proposeRevision(context);
    assert.equal(adapter2.lastEvidence!.usage!.inputTokens, 200);
  });

  it("evidence is missing usage when response has none", async () => {
    const noUsageAdapter = createMockAdapter();
    // Override to return no usage
    const originalComplete = noUsageAdapter.complete;
    noUsageAdapter.complete = async (req) => {
      const resp = await originalComplete(req);
      return { ...resp, usage: undefined };
    };

    const adapter = new ModelReplanAdapter(noUsageAdapter);
    await adapter.proposeRevision(context);

    assert.ok(adapter.lastEvidence);
    assert.equal(adapter.lastEvidence!.provider, "mock-provider");
    assert.equal(adapter.lastEvidence!.model, "mock-model-v2");
    assert.equal(adapter.lastEvidence!.usage, undefined);
  });

  // ── Defaults for Missing Optional Arrays ──────────────────────────

  it("fills defaults for all missing optional array fields", async () => {
    const partialJson = JSON.stringify({
      triggerKind: "worker_failed",
      triggerEvidence: {
        workerId: "worker-3",
        findingIds: [],
        conflictIds: [],
        reason: "Worker failed with transient error",
      },
      expectedBenefit: "Recover from failure",
      confidence: 0.6,
      // All optional arrays are missing
    });

    const adapter = new ModelReplanAdapter(
      createMockAdapter({ responseText: partialJson }),
    );

    const draft = await adapter.proposeRevision(context);

    assert.equal(draft.triggerKind, "worker_failed");
    assert.deepEqual(draft.workersToAdd, []);
    assert.deepEqual(draft.workersToReplace, []);
    assert.deepEqual(draft.workersToCancel, []);
    assert.deepEqual(draft.workersToModify, []);
    assert.deepEqual(draft.dependencyRewiring, []);
    assert.deepEqual(draft.unresolvedConcerns, []);
  });

  it("fills defaults for null array fields", async () => {
    const partialJson = JSON.stringify({
      triggerKind: "manual",
      triggerEvidence: {
        workerId: "worker-0",
        findingIds: [],
        conflictIds: [],
        reason: "Manual replan",
      },
      workersToAdd: null,
      workersToReplace: null,
      workersToCancel: null,
      workersToModify: null,
      dependencyRewiring: null,
      expectedBenefit: "Manual override",
      confidence: 0.95,
      unresolvedConcerns: null,
    });

    const adapter = new ModelReplanAdapter(
      createMockAdapter({ responseText: partialJson }),
    );

    const draft = await adapter.proposeRevision(context);

    assert.deepEqual(draft.workersToAdd, []);
    assert.deepEqual(draft.workersToCancel, []);
    assert.deepEqual(draft.unresolvedConcerns, []);
  });

  // ── Non-Transient Errors ──────────────────────────────────────────

  it("non-transient errors from complete() fail immediately", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };

    const adapter = new ModelReplanAdapter(
      createMockAdapter({
        throwError: new Error("unauthorized: invalid API key"),
      }),
      { sleep },
    );

    await assert.rejects(
      () => adapter.proposeRevision(context),
      (err: unknown) =>
        err instanceof ReplanAdapterError &&
        err.code === "transient_failure" &&
        err.message.includes("unauthorized"),
    );

    // No retries for auth errors
    assert.equal(sleeps.length, 0);
  });

  // ── MaxTokens Option ──────────────────────────────────────────────

  it("uses custom maxTokens from options", async () => {
    let capturedRequest: NormalizedRequest | undefined;

    const capturingAdapter: ModelAdapter = {
      id: "mock-capture",
      capabilities: {
        provider: "mock",
        model: "mock-capture",
        inputTokenLimit: 32_000,
        outputTokenLimit: 8_000,
        supportsTools: false,
        supportsStreaming: false,
        supportsStructuredOutput: true,
        supportsVision: false,
      },
      editFormatPreference: "structured_patch",
      longContextStrategy: "trimmed_context",
      async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
        capturedRequest = request;
        return { text: makeValidDraftJson(), toolCalls: [] };
      },
    };

    const adapter = new ModelReplanAdapter(capturingAdapter, { maxTokens: 8000 });
    await adapter.proposeRevision(context);

    assert.ok(capturedRequest);
    assert.equal(capturedRequest!.maxOutputTokens, 8000);
  });

  // ── Empty Draft ───────────────────────────────────────────────────

  it("handles an empty 'no changes needed' draft", async () => {
    const emptyJson = makeValidDraftJson({
      workersToAdd: [],
      workersToReplace: [],
      workersToCancel: [],
      workersToModify: [],
      dependencyRewiring: [],
      expectedBenefit: "No changes needed",
      confidence: 0.95,
      unresolvedConcerns: [],
    });

    const adapter = new ModelReplanAdapter(
      createMockAdapter({ responseText: emptyJson }),
    );

    const draft = await adapter.proposeRevision(context);
    assert.equal(draft.expectedBenefit, "No changes needed");
    assert.equal(draft.confidence, 0.95);
  });

  // ── ModelAdapter.id used as evidence source ───────────────────────

  it("uses modelAdapter.capabilities for evidence", async () => {
    const customAdapter: ModelAdapter = {
      id: "custom-adapter",
      capabilities: {
        provider: "anthropic",
        model: "claude-4-opus",
        inputTokenLimit: 200_000,
        outputTokenLimit: 8_000,
        supportsTools: true,
        supportsStreaming: true,
        supportsStructuredOutput: true,
        supportsVision: true,
      },
      editFormatPreference: "structured_patch",
      longContextStrategy: "expanded_context",
      async complete() {
        return {
          text: makeValidDraftJson(),
          toolCalls: [],
          usage: { inputTokens: 500, outputTokens: 200 },
        };
      },
    };

    const adapter = new ModelReplanAdapter(customAdapter);
    await adapter.proposeRevision(context);

    assert.equal(adapter.lastEvidence!.provider, "anthropic");
    assert.equal(adapter.lastEvidence!.model, "claude-4-opus");
    assert.equal(adapter.lastEvidence!.usage!.inputTokens, 500);
    assert.equal(adapter.lastEvidence!.usage!.outputTokens, 200);
  });
});
