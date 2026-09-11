/**
 * fakes/langfuse-sdk.ts — shared fake recorder for the tracing test suites
 * (v5/OTel surface, rewritten 2026-09-09).
 *
 * The v3-era fake mocked the `langfuse` SDK (`new Langfuse().trace()/…`) and
 * recorded trace/generation/span bodies. The v5 adapter drives `@langfuse/tracing`
 * (REAL — it emits OTel spans through the isolated tracer provider the adapter
 * wires up) and `@langfuse/otel` (the only mocked module). This file provides a
 * recording `LangfuseSpanProcessor` that mirrors the real one's `onStart`
 * (copies propagated trace-level attributes onto the span) and captures the
 * ended OTel span in `fakeRecorder.instances[*].spans`.
 *
 * Consumers register the mock with:
 *
 *     import {
 *       alixOf,
 *       attrOf,
 *       FakeLangfuseSpanProcessor,
 *       fakeRecorder,
 *       observationsOf,
 *       resetFakeCalls,
 *       rootSpanOf,
 *       spansOfTrace,
 *     } from "./fakes/langfuse-sdk.js";
 *     vi.mock("@langfuse/otel", () => ({
 *       LangfuseSpanProcessor: FakeLangfuseSpanProcessor,
 *     }));
 *
 * Import `@langfuse/otel` must NOT be mocked anywhere the recorder is registered
 * with a different factory (only `tracing-disabled-misconfigured.vitest.ts`
 * re-registers it via per-scenario `vi.doMock` — see that file). The adapter is
 * only ever dynamically imported (inside `createTraceClient`'s enabled branch),
 * so `@langfuse/otel` is also only ever dynamically imported: `vi.mock` (not
 * `vi.hoisted`) works. Do NOT static-import
 * `src/tracing/langfuse-client.js` in any file that also registers this mock
 * (hoisting TDZ).
 *
 * How the recording works: the REAL `@langfuse/tracing` `startObservation`
 * calls `getLangfuseTracer().startSpan(...)`; the adapter has registered an
 * isolated `BasicTracerProvider` whose span-processor chain contains this fake,
 * so every observation the adapter creates ends up here — span name, OTel
 * status, start/end time, and the `langfuse.observation.*` attributes written
 * by the SDK, plus the propagated trace-level attributes (`session.id`,
 * `langfuse.trace.name`, …) this fake copies in `onStart` exactly like the real
 * `LangfuseSpanProcessor`.
 *
 * Exactly-once vs the v3 `rawEndCalls` unguarded counter: the v3 fake counted
 * every SDK-level `end()` before the adapter's guard could swallow a repeat.
 * OTel spans dedupe their own `end()` (a second call is a no-op — the SDK never
 * re-invokes `onEnd`), so that unguarded site no longer exists. v5 exactly-once
 * is locked two ways: (1) every recorded span in `spans` IS an ended span, so a
 * balanced per-runId observation count proves one terminal per logical span,
 * no orphan, no duplicate; (2) the adapter-side guard (repeated `endSpan` after
 * the first terminal end no-ops) is pinned directly in
 * `tests/tracing/langfuse-client.vitest.ts`, whose superset fake re-mocks both
 * `@langfuse/tracing` AND `@langfuse/otel` and keeps an unguarded per-observation
 * `endCount`.
 */

import {
  getPropagatedAttributesFromContext,
} from "@langfuse/core";
import type { Attributes, Context, Span } from "@opentelemetry/api";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";

export interface FakeObservedSpan {
  /** The observation/span name (model for generations, tool name for tools, task/runId for roots). */
  name: string;
  /** OTel span attributes as recorded at span end (includes `langfuse.observation.*` + propagated). */
  attributes: Record<string, unknown>;
  /** Trace-level attributes propagated at span start (`session.id`, `langfuse.trace.name`, …). */
  propagated: Record<string, unknown>;
  /** OTel status at span end (code 0 = UNSET, 1 = OK, 2 = ERROR on the SpanStatusCode enum). */
  status: { code: number; message: string };
  /** OTel hex trace id — shared by every observation of one run (the run's root span trace). */
  traceId: string;
  /** OTel hex span id. */
  spanId: string;
  /** Parent span id (the run root's span id) for child observations; undefined for the root. */
  parentSpanId: string | undefined;
  /** Epoch ms at span start. */
  startTimeMs: number;
  /** Epoch ms at span end. */
  endTimeMs: number;
}

/** OTel `ReadableSpan` time rows (seconds + nanos) → epoch ms. */
function hrToMs(hrTime: [number, number]): number {
  return hrTime[0] * 1000 + hrTime[1] / 1_000_000;
}

