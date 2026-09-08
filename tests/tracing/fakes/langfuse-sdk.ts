/**
 * fakes/langfuse-sdk.ts — shared `vi.mock('langfuse')` fake SDK recorder for the
 * tracing test suites. Extracted from the inline copies in
 * `tests/tracing/tracing-e2e-wiring.vitest.ts` (Task 16) and
 * `tests/tracing/tracing-streaming-exactly-once.vitest.ts` (Task 17) on first use
 * by a THIRD consumer, `tests/tracing/tracing-tool-exactly-once.vitest.ts`
 * (Task 18).
 *
 * Every `new Langfuse(...)` the real `LangfuseTraceClient` performs is recorded
 * in `fakeRecorder.instances`; calling into the returned trace/generation/span
 * objects records start/end operations keyed by the ALiX runId (which the
 * adapter uses as the Langfuse trace id).
 *
 * Consumers register the mock with:
 *
 *     import { FakeLangfuse, fakeRecorder } from "./fakes/langfuse-sdk.js";
 *     vi.mock("langfuse", () => ({ default: FakeLangfuse }));
 *
 * No `vi.hoisted` wrapper is needed: `langfuse` is only ever dynamically
 * imported (inside `createTraceClient`'s enabled branch, client-factory.ts), so
 * the mock factory is invoked AFTER module init and the plain imported binding
 * is fully initialized. Do NOT static-import `src/tracing/langfuse-client.js`
 * in any file that also registers this mock (hoisting TDZ).
 *
 * Double-close observability (Task 18; Task 17 review note 1): `FakeSpan.end()`
 * / `FakeGeneration.end()` increment `rawEndCalls.span` / `.generation`
 * UNGUARDED, before any other bookkeeping. The real adapter guards repeated
 * endSpan calls (langfuse-client.ts endSpan no-ops after the first terminal
 * end), so the recorded `spanEnds`/`generationEnds` arrays alone cannot
 * distinguish "ended once" from "ended twice, second swallowed" — the guard
 * erases the evidence. `rawEndCalls` counts every SDK-level end() invocation;
 * exactly-once tests assert it stays `1` to prove the seam truly ends once. The
 * adapter-side guard itself is covered separately by
 * `tests/tracing/langfuse-client.vitest.ts` (repeated endSpan no-op after the
 * first terminal end).
 */

export interface FakeCalls {
  traces: Array<Record<string, unknown>>;
  traceUpdates: Array<{ id?: string; body: Record<string, unknown> }>;
  generations: Array<{ traceId?: string; body: Record<string, unknown> }>;
  generationEnds: Array<{ traceId?: string; body: Record<string, unknown> }>;
  spans: Array<{ traceId?: string; body: Record<string, unknown> }>;
  spanEnds: Array<{ traceId?: string; body: Record<string, unknown> }>;
}

export interface FakeRawEndCalls {
  /** Unguarded count of every `FakeSpan.end()` invocation on this SDK instance. */
  span: number;
  /** Unguarded count of every `FakeGeneration.end()` invocation on this SDK instance. */
  generation: number;
}

export interface FakeLangfuseInstance {
  options: Record<string, unknown>;
  calls: FakeCalls;
  flushCalls: number;
  shutdownCalls: number;
  rawEndCalls: FakeRawEndCalls;
}

/** Empty all recorded call arrays + raw end counters on an SDK instance (per-scenario delta baseline). */
export function resetFakeCalls(sdk: FakeLangfuseInstance): void {
  sdk.calls.traces.length = 0;
  sdk.calls.traceUpdates.length = 0;
  sdk.calls.generations.length = 0;
  sdk.calls.generationEnds.length = 0;
  sdk.calls.spans.length = 0;
  sdk.calls.spanEnds.length = 0;
  sdk.rawEndCalls.span = 0;
  sdk.rawEndCalls.generation = 0;
  sdk.flushCalls = 0;
  sdk.shutdownCalls = 0;
}

export class FakeLangfuse {
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
  rawEndCalls: FakeRawEndCalls = { span: 0, generation: 0 };

  constructor(options: Record<string, unknown>) {
    this.options = options;
    recorder.instances.push(this as unknown as FakeLangfuseInstance);
  }

  trace(body: Record<string, unknown>): FakeTrace {
    this.calls.traces.push(body);
    return new FakeTrace(this, body);
  }

  async flushAsync(): Promise<void> {
    this.flushCalls++;
  }

  async shutdownAsync(): Promise<void> {
    this.shutdownCalls++;
  }
}

export class FakeTrace {
  constructor(
    readonly owner: FakeLangfuse,
    readonly body: Record<string, unknown>,
  ) {}

  update(body: Record<string, unknown>): FakeTrace {
    this.owner.calls.traceUpdates.push({ id: this.body.id as string, body });
    return this;
  }

  generation(body: Record<string, unknown>): FakeGeneration {
    const traceId = this.body.id as string;
    this.owner.calls.generations.push({ traceId, body });
    return new FakeGeneration(this.owner, traceId);
  }

  span(body: Record<string, unknown>): FakeSpan {
    const traceId = this.body.id as string;
    this.owner.calls.spans.push({ traceId, body });
    return new FakeSpan(this.owner, traceId);
  }
}

export class FakeGeneration {
  constructor(
    readonly owner: FakeLangfuse,
    readonly traceId: string,
  ) {}

  end(body: Record<string, unknown>): FakeGeneration {
    this.owner.rawEndCalls.generation++;
    this.owner.calls.generationEnds.push({ traceId: this.traceId, body });
    return this;
  }
}

export class FakeSpan {
  constructor(
    readonly owner: FakeLangfuse,
    readonly traceId: string,
  ) {}

  end(body: Record<string, unknown>): FakeSpan {
    this.owner.rawEndCalls.span++;
    this.owner.calls.spanEnds.push({ traceId: this.traceId, body });
    return this;
  }
}

const recorder: { instances: FakeLangfuseInstance[] } = { instances: [] };

export const fakeRecorder = recorder;