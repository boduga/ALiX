/**
 * src/tracing/langfuse-client.ts
 *
 * The Langfuse v5 (OpenTelemetry-based) SDK adapter — the ONLY file in the repo
 * allowed to import the Langfuse packages (`@langfuse/tracing`,
 * `@langfuse/otel`) or their OpenTelemetry dependencies (`@opentelemetry/*`)
 * (design §1, src/tracing/AGENTS.md). Every other module depends on the
 * provider-agnostic {@link TraceClient} facade; replacing Langfuse means
 * replacing this file, the dependency, and config — never the runtime seams.
 *
 * The adapter translates ALiX-run semantics into Langfuse observations:
 *
 * - one ALiX runId  → one trace = one root *span observation* (the app root)
 * - one physical model request → one Langfuse *generation* observation
 * - one physical tool call → one Langfuse *span* observation
 *
 * v5 (migrated from the v3 SDK on 2026-09-09): instead of `langfuse.trace()/…`
 * it drives `@langfuse/tracing`'s observation model — `startObservation` for
 * non-active, explicitly-linked spans, `propagateAttributes` to attach
 * trace-level attributes (traceName, sessionId) to every observation, and an
 * isolated OTel `BasicTracerProvider` registered with a `LangfuseSpanProcessor`
 * (`exportMode: "immediate"` so short-lived CLI processes export each span as
 * it ends rather than depending on a batch flush that a fast exit could drop).
 *
 * ALiX statuses are kept in `metadata.alix.status`; Langfuse `level`/
 * `statusMessage` are derived (success/cancelled → DEFAULT; error → ERROR).
 * Langfuse has no "cancelled" level, so a cancelled span/run stays DEFAULT and
 * carries the cancellation in `metadata.alix.status`. The run's display name is
 * the captured task (traceName); its OTel trace id is opaque and derives from
 * the SDK — ALiX correlation always goes through `metadata.alix.runId` and the
 * shared `sessionId`, never through a consumer-visible trace id.
 *
 * All input/output/args payloads pass through the capture policy
 * (src/tracing/capture.ts) before reaching the SDK: mandatory redaction runs
 * before truncation and can never be bypassed (design §6-8). Identity fields
 * (runId/actor/provider/… ids) are not payload text and are recorded as-is.
 *
 * Failure contract (design §11-12): lifecycle methods are synchronous, cheap,
 * enqueue-only, and NEVER throw into agent execution — except `endRun`, which
 * finalizes the run trace synchronously and then awaits a flush bounded by
 * `flushTimeoutMs` (design §12): resolve/timeout/reject all continue and never
 * change the run's outcome nor delay ALiX beyond the budget. `flush()` is
 * bounded the same way and never rejects; `shutdown()` (Task 14) is bounded by
 * the SAME `flushTimeoutMs` (scheduled from the flush budget, never a second
 * budget stacked on top — plan Task 13 note), never rejects, and is idempotent
 * (a repeated call is a no-op). The bounded wait is applied in this adapter;
 * callers just `await endRun`/`flush`/`shutdown`. Construction MAY throw on a genuinely
 * invalid config (missing baseUrl, non-http(s) baseUrl, empty keys, leftover
 * unresolved `cred://` refs) — the factory (Task 9) catches it → warn-once →
 * Noop.
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md
 * Created by: Task 7 (implement the Langfuse adapter) of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 * Parent-run translation added by Task 8 of the same plan.
 * v5/OTel rewrite: 2026-09-09 (self-hosted Langfuse 4.9 `events_only` gateway
 *   requirements — see src/tracing/AGENTS.md).
 */

import { context as otelContext, SpanStatusCode } from "@opentelemetry/api";
import type { SpanContext } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import type {
  LangfuseGeneration,
  LangfuseGenerationAttributes,
  LangfuseSpan,
  LangfuseSpanAttributes,
} from "@langfuse/tracing";
import {
  propagateAttributes,
  setLangfuseTracerProvider,
  startObservation,
} from "@langfuse/tracing";
import { LangfuseSpanProcessor } from "@langfuse/otel";

