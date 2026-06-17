/**
 * model-replan-adapter.ts — ModelAdapter-based proposal generation.
 *
 * Uses ALiX's real ModelAdapter.complete() API with structured output
 * to call a model for proposing PlanRevisionDraft revisions.
 * Always runs runtime JSON parsing + validation even when the provider
 * claims structured-output support.
 */

import type { ModelAdapter, NormalizedRequest, TokenUsage } from "../providers/types.js";
import type { ModelReplanContext, PlanRevisionDraft } from "./replan-types.js";

// ─── JSON Schema (structuredOutputSchema) ─────────────────────────────

/**
 * JSON Schema for PlanRevisionDraft, passed as structuredOutputSchema
 * so providers with structured-output support constrain the response.
 */
export const REVISION_DRAFT_SCHEMA: NonNullable<NormalizedRequest["structuredOutputSchema"]> = {
  name: "planRevisionDraft",
  description: "Proposed revision to the current plan / worker graph",
  properties: {
    triggerKind: {
      type: "string",
      enum: ["worker_completed", "worker_failed", "conflict_detected", "finding_published", "manual"],
      description: "What triggered this replan",
    },
    triggerEvidence: {
      type: "object",
      properties: {
        workerId: { type: "string" },
        findingIds: { type: "array", items: { type: "string" } },
        conflictIds: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
      },
      required: ["workerId", "findingIds", "conflictIds", "reason"],
    },
    workersToAdd: {
      type: "array",
      items: {
        type: "object",
        properties: {
          draftWorkerId: { type: "string" },
          taskLabel: { type: "string" },
          goalPrompt: { type: "string" },
          requiredCapabilities: { type: "array", items: { type: "string" } },
          dependencies: { type: "array", items: { type: "string" } },
          verificationRequirements: { type: "array", items: { type: "string" } },
        },
        required: ["draftWorkerId", "taskLabel", "goalPrompt"],
      },
    },
    workersToReplace: {
      type: "array",
      items: {
        type: "object",
        properties: {
          targetWorkerId: { type: "string" },
          replacement: {
            type: "object",
            properties: {
              draftWorkerId: { type: "string" },
              taskLabel: { type: "string" },
              goalPrompt: { type: "string" },
              requiredCapabilities: { type: "array", items: { type: "string" } },
              dependencies: { type: "array", items: { type: "string" } },
              verificationRequirements: { type: "array", items: { type: "string" } },
            },
            required: ["draftWorkerId", "taskLabel", "goalPrompt"],
          },
          reason: { type: "string" },
        },
        required: ["targetWorkerId", "replacement", "reason"],
      },
    },
    workersToCancel: {
      type: "array",
      items: { type: "string" },
    },
    workersToModify: {
      type: "array",
      items: {
        type: "object",
        properties: {
          workerId: { type: "string" },
          goalPrompt: { type: "string" },
          dependencies: { type: "array", items: { type: "string" } },
        },
        required: ["workerId"],
      },
    },
    dependencyRewiring: {
      type: "array",
      items: {
        type: "object",
        properties: {
          dependentWorkerRef: { type: "string" },
          removeDependencyRef: { type: "string" },
          addDependencyRef: { type: "string" },
          reason: { type: "string" },
        },
        required: ["dependentWorkerRef", "removeDependencyRef", "addDependencyRef", "reason"],
      },
    },
    expectedBenefit: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    unresolvedConcerns: { type: "array", items: { type: "string" } },
  },
  required: [
    "triggerKind",
    "triggerEvidence",
    "workersToAdd",
    "workersToReplace",
    "workersToCancel",
    "workersToModify",
    "dependencyRewiring",
    "expectedBenefit",
    "confidence",
    "unresolvedConcerns",
  ],
};

// ─── Options ──────────────────────────────────────────────────────────

export interface ReplanAdapterOptions {
  /** Maximum output tokens for the model response. Default 4000. */
  maxTokens?: number;
  /**
   * Injected sleep function for testable retry timing.
   * Defaults to setTimeout-based promise.
   */
  sleep?: (ms: number) => Promise<void>;
}

// ─── Errors ───────────────────────────────────────────────────────────

export type ReplanAdapterErrorCode =
  | "parse_error"
  | "validation_error"
  | "transient_failure"
  | "aborted"
  | "max_retries_exceeded";

