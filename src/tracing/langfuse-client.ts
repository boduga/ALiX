/**
 * src/tracing/langfuse-client.ts
 *
 * The Langfuse v3 SDK adapter — the ONLY file in the repo allowed to import
 * `langfuse` (design §1, src/tracing/AGENTS.md). Every other module depends on
 * the provider-agnostic {@link TraceClient} facade; replacing Langfuse means
 * replacing this file, the dependency, and config — never the runtime seams.
 *
 * The adapter translates ALiX-run semantics into Langfuse operations:
 *
 * - one ALiX runId  → one Langfuse trace (id = runId, design §14)
 * - one physical model request → one Langfuse *generation* (design §18/§20)
 * - one physical tool call → one Langfuse *span* (design §21)
 *
 * ALiX statuses are kept in `metadata.alix.status`; Langfuse `level`/`statusMessage`
 * are derived (success/cancelled → DEFAULT; error → ERROR). Langfuse has no
 * "cancelled" level, so a cancelled span/run stays DEFAULT and carries the
 * cancellation in `metadata.alix.status`.
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
 */

import Langfuse from "langfuse";
import type {
  LangfuseGenerationClient,
  LangfuseSpanClient,
  LangfuseTraceClient as SdkTraceClient,
} from "langfuse";

import type { TracingConfig } from "../config/schema.js";
import {
  captureMessages,
  captureString,
  captureToolArgs,
  type CaptureLevel,
} from "./capture.js";
import type { TraceClient } from "./client.js";
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

/** Shared inert span handle returned for unknown/ended runs (design §3). */
const NOOP_SPAN = Object.freeze({}) as unknown as TraceSpan;

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