import type { TracingConfig } from "../config/schema.js";
import {
  captureMessages,
  captureString,
  captureToolArgs,
  type CaptureLevel,
} from "./capture.js";
import type { TraceClient } from "./client.js";
import { NOOP_SPAN } from "./noop-client.js";
import type {
  ModelSpanInput,
  RunOutcome,
  SpanOutcome,
  SpanStatus,
  ToolSpanInput,
  TraceRun,
  TraceRunInput,
  TraceSpan,
} from "./types.js";
import { warnOnce } from "./warn-once.js";
import { withTimeout } from "./with-timeout.js";

// ---------------------------------------------------------------------------
// Module helpers
// ---------------------------------------------------------------------------

/**
 * Stable warn-once key so a flush (or shutdown) transport failure is reported
 * at most once per process even though the message may embed varying detail.
 */
const FLUSH_WARN_KEY = "langfuse-client:flush-transport-failure";

/**
 * Stable warn-once key so a shutdown transport failure is reported at most once
 * per process (distinct from the flush key — each phase warns at most once).
 */
const SHUTDOWN_WARN_KEY = "langfuse-client:shutdown-transport-failure";

/** A frozen run handle whose only readable state is the ALiX runId. */
function makeRunHandle(runId: string): TraceRun {
  return Object.freeze({ runId }) as unknown as TraceRun;
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Epoch ms → Date for v5 startTime/endTime, else undefined. */
function toDate(ms?: number): Date | undefined {
  return isFiniteNumber(ms) ? new Date(ms) : undefined;
}

function durationMs(startedAt?: number, endedAt?: number): number | undefined {
  if (!isFiniteNumber(startedAt) || !isFiniteNumber(endedAt)) return undefined;
  if (endedAt < startedAt) return undefined;
  return endedAt - startedAt;
}

/** Drop `undefined`-valued keys so optional SDK/metadata fields are omitted. */
function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}

/**
 * ALiX metadata attached to a model generation. Extracted from the class so
 * the builder is a pure function of its input (S5: honest module helpers).
 */
function buildModelAlix(input: ModelSpanInput): Record<string, unknown> {
  return {
    kind: "model",
    ...defined({
      provider: input.provider,
      model: input.model,
      resolvedModel: input.resolvedModel,
      invocationId: input.invocationId,
      stream: input.stream,
      startedAtMs: input.startedAt,
    }),
  };
}

/** ALiX metadata attached to a tool span (S5: pure module helper). */
function buildToolAlix(input: ToolSpanInput): Record<string, unknown> {
  return {
    kind: "tool",
    toolName: input.toolName,
    ...defined({
      capability: input.capability,
      toolCallId: input.toolCallId,
      invocationId: input.invocationId,
      executionId: input.executionId,
      startedAtMs: input.startedAt,
    }),
  };
}

/**
 * v5 usageDetails body from token counts; omitted when neither is finite.
 * (The v3 `unit: "TOKENS"` field does not exist on v5 `usageDetails` — token
 * pricing is derived server-side from the model.)
 */
function buildUsage(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): { input: number; output: number } | undefined {
  if (!isFiniteNumber(inputTokens) && !isFiniteNumber(outputTokens)) {
    return undefined;
  }
  return {
    input: inputTokens ?? 0,
    output: outputTokens ?? 0,
  };
}

function flushWarning(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `[Tracing] flush failed (tracing transport error; agent execution continues): ${detail}`;
}

function shutdownWarning(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `[Tracing] shutdown failed (tracing transport error; process exit continues): ${detail}`;
}

/**
 * Bounded, fail-open transport wait shared by `flush()` and `shutdown()`
 * (S3: one shape instead of two near-identical bodies). Invokes the SDK call
 * outside the wait so a synchronous throw is caught and warned once; absorbs
 * rejections that settle after we have stopped awaiting (post-timeout), and
 * warns once (key-deduped) on a pre-budget rejection. Internal to the adapter.
 */
async function boundedTransport(
  budgetMs: number,
  invoke: () => Promise<void>,
  warn: (error: unknown) => string,
  warnKey: string,
): Promise<void> {
  let op: Promise<void>;
  try {
    op = invoke();
  } catch (error) {
    // A synchronous throw from the SDK (never expected). Warn once and
    // continue — a transport failure must never change an ALiX outcome.
    warnOnce(warn(error), warnKey);
    return;
  }
  // Absorb a rejection that settles AFTER we have stopped awaiting (timeout):
  // fail-open transport ignores late failures, so one must never surface as
  // an unhandled rejection. The pre-timeout rejection path is handled by the
  // wait below.
  op.catch(() => {
    // handled by the wait below; this branch only absorbs post-timeout settles
  });
  try {
    await withTimeout(op, budgetMs);
  } catch (error) {
    warnOnce(warn(error), warnKey);
  }
}