export class ReplanAdapterError extends Error {
  constructor(
    public readonly code: ReplanAdapterErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ReplanAdapterError";
  }
}

// ─── Evidence ─────────────────────────────────────────────────────────

export interface ModelProposalEvidence {
  provider: string;
  model: string;
  usage?: TokenUsage;
}

// ─── Constants ────────────────────────────────────────────────────────

const VALID_TRIGGER_KINDS = [
  "worker_completed" as const,
  "worker_failed" as const,
  "conflict_detected" as const,
  "finding_published" as const,
  "manual" as const,
];

const DEFAULT_MAX_TOKENS = 4_000;
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1_000;

// ─── Helpers ──────────────────────────────────────────────────────────

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Distinguishes transient (retryable) errors from deterministic ones.
 * Timeouts, network failures, and rate-limits are transient.
 */
/**
 * Race a promise against an AbortSignal, rejecting with ReplanAdapterError
 * when the signal fires.
 */
function raceAgainstSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;

  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new ReplanAdapterError("aborted", "Operation aborted"));
      return;
    }

    const onAbort = () => {
      reject(new ReplanAdapterError("aborted", "Operation aborted"));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function isTransientError(error: unknown): boolean {
  const msg = String(error).toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("network") ||
    msg.includes("eai_again") ||
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests")
  );
}

// ─── Validation ───────────────────────────────────────────────────────

/**
 * Runtime validation of a parsed PlanRevisionDraft.
 * Always runs even when the provider claims structured-output support.
 */
function validateDraft(value: unknown): PlanRevisionDraft {
  if (typeof value !== "object" || value === null) {
    throw new ReplanAdapterError("validation_error", "Response is not a JSON object");
  }

  const obj = value as Record<string, unknown>;

  // --- Required top-level field presence ---
  const requiredFields = [
    "triggerKind",
    "triggerEvidence",
    "workersToAdd",
    "workersToReplace",
    "workersToCancel",
    "workersToModify",
    "dependencyRewiring",
    "expectedBenefit",
    "confidence",
    "unresolvedConcerns",
  ] as const;

  for (const field of requiredFields) {
    if (!(field in obj)) {
      // Fill missing optional-style arrays with empty defaults
      if (
        field === "workersToAdd" ||
        field === "workersToReplace" ||
        field === "workersToCancel" ||
        field === "workersToModify" ||
        field === "dependencyRewiring" ||
        field === "unresolvedConcerns"
      ) {
        (obj as Record<string, unknown>)[field] = [];
        continue;
      }
      throw new ReplanAdapterError("validation_error", `Missing required field: ${field}`);
    }
  }

  // --- triggerKind ---
  if (!VALID_TRIGGER_KINDS.includes(obj.triggerKind as typeof VALID_TRIGGER_KINDS[number])) {
    throw new ReplanAdapterError(
      "validation_error",
      `Invalid triggerKind: "${String(obj.triggerKind)}". Must be one of ${VALID_TRIGGER_KINDS.map((k) => `"${k}"`).join(", ")}`,
    );
  }

  // --- triggerEvidence ---
  const ev = obj.triggerEvidence;
  if (typeof ev !== "object" || ev === null) {
    throw new ReplanAdapterError("validation_error", "triggerEvidence must be an object");
  }
  const evidenceObj = ev as Record<string, unknown>;
  for (const field of ["workerId", "findingIds", "conflictIds", "reason"]) {
    if (!(field in evidenceObj)) {
      throw new ReplanAdapterError("validation_error", `Missing required field: triggerEvidence.${field}`);
    }
  }

  // --- Array fields (fill defaults if missing) ---
  const arrayFields = [
    "workersToAdd",
    "workersToReplace",
    "workersToCancel",
    "workersToModify",
    "dependencyRewiring",
    "unresolvedConcerns",
  ] as const;
  for (const field of arrayFields) {
    if (!Array.isArray(obj[field])) {
      (obj as Record<string, unknown>)[field] = [];
    }
  }

  // --- confidence ---
  if (typeof obj.confidence !== "number" || obj.confidence < 0 || obj.confidence > 1) {
    throw new ReplanAdapterError(
      "validation_error",
      `confidence must be a number between 0 and 1, got ${String(obj.confidence)}`,
    );
  }

  // --- expectedBenefit ---
  if (typeof obj.expectedBenefit !== "string") {
    throw new ReplanAdapterError(
      "validation_error",
      `expectedBenefit must be a string, got ${typeof obj.expectedBenefit}`,
    );
  }

  return obj as unknown as PlanRevisionDraft;
}