/** Epoch ms → ISO-8601 date-time string (Langfuse body format), else undefined. */
function toIso(ms?: number): string | undefined {
  return isFiniteNumber(ms) ? new Date(ms).toISOString() : undefined;
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

/** Per-run state. `sdkTrace` is null only when trace creation failed fail-soft. */
interface RunRecord {
  readonly input: TraceRunInput;
  readonly sdkTrace: SdkTraceClient | null;
  readonly handle: TraceRun;
  /** `metadata.alix` identity keys, re-emitted on end (update replaces). */
  readonly alix: Record<string, unknown>;
}

type SpanKind = "model" | "tool";

interface SpanRecord {
  readonly kind: SpanKind;
  readonly input: ModelSpanInput | ToolSpanInput;
  readonly sdk: LangfuseGenerationClient | LangfuseSpanClient;
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
 * ALiX handles (TraceRun/TraceSpan) map internally to Langfuse trace /
 * generation / span objects; those SDK objects and their ids never escape.
 * Spans are created as direct children of the run's trace — no parent/child
 * is inferred from call order (design §21/§22). Run-level parent linkage
 * (Task 8, design §23) translates an explicit in-process `parentRunId` into a
 * shared Langfuse session between the two traces (see `startRun`); it never
 * merges traces and never invents identity.
 *
 * @param config — resolved `tracing` config section. Constructed by the
 * factory (Task 9) only when `enabled === true`; may throw on invalid config.
 */
export class LangfuseTraceClient implements TraceClient {
  private readonly sdk: Langfuse;

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
    // (design §11). Never a transient/network condition.
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

    // Always pass explicit values so the SDK never falls back to environment
    // variables (keys resolve store-only; src/tracing/AGENTS.md).
    this.sdk = new Langfuse({ baseUrl, publicKey, secretKey });
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
    // session. Langfuse has no trace-as-child-of-trace body field (verified in
    // the v3.38 SDK types: `CreateLangfuseTraceBody` carries no
    // parentObservationId/parentTraceId), so the supported relationship between
    // two separate traces is "same session" (Session ⊃ Trace ⊃ Observation).
    // The child keeps its own trace id (one run → one trace) and therefore its
    // own spans; it only joins the parent's session when it has no session of
    // its own. An explicit child `sessionId` stays authoritative. An
    // unknown/ended/cross-process parent (or an absent parent session) degrades
    // to a standalone child trace — parentage is still recorded in
    // `metadata.alix.parentRunId`; never inferred from call order, never an
    // invented identity.
    const parent =
      input.parentRunId !== undefined
        ? this.runsByRunId.get(input.parentRunId)
        : undefined;
    // Only group into the parent's session when the parent's own trace is live;
    // a registered-but-failed parent trace degrades to standalone like an ended
    // or unknown one.
    const sessionId =
      input.sessionId ?? (parent?.sdkTrace ? parent.input.sessionId : undefined);

    const handle = makeRunHandle(input.runId);
    const alix = this.buildRunAlix(input, sessionId);

    // Fail-soft: if even trace creation throws (never expected — enqueue only),
    // still register the run so lifecycle is idempotent; its spans become noops.
    let sdkTrace: SdkTraceClient | null = null;
    try {
      sdkTrace = this.sdk.trace(
        defined({
          id: input.runId,
          name: input.task
            ? captureString(input.task, "truncated", { maxChars: 120 })
            : undefined,
          timestamp: toIso(input.startedAt),
          sessionId,
          metadata: { alix },
        }) as Parameters<Langfuse["trace"]>[0],
      );
    } catch {
      // Swallow (design §11): a tracing failure must never break agent execution.
    }

    const record: RunRecord = { input, sdkTrace, handle, alix };
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
    if (record.sdkTrace) {
      const alix = {
        ...record.alix,
        status: outcome.status,
        endedAtMs: outcome.endedAt,
        durationMs: durationMs(record.input.startedAt, outcome.endedAt),
        ...defined({ error: this.captureError(outcome.error) }),
      };
      try {
        record.sdkTrace.update(
          defined({ metadata: { alix } }) as Parameters<SdkTraceClient["update"]>[0],
        );
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
    if (!record?.sdkTrace) return NOOP_SPAN; // unknown/ended run → noop span

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

    const alix = this.buildModelAlix(input);
    try {
      const sdk = record.sdkTrace.generation(
        defined({
          name: input.resolvedModel ?? input.model,
          model: input.resolvedModel ?? input.model,
          input: capturedInput,
          startTime: toIso(input.startedAt),
          metadata: { alix },
        }) as Parameters<SdkTraceClient["generation"]>[0],
      );
      return this.registerSpan("model", input, sdk, alix);
    } catch {
      // Swallow (design §11).
      return NOOP_SPAN;
    }
  }

  startToolSpan(run: TraceRun, input: ToolSpanInput): TraceSpan {
    const record = this.recordByRun.get(run as object);
    if (!record?.sdkTrace) return NOOP_SPAN; // unknown/ended run → noop span

    const capturedArgs =
      input.args !== undefined
        ? captureToolArgs(input.args, this.toolInputLevel, {
            maxChars: this.maxMessageChars,
          })
        : undefined;

    const alix = this.buildToolAlix(input);
    try {
      const sdk = record.sdkTrace.span(
        defined({
          name: input.toolName,
          input: capturedArgs,
          startTime: toIso(input.startedAt),
          metadata: { alix },
        }) as Parameters<SdkTraceClient["span"]>[0],
      );
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
        const sdk = record.sdk as LangfuseGenerationClient;
        const usage = this.buildUsage(outcome.inputTokens, outcome.outputTokens);
        sdk.end(
          defined({
            output: this.captureModelOutput(outcome),
            ...(usage ? { usage } : {}),
            level,
            statusMessage: error,
            metadata: { alix },
          }) as Parameters<LangfuseGenerationClient["end"]>[0],
        );
      } else {
        const sdk = record.sdk as LangfuseSpanClient;
        sdk.end(
          defined({
            output: this.captureToolOutput(outcome),
            level,
            statusMessage: error,
            metadata: { alix },
          }) as Parameters<LangfuseSpanClient["end"]>[0],
        );
      }
    } catch {
      // Swallow (design §11).
    }
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  async flush(): Promise<void> {
    let sdkFlush: Promise<void>;
    try {
      sdkFlush = this.sdk.flushAsync();
    } catch (error) {
      // A synchronous throw from flushAsync (never expected). Warn once and
      // continue — a flush failure must never change an ALiX run's outcome.
      warnOnce(this.flushWarning(error), FLUSH_WARN_KEY);
      return;
    }
    // Absorb a rejection that settles AFTER we have stopped awaiting (timeout):
    // fail-open flush ignores late transport failures, so one must never
    // surface as an unhandled rejection. The pre-timeout rejection path is
    // handled by the wait below.
    sdkFlush.catch(() => {
      // handled by the wait below; this branch only absorbs post-timeout settles
    });
    try {
      // Bounded wait (design §12): resolve on timeout → continue; a rejection
      // before the budget expires is warned once and swallowed.
      await withTimeout(sdkFlush, this.flushTimeoutMs);
    } catch (error) {
      warnOnce(this.flushWarning(error), FLUSH_WARN_KEY);
    }
  }

  async shutdown(): Promise<void> {
    if (this.shutdownDone) return;
    this.shutdownDone = true;
    let sdkShutdown: Promise<void>;
    try {
      sdkShutdown = this.sdk.shutdownAsync();
    } catch (error) {
      // A synchronous throw from shutdownAsync (never expected). Warn once and
      // continue — a shutdown failure must never fail or block process teardown.
      warnOnce(this.shutdownWarning(error), SHUTDOWN_WARN_KEY);
      return;
    }
    // Absorb a rejection that settles AFTER we have stopped awaiting (timeout):
    // fail-open shutdown ignores late transport failures, so one must never
    // surface as an unhandled rejection. The pre-timeout rejection path is
    // handled by the wait below.
    sdkShutdown.catch(() => {
      // handled by the wait below; this branch only absorbs post-timeout settles
    });
    try {
      // Bounded wait (design §12/§14): the budget is the SAME flushTimeoutMs
      // used by flush() (Task 13) — shutdown schedules from the flush budget,
      // never a second fresh budget on top (plan Task 13 note). Langfuse's
      // shutdownAsync performs a final flush internally, so this single net
      // bounded wait covers both the final flush and the resource release
      // (never two stacked bounded waits). Timeout → resolve and let the
      // process exit; a pre-budget rejection is warned once and absorbed.
      await withTimeout(sdkShutdown, this.flushTimeoutMs);
    } catch (error) {
      warnOnce(this.shutdownWarning(error), SHUTDOWN_WARN_KEY);
    }
  }

  // -------------------------------------------------------------------------
  // Internal plumbing
  // -------------------------------------------------------------------------

  private registerSpan(
    kind: SpanKind,
    input: ModelSpanInput | ToolSpanInput,
    sdk: LangfuseGenerationClient | LangfuseSpanClient,
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

  private buildModelAlix(input: ModelSpanInput): Record<string, unknown> {
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

  private buildToolAlix(input: ToolSpanInput): Record<string, unknown> {
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

  private buildUsage(
    inputTokens: number | undefined,
    outputTokens: number | undefined,
  ): { input: number; output: number; unit: "TOKENS" } | undefined {
    if (!isFiniteNumber(inputTokens) && !isFiniteNumber(outputTokens)) {
      return undefined;
    }
    return {
      input: inputTokens ?? 0,
      output: outputTokens ?? 0,
      unit: "TOKENS",
    };
  }

  private flushWarning(error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error);
    return `[Tracing] flush failed (tracing transport error; agent execution continues): ${detail}`;
  }

  private shutdownWarning(error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error);
    return `[Tracing] shutdown failed (tracing transport error; process exit continues): ${detail}`;
  }
}