// ---------------------------------------------------------------------------
// Status → Langfuse semantics
// ---------------------------------------------------------------------------

/**
 * Langfuse observation level for a terminal status. Langfuse has no
 * "cancelled" level — cancellation is a normal (non-failure) terminal, so it
 * maps to DEFAULT and the ALiX status is preserved in `metadata.alix.status`.
 */
function levelForStatus(status: SpanStatus): "DEFAULT" | "ERROR" {
  return status === "error" ? "ERROR" : "DEFAULT";
}

// ---------------------------------------------------------------------------
// Active-run registry + span handles
// ---------------------------------------------------------------------------

/**
 * Per-run state. `root` is the run's root span observation, or null when root
 * creation failed fail-soft (spans become noops). The OTel span context of the
 * root is the parent context every child observation in this run links to.
 */
interface RunRecord {
  readonly input: TraceRunInput;
  readonly root: LangfuseSpan | null;
  readonly handle: TraceRun;
  /** `metadata.alix` identity keys, re-emitted on end (update replaces). */
  readonly alix: Record<string, unknown>;
  /** Resolved session for the run (explicit or parent-inherited), re-propagated onto every observation. */
  readonly sessionId: string | undefined;
}

type SpanKind = "model" | "tool";

interface SpanRecord {
  readonly kind: SpanKind;
  readonly input: ModelSpanInput | ToolSpanInput;
  readonly sdk: LangfuseGeneration | LangfuseSpan;
  /** `metadata.alix` identity keys, re-emitted on end. */
  readonly alix: Record<string, unknown>;
  /** Terminal state: repeated endSpan must not enqueue a second terminal op. */
  ended: boolean;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Langfuse-backed {@link TraceClient}.
 *
 * @remarks
 * ALiX handles (TraceRun/TraceSpan) map internally to Langfuse observation
 * wrappers; those SDK objects, their ids, and the OTel trace id never escape.
 * Spans are created as direct children of the run's root observation — no
 * parent/child is inferred from call order (design §21/§22). Run-level parent
 * linkage (Task 8, design §23) translates an explicit in-process `parentRunId`
 * into a shared Langfuse session between the two traces (see `startRun`); it
 * never merges traces and never invents identity.
 *
 * @param config — resolved `tracing` config section. Constructed by the
 * factory (Task 9) only when `enabled === true`; may throw on invalid config.
 */
export class LangfuseTraceClient implements TraceClient {
  private readonly processor: LangfuseSpanProcessor;

  /** Capture levels/limits resolved from config (single source: src/config). */
  private readonly messagesLevel: CaptureLevel;
  private readonly reasoningLevel: CaptureLevel;
  private readonly toolInputLevel: CaptureLevel;
  private readonly toolOutputLevel: CaptureLevel;
  private readonly maxMessageChars: number;
  private readonly maxToolOutputChars: number;
  /** Bounded-flush budget (design §12): max wait for transport before ALiX continues. */
  private readonly flushTimeoutMs: number;

  private readonly runsByRunId = new Map<string, RunRecord>();
  private readonly recordByRun = new WeakMap<object, RunRecord>();
  private readonly recordBySpan = new WeakMap<object, SpanRecord>();
  private shutdownDone = false;