// ─── System Prompt ────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return [
    "You are a plan revision expert for a multi-agent coordination system.",
    "Your task is to analyze the current execution state and propose revisions to the worker graph.",
    "",
    "Output a JSON object matching the PlanRevisionDraft schema. Consider:",
    "- Which workers to add, replace, cancel, or modify",
    "- How to rewire dependencies when workers are removed or replaced",
    "- The expected benefit and confidence level of your proposal",
    "- Any unresolved concerns that need human attention",
    "",
    "Always include all required fields. Use empty arrays for list fields when there are no items.",
  ].join("\n");
}

// ─── Core Adapter ─────────────────────────────────────────────────────

export class ModelReplanAdapter {
  /**
   * Evidence from the most recent proposeRevision call.
   * Contains provider, model, and usage metadata.
   */
  lastEvidence: ModelProposalEvidence | undefined;

  constructor(
    private readonly modelAdapter: ModelAdapter,
    private readonly options?: ReplanAdapterOptions,
  ) {}

  /**
   * Propose a plan revision by calling the model via ModelAdapter.complete().
   *
   * @param context - The current replan context (serialized to the model)
   * @param signal - Optional AbortSignal for cancellation
   * @returns The validated PlanRevisionDraft
   * @throws {ReplanAdapterError} on parse failure, validation failure, abort, or exhausted retries
   */
  async proposeRevision(
    context: ModelReplanContext,
    signal?: AbortSignal,
  ): Promise<PlanRevisionDraft> {
    const request: NormalizedRequest = {
      systemPrompt: buildSystemPrompt(),
      messages: [{ role: "user", content: JSON.stringify(context, null, 2) }],
      structuredOutputSchema: REVISION_DRAFT_SCHEMA,
      tools: [],
      temperature: 0.3,
      maxOutputTokens: this.options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream: false,
    };

    // Check initial abort
    if (signal?.aborted) {
      throw new ReplanAdapterError("aborted", "Operation aborted before request");
    }

    let lastError: Error | undefined;
    const sleepFn = this.options?.sleep ?? defaultSleep;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (signal?.aborted) {
          throw new ReplanAdapterError("aborted", "Operation aborted");
        }

        // Race the model call against the abort signal
        const response = await raceAgainstSignal(
          this.modelAdapter.complete(request),
          signal,
        );

        if (signal?.aborted) {
          throw new ReplanAdapterError("aborted", "Operation aborted after response");
        }

        // Always parse and validate — even with structured-output support
        const draft = this.parseAndValidate(response.text);

        // Collect provider/model/usage evidence
        this.lastEvidence = {
          provider: this.modelAdapter.capabilities.provider,
          model: this.modelAdapter.capabilities.model,
          usage: response.usage,
        };

        return draft;
      } catch (error) {
        // Abort: fail immediately
        if (error instanceof ReplanAdapterError && error.code === "aborted") {
          throw error;
        }

        // Parse / validation errors: deterministic, fail immediately
        if (
          error instanceof ReplanAdapterError &&
          (error.code === "parse_error" || error.code === "validation_error")
        ) {
          throw error;
        }

        // Transient errors: retry with backoff (if retries remain)
        if (isTransientError(error) && attempt < MAX_RETRIES) {
          lastError = error instanceof Error ? error : new Error(String(error));
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          await sleepFn(delay);
          continue;
        }

        // Non-transient errors from complete(): fail immediately
        if (!isTransientError(error)) {
          throw error instanceof ReplanAdapterError
            ? error
            : new ReplanAdapterError("transient_failure", String(error), error);
        }

        // Exhausted retries
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw new ReplanAdapterError(
      "max_retries_exceeded",
      `Failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message}`,
      lastError,
    );
  }

  // ── Private ────────────────────────────────────────────────────────

  private parseAndValidate(text: string): PlanRevisionDraft {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new ReplanAdapterError(
        "parse_error",
        `Failed to parse model response as JSON: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
    return validateDraft(parsed);
  }
}