/** A single configuration of the recording span processor (one per real adapter construction). */
export interface FakeLangfuseSpanProcessorInstance {
  options: Record<string, unknown>;
  spans: FakeObservedSpan[];
  flushCalls: number;
  shutdownCalls: number;
}

/** Empty all recorded spans + transport counters on a processor (per-scenario delta baseline). */
export function resetFakeCalls(processor: FakeLangfuseSpanProcessorInstance): void {
  processor.spans.length = 0;
  processor.flushCalls = 0;
  processor.shutdownCalls = 0;
}

// ---------------------------------------------------------------------------
// Observation views (assertion helpers over recorded spans)
// ---------------------------------------------------------------------------

/** The parsed `metadata.alix` payload carried by every ALiX observation. */
export function alixOf(span: FakeObservedSpan): Record<string, unknown> {
  const raw = span.attributes["langfuse.observation.metadata.alix"];
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** JSON-parse a stored attribute value (metadata/usage/input/output are serialized). */
function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** Convenience accessor: parse a single `langfuse.observation.*` attribute. */
export function attrOf(
  span: FakeObservedSpan,
  key: string,
): unknown {
  return jsonValue(span.attributes[`langfuse.observation.${key}`]);
}

/**
 * The run root observation (the one observation with no parent span).
 * The root is the single observation carrying `metadata.alix.kind === "run"`
 * and the run's `runId` — child observations group under it via OTel traceId.
 */
export function rootSpanOf(
  processor: FakeLangfuseSpanProcessorInstance,
  runId: string,
): FakeObservedSpan | undefined {
  return processor.spans.find(
    (span) =>
      !span.parentSpanId &&
      (alixOf(span) as { kind?: unknown }).kind === "run" &&
      (alixOf(span) as { runId?: unknown }).runId === runId,
  );
}

/**
 * All observations of one ALiX run: the run root plus every descendant sharing
 * its OTel trace id (the root carries `metadata.alix.runId`; children group by
 * traceId). Returns [] when no root observation exists for the runId.
 */
export function observationsOf(
  processor: FakeLangfuseSpanProcessorInstance,
  runId: string,
): FakeObservedSpan[] {
  const root = rootSpanOf(processor, runId);
  if (!root) return [];
  return spansOfTrace(processor, root.traceId);
}

/** All observations sharing one OTel trace id (root + descendants). */
export function spansOfTrace(
  processor: FakeLangfuseSpanProcessorInstance,
  traceId: string,
): FakeObservedSpan[] {
  return processor.spans.filter((span) => span.traceId === traceId);
}

// ---------------------------------------------------------------------------
// Recording span processor
// ---------------------------------------------------------------------------

/**
 * Fake `LangfuseSpanProcessor` (the `@langfuse/otel` class) — records every
 * observation the real adapter creates, mirroring the real processor's `onStart`
 * (copies propagated trace-level attributes onto the live span) so the ended
 * snapshot carries `session.id`/`langfuse.trace.name` like a real export would.
 */
const startedPropagated = new WeakMap<Span, Record<string, unknown>>();

export class FakeLangfuseSpanProcessor
  implements SpanProcessor, FakeLangfuseSpanProcessorInstance
{
  readonly options: Record<string, unknown>;
  readonly spans: FakeObservedSpan[] = [];
  flushCalls = 0;
  shutdownCalls = 0;
  onStartCalls = 0;

  constructor(options?: Record<string, unknown>) {
    this.options = options ?? {};
    recorder.instances.push(this);
  }

  onStart(span: Span, parentContext: Context): void {
    this.onStartCalls++;
    const propagated = getPropagatedAttributesFromContext(
      parentContext,
    ) as unknown as Record<string, unknown>;
    startedPropagated.set(span, propagated);
    span.setAttributes(propagated as Attributes);
  }

  onEnd(span: ReadableSpan): void {
    const spanContext = span.spanContext();
    this.spans.push({
      name: span.name,
      attributes: { ...span.attributes },
      propagated: startedPropagated.get(span as unknown as Span) ?? {},
      status: { code: span.status.code, message: span.status.message ?? "" },
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      parentSpanId: span.parentSpanContext?.spanId,
      startTimeMs: hrToMs(span.startTime),
      endTimeMs: hrToMs(span.endTime),
    });
  }

  async forceFlush(): Promise<void> {
    this.flushCalls++;
  }

  async shutdown(): Promise<void> {
    this.shutdownCalls++;
  }
}

const recorder: { instances: FakeLangfuseSpanProcessorInstance[] } = {
  instances: [],
};

export const fakeRecorder = recorder;