  constructor(config: TracingConfig) {
    if (config.enabled !== true) {
      throw new Error(
        "LangfuseTraceClient requires tracing.enabled === true; construct it only when tracing is enabled",
      );
    }

    const langfuse = config.langfuse;
    const baseUrl = (langfuse?.baseUrl ?? "").trim();
    const publicKey = (langfuse?.publicKey ?? "").trim();
    const secretKey = langfuse?.secretKey ?? "";

    // Genuine invalid-config throw → factory (Task 9) catches → warn-once Noop
    // (design §11). Never a transient/network condition. Validated BEFORE any
    // SDK/provider construction so a bad config never wires a provider.
    if (baseUrl.length === 0) {
      throw new Error(
        "LangfuseTraceClient: tracing.langfuse.baseUrl is empty; set it to your Langfuse instance URL",
      );
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(baseUrl);
    } catch {
      throw new Error(
        `LangfuseTraceClient: tracing.langfuse.baseUrl is not a valid URL: ${baseUrl}`,
      );
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error(
        `LangfuseTraceClient: tracing.langfuse.baseUrl must be http(s), got ${parsedUrl.protocol}`,
      );
    }
    if (publicKey.length === 0 || secretKey.length === 0) {
      throw new Error(
        "LangfuseTraceClient: tracing.langfuse.publicKey/secretKey are required when tracing is enabled",
      );
    }
    // Config load (Task 6) leaves unresolved `cred://` references in place and
    // warns; a leftover reference is an unresolvable credential (design §11).
    if (publicKey.startsWith("cred://") || secretKey.startsWith("cred://")) {
      throw new Error(
        "LangfuseTraceClient: tracing.langfuse credential references are unresolved " +
          "(store them with `alix credential set langfuse …`)",
      );
    }

    const capture = config.capture;
    this.messagesLevel = capture?.messages ?? "truncated";
    this.reasoningLevel = capture?.reasoning ?? "off";
    this.toolInputLevel = capture?.toolInput ?? "truncated";
    this.toolOutputLevel = capture?.toolOutput ?? "truncated";
    this.maxMessageChars = capture?.maxMessageChars ?? 4000;
    this.maxToolOutputChars = capture?.maxToolOutputChars ?? 2000;
    this.flushTimeoutMs = config.flushTimeoutMs ?? 2000;

    // v5 requires an OTel registry: a Langfuse span processor on an ISOLATED
    // tracer provider (never the global OTel provider — ALiX owns none) wired
    // through @langfuse/tracing's isolated-provider hook so `startObservation`
    // routes every span through this process's processor, which hands it to
    // Langfuse's OTLP ingestion (v4 `events_only` gateways accept exactly this
    // path). `exportMode: "immediate"` exports each span as it ends — a
    // short-lived CLI process must not rely on a later batch flush.
    //
    // `propagateAttributes` (used for the run root's traceName + sessionId and
    // for per-observation session propagation below) makes its context active
    // through the OTel ContextManager. THE SAL has none registered — the OTel
    // API no-op ContextManager never makes the `with(context, fn)` context
    // "active", so `context.active()` inside `fn` is ROOT_CONTEXT and the
    // propagated values would be silently dropped. Register the async-hooks
    // manager here (enabled path only, once per process); ALiX holds no other
    // OTel usage (src/tracing/AGENTS.md boundary), so the global registration
    // cannot collide.
    otelContext.setGlobalContextManager(new AsyncLocalStorageContextManager());

    // Always pass explicit values so the SDK never falls back to environment
    // variables (keys resolve store-only; src/tracing/AGENTS.md).
    this.processor = new LangfuseSpanProcessor({
      publicKey,
      secretKey,
      baseUrl,
      exportMode: "immediate",
    });
    const provider = new BasicTracerProvider({
      spanProcessors: [this.processor],
    });
    setLangfuseTracerProvider(provider);
  }

  // -------------------------------------------------------------------------
  // Run lifecycle
  // -------------------------------------------------------------------------

  startRun(input: TraceRunInput): TraceRun {
    const existing = this.runsByRunId.get(input.runId);
    if (existing) return existing.handle;

    // Parent-run translation (design §23; Task 8). The only parent relationship
    // ALiX expresses is the explicit `parentRunId`. When that id resolves to a
    // run active in THIS adapter instance (in-process parent, R4), the child is
    // linked to the parent via Langfuse's cross-trace grouping primitive — the
    // session. Langfuse v5 observations group into traces by OTel trace id and
    // into sessions by the propagated `sessionId`; there is no
    // trace-as-child-of-trace field, so the supported relationship between two
    // separate traces is "same session" (Session ⊃ Trace ⊃ Observation).
    // The child keeps its own trace id (one run → one trace) and therefore its
    // own observations; it only joins the parent's session when it has no
    // session of its own. An explicit child `sessionId` stays authoritative. An
    // unknown/ended/cross-process parent (or an absent parent session) degrades
    // to a standalone child trace — parentage is still recorded in
    // `metadata.alix.parentRunId`; never inferred from call order, never an
    // invented identity.
    const parent =
      input.parentRunId !== undefined
        ? this.runsByRunId.get(input.parentRunId)
        : undefined;
    // Only group into the parent's session when the parent's own root is live;
    // a registered-but-failed parent trace degrades to standalone like an ended
    // or unknown one.
    const sessionId =
      input.sessionId ?? (parent?.root ? parent.input.sessionId : undefined);

    const handle = makeRunHandle(input.runId);
    const alix = this.buildRunAlix(input, sessionId);

    // Fail-soft: if even root observation creation throws (never expected —
    // enqueue only), still register the run so lifecycle is idempotent; its
    // spans become noops.
    let root: LangfuseSpan | null = null;
    try {
      root = this.observeRoot(input, sessionId, alix);
    } catch {
      // Swallow (design §11): a tracing failure must never break agent execution.
    }

    const record: RunRecord = { input, root, handle, alix, sessionId };
    this.runsByRunId.set(input.runId, record);
    this.recordByRun.set(handle, record);
    return handle;
  }

  getRun(runId: string): TraceRun | null {
    return this.runsByRunId.get(runId)?.handle ?? null;
  }

  async endRun(run: TraceRun, outcome: RunOutcome): Promise<void> {
    const record = this.recordByRun.get(run as object);
    if (!record) return; // unknown or already-ended run → no-op (design §3)

    // Unregister FIRST so repeated endRun no-ops even if the SDK call throws.
    this.runsByRunId.delete(record.input.runId);
    this.recordByRun.delete(record.handle as object);
    if (record.root) {
      const alix = {
        ...record.alix,
        status: outcome.status,
        endedAtMs: outcome.endedAt,
        durationMs: durationMs(record.input.startedAt, outcome.endedAt),
        ...defined({ error: this.captureError(outcome.error) }),
      };
      try {
        record.root.update({ metadata: { alix } });
        record.root.otelSpan.setStatus({
          code:
            outcome.status === "error"
              ? SpanStatusCode.ERROR
              : SpanStatusCode.OK,
          ...(outcome.status === "error" && outcome.error !== undefined
            ? { message: outcome.error }
            : {}),
        });
        record.root.end(toDate(outcome.endedAt));
      } catch {
        // Swallow (design §11).
      }
    }

    // ── Bounded flush (Task 13, design §12-13) ──────────────────────────────
    // ALiX stops awaiting the tracing transport after flushTimeoutMs and
    // continues regardless of resolve/reject/timeout. The SDK keeps its own
    // lifecycle; we never synchronously discard its buffers. This is the only
    // awaited transport wait at the run terminal, and it is bounded by the
    // configured budget — a permanently hanging SDK flush cannot hang the agent.
    await this.flush();
  }

  // -------------------------------------------------------------------------
  // Spans
  // -------------------------------------------------------------------------

  startModelSpan(run: TraceRun, input: ModelSpanInput): TraceSpan {
    const record = this.recordByRun.get(run as object);
    if (!record?.root) return NOOP_SPAN; // unknown/ended run → noop span

    const inputMessages =
      input.messages !== undefined && input.messages.length > 0
        ? captureMessages(input.messages, this.messagesLevel, {
            maxChars: this.maxMessageChars,
          })
        : undefined;
    // Fall back to the standalone system prompt when there is no message array.
    const capturedInput =
      inputMessages ??
      (input.systemPrompt !== undefined
        ? captureString(input.systemPrompt, this.messagesLevel, {
            maxChars: this.maxMessageChars,
          })
        : undefined);

    const alix = buildModelAlix(input);
    try {
      const model = input.resolvedModel ?? input.model;
      const sdk = this.observeChild(
        "generation",
        record,
        model,
        { model, input: capturedInput, metadata: { alix } },
        input.startedAt,
      );
      if (!sdk) return NOOP_SPAN;
      return this.registerSpan("model", input, sdk, alix);
    } catch {
      // Swallow (design §11).
      return NOOP_SPAN;
    }
  }

  startToolSpan(run: TraceRun, input: ToolSpanInput): TraceSpan {
    const record = this.recordByRun.get(run as object);
    if (!record?.root) return NOOP_SPAN; // unknown/ended run → noop span

    const capturedArgs =
      input.args !== undefined
        ? captureToolArgs(input.args, this.toolInputLevel, {
            maxChars: this.maxMessageChars,
          })
        : undefined;

    const alix = buildToolAlix(input);
    try {
      const sdk = this.observeChild(
        "span",
        record,
        input.toolName,
        { input: capturedArgs, metadata: { alix } },
        input.startedAt,
      );
      if (!sdk) return NOOP_SPAN;
      return this.registerSpan("tool", input, sdk, alix);
    } catch {
      // Swallow (design §11).
      return NOOP_SPAN;
    }
  }

  endSpan(span: TraceSpan, outcome: SpanOutcome): void {
    const record = this.recordBySpan.get(span as object);
    if (!record || record.ended) return; // unknown/ended span → no-op
    record.ended = true;

    const error = this.captureError(outcome.error);
    const alix = {
      ...record.alix,
      ...this.buildSpanTerminalAlix(record, outcome, error),
    };
    const level = levelForStatus(outcome.status);

    try {
      if (record.kind === "model") {
        const sdk = record.sdk as LangfuseGeneration;
        const usage = buildUsage(outcome.inputTokens, outcome.outputTokens);
        sdk.update(
          defined({
            output: this.captureModelOutput(outcome),
            ...(usage ? { usageDetails: usage } : {}),
            level,
            statusMessage: error,
            metadata: { alix },
          }) as LangfuseGenerationAttributes,
        );
      } else {
        const sdk = record.sdk as LangfuseSpan;
        sdk.update(
          defined({
            output: this.captureToolOutput(outcome),
            level,
            statusMessage: error,
            metadata: { alix },
          }) as LangfuseSpanAttributes,
        );
      }
      record.sdk.otelSpan.setStatus({
        code:
          outcome.status === "error" ? SpanStatusCode.ERROR : SpanStatusCode.OK,
        ...(outcome.status === "error" && error !== undefined
          ? { message: error }
          : {}),
      });
      record.sdk.end(toDate(outcome.endedAt));
    } catch {
      // Swallow (design §11).
    }
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  async flush(): Promise<void> {
    // Bounded wait (design §12): resolve on timeout → continue; a rejection
    // before the budget expires is warned once and swallowed (boundedTransport).
    await boundedTransport(
      this.flushTimeoutMs,
      () => this.processor.forceFlush(),
      flushWarning,
      FLUSH_WARN_KEY,
    );
  }

  async shutdown(): Promise<void> {
    if (this.shutdownDone) return;
    this.shutdownDone = true;
    // Bounded wait (design §12/§14): the budget is the SAME flushTimeoutMs
    // used by flush() (Task 13) — shutdown schedules from the flush budget,
    // never a second fresh budget on top (plan Task 13 note). The processor's
    // shutdown performs a final flush internally, so this single net bounded
    // wait covers both the final flush and the resource release (never two
    // stacked bounded waits). Timeout → resolve and let the process exit; a
    // pre-budget rejection is warned once and absorbed.
    await boundedTransport(
      this.flushTimeoutMs,
      () => this.processor.shutdown(),
      shutdownWarning,
      SHUTDOWN_WARN_KEY,
    );
  }

  // -------------------------------------------------------------------------
  // Internal plumbing
  // -------------------------------------------------------------------------

  /**
   * Create the run's root span observation, tagged with the run's trace-level
   * attributes (title + session) via `propagateAttributes` so every observation
   * in this trace carries them (v5 observations-first model).
   */
  private observeRoot(
    input: TraceRunInput,
    sessionId: string | undefined,
    alix: Record<string, unknown>,
  ): LangfuseSpan {
    const task =
      input.task !== undefined
        ? captureString(input.task, "truncated", { maxChars: 120 })
        : undefined;
    const name = task ?? input.runId;
    return propagateAttributes(
      defined({ traceName: task, sessionId }) as Parameters<
        typeof propagateAttributes
      >[0],
      () =>
        startObservation(
          name,
          { metadata: { alix } },
          {
            asType: "span",
            ...(isFiniteNumber(input.startedAt)
              ? { startTime: new Date(input.startedAt) }
              : {}),
          },
        ),
    );
  }

  /**
   * Create one child observation (generation or span), linked as a direct child
   * of the run's root observation via its OTel span context, and tagged with the
   * run's session so the whole trace groups under the session. The session is
   * re-propagated per observation: child spans are created outside the root's
   * `propagateAttributes` scope, so without an explicit re-propagation their
   * OTel parent context would carry no `session.id` (v3 parity — every
   * observation self-describes its session).
   */
  private observeChild(
    kind: "generation" | "span",
    record: RunRecord,
    name: string,
    attributes: LangfuseGenerationAttributes | LangfuseSpanAttributes,
    startedAt: number | undefined,
  ): LangfuseGeneration | LangfuseSpan {
    const root = record.root;
    if (!root) return null as unknown as LangfuseGeneration | LangfuseSpan;
    const options = {
      ...(isFiniteNumber(startedAt)
        ? { startTime: new Date(startedAt) }
        : {}),
      parentSpanContext: root.otelSpan.spanContext(),
    };
    const create = (): LangfuseGeneration | LangfuseSpan => {
      if (kind === "generation") {
        return startObservation(
          name,
          attributes as LangfuseGenerationAttributes,
          { asType: "generation", ...options },
        );
      }
      return startObservation(name, attributes as LangfuseSpanAttributes, {
        asType: "span",
        ...options,
      });
    };
    const params = defined({ sessionId: record.sessionId });
    return Object.keys(params).length > 0
      ? propagateAttributes(
          params as Parameters<typeof propagateAttributes>[0],
          create,
        )
      : create();
  }

  private registerSpan(
    kind: SpanKind,
    input: ModelSpanInput | ToolSpanInput,
    sdk: LangfuseGeneration | LangfuseSpan,
    alix: Record<string, unknown>,
  ): TraceSpan {
    const handle = Object.freeze({}) as unknown as TraceSpan;
    this.recordBySpan.set(handle, { kind, input, sdk, alix, ended: false });
    return handle;
  }

  // --- metadata builders ----------------------------------------------------

  /**
   * @param input — authoritative ALiX run input.
   * @param sessionId — the session the trace is actually emitted under: the
   * run's own `input.sessionId`, or (when the child has none) the active
   * in-process parent's session for parent-linkage grouping (see `startRun`).
   */
  private buildRunAlix(
    input: TraceRunInput,
    sessionId: string | undefined,
  ): Record<string, unknown> {
    return {
      kind: "run",
      runId: input.runId,
      ...defined({
        sessionId,
        workflowId: input.workflowId,
        parentRunId: input.parentRunId,
        actor: input.actor,
        task:
          input.task !== undefined
            ? captureString(input.task, "truncated", {
                maxChars: this.maxMessageChars,
              })
            : undefined,
        startedAtMs: input.startedAt,
      }),
    };
  }

  private buildSpanTerminalAlix(
    record: SpanRecord,
    outcome: SpanOutcome,
    error: string | undefined,
  ): Record<string, unknown> {
    const terminal: Record<string, unknown> = defined({
      endedAtMs: outcome.endedAt,
      durationMs: durationMs(record.input.startedAt, outcome.endedAt),
      error,
    });
    if (record.kind === "model") {
      return {
        ...terminal,
        ...defined({
          status: outcome.status,
          finishReason: outcome.finishReason,
          inputTokens: outcome.inputTokens,
          outputTokens: outcome.outputTokens,
          reasoning: this.captureReasoning(outcome),
        }),
      };
    }
    return { status: outcome.status, ...terminal };
  }

  // --- capture integration ---------------------------------------------------

  /** Model output text capture — no dedicated config mode exists; see report. */
  private captureModelOutput(outcome: SpanOutcome): string | undefined {
    if (outcome.output === undefined) return undefined;
    return captureString(outcome.output, this.messagesLevel, {
      maxChars: this.maxMessageChars,
    });
  }

  private captureReasoning(outcome: SpanOutcome): string | undefined {
    if (outcome.reasoning === undefined) return undefined;
    return captureString(outcome.reasoning, this.reasoningLevel, {
      maxChars: this.maxMessageChars,
    });
  }

  private captureToolOutput(outcome: SpanOutcome): string | undefined {
    if (outcome.output === undefined) return undefined;
    return captureString(outcome.output, this.toolOutputLevel, {
      maxChars: this.maxToolOutputChars,
    });
  }

  /**
   * Error text has no capture-level toggle (it is diagnostic, small, and always
   * redacted): capture at "truncated" under the message char budget.
   */
  private captureError(error: string | undefined): string | undefined {
    if (error === undefined) return undefined;
    return captureString(error, "truncated", { maxChars: this.maxMessageChars });
  }
}