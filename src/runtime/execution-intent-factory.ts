/**
 * #405 — ExecutionIntent factory.
 *
 * Turns a TaskRoute into the canonical X1 ExecutionIntent document that
 * every routed task carries. The intent is created BEFORE execution begins,
 * is immutable (frozen), and its `intentId` becomes the canonical execution
 * identity referenced by all downstream lifecycle / evidence / persistence.
 *
 * Canonical-chain invariant: the intent's `action` is ALWAYS the canonical
 * intent label — the route's `diagnostic.classification` (Layer 1) or a
 * kind-derived canonical label for routes without a diagnostic. It is NEVER
 * a re-derivation from raw prompt text.
 *
 * Non-proposal routes receive a synthetic auto-approval (Alignment A in the
 * wayfinder chain): the governor gate stays universal, and validation
 * passes because every intent carries approval fields.
 *
 * @module execution-intent-factory
 */

import {
  createIntentId,
  createIntentHash,
  type ExecutionConstraints,
  type ExecutionIntent,
} from "./contracts/execution-intent-contract.js";
import type { TaskRoute, RouteDiagnostic } from "./task-router.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ExecutionIntentFactoryOptions {
  /** Actor authoring the intent. Defaults to "system". */
  actor?: string;
  /** ISO timestamp; injectable for deterministic identity in tests. */
  now?: string;
  /** Explicit approval reference; overrides the synthetic auto-approval. */
  approvalReference?: string;
  /** Explicit approver; overrides "governor". */
  approvedBy?: string;
  /** Explicit approval time; overrides `now`. */
  approvedAt?: string;
  /** Lifetime of the intent from creation, in ms. Defaults to 24h. */
  expirationMs?: number;
  /** Explicit proposal id; defaults to a synthetic route-derived id. */
  proposalId?: string;
  /** Upstream evidence this intent derives from, if any. Defaults to "". */
  sourceEvidenceId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_EXPIRATION_MS = 24 * 60 * 60 * 1000;
const SYNTHETIC_APPROVER = "governor";

// ---------------------------------------------------------------------------
// Kind → canonical label fallback (routes without a diagnostic)
// ---------------------------------------------------------------------------

/**
 * Canonical intent label for a route kind that carries no diagnostic.
 *
 * All tool routes emitted by the task router target `shell.run`, so the
 * canonical label is `shell_execution`. Legacy `chat` routes come from the
 * research/docs fallback, so the closest canonical label is
 * `read_only_analysis`. These are deterministic kind→label mappings — never
 * a re-derivation from prompt text.
 */

/** The canonical-intent taxonomy labels (wayfinder T14, 8 intents). */
const CANONICAL_ACTIONS = new Set([
  "arithmetic",
  "generation",
  "workspace_action",
  "workspace_mutation",
  "external_retrieval",
  "shell_execution",
  "read_only_analysis",
  "planning",
]);

/** Canonical label for a route kind that carries no usable diagnostic. */
function kindAction(route: TaskRoute): string {
  switch (route.kind) {
    case "tool":
      return "shell_execution";
    case "chat":
      return "read_only_analysis";
    case "direct":
      return "generation";
    case "grounded_chat":
      return "external_retrieval";
    case "agent":
      return "workspace_action";
  }
}

function actionForRoute(route: TaskRoute): string {
  const diagnostic: RouteDiagnostic | undefined =
    "diagnostic" in route ? route.diagnostic : undefined;
  // The action is the canonical label, never a re-derivation from raw
  // prompt text. A non-canonical classification (e.g. "ambiguous", or the
  // legacy agent fallback) is clamped to the route-kind canonical label so
  // `action` always belongs to the canonical taxonomy (spec #404, c1).
  if (diagnostic?.classification && CANONICAL_ACTIONS.has(diagnostic.classification)) {
    return diagnostic.classification;
  }
  return kindAction(route);
}

/** Risk class derived from the route kind. */
function riskForRoute(route: TaskRoute): ExecutionIntent["riskClass"] {
  switch (route.kind) {
    case "direct":
    case "chat":
      return "low";
    case "tool":
    case "grounded_chat":
      return "medium";
    case "agent":
      return "high";
  }
}

/** Execution constraints derived from the route. */
function constraintsForRoute(route: TaskRoute): ExecutionConstraints {
  const allowedTools =
    route.kind === "grounded_chat"
      ? [...route.allowedTools]
      : route.kind === "tool"
        ? [route.tool]
        : [];
  return {
    maxFilesChanged: route.kind === "agent" ? 10 : 1,
    allowedPaths: [],
    blockedPaths: [],
    verificationRequired: riskForRoute(route) === "high",
    allowedTools,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the immutable ExecutionIntent for a routed task.
 *
 * The intent is created before execution begins, frozen, and keyed by a
 * deterministic `intentId` (given identical inputs). Approval fields are
 * synthesized for routes without a proposal reference so the governor gate
 * remains universal.
 *
 * @param route - The routed task to capture.
 * @param opts - Overrides (actor, timestamps, approval, proposal).
 * @returns A frozen ExecutionIntent with a canonical-hash `intentHash`.
 */
export function createExecutionIntent(
  route: TaskRoute,
  opts: ExecutionIntentFactoryOptions = {},
): ExecutionIntent {
  const now = opts.now ?? new Date().toISOString();
  const actor = opts.actor ?? "system";
  const expirationMs = opts.expirationMs ?? DEFAULT_EXPIRATION_MS;

  const action = actionForRoute(route);
  const riskClass = riskForRoute(route);
  const constraints = constraintsForRoute(route);
  const proposalId = opts.proposalId ?? `route:${route.kind}`;
  const intentId = createIntentId(proposalId, actor, now);

  const base: Omit<ExecutionIntent, "intentHash"> = {
    intentId,
    proposalId,
    actor,
    action,
    target: route.kind,
    justification:
      ("diagnostic" in route && route.diagnostic?.reason) ||
      `auto-routed as ${route.kind}`,
    constraints,
    riskClass,
    expectedEffect: `Execute ${route.kind} route for ${action} intent`,
    sourceEvidenceId: opts.sourceEvidenceId ?? "",
    createdAt: now,
    expiration: new Date(new Date(now).getTime() + expirationMs).toISOString(),
    approvalReference: opts.approvalReference ?? `auto:${intentId}`,
    approvedBy: opts.approvedBy ?? SYNTHETIC_APPROVER,
    approvedAt: opts.approvedAt ?? now,
  };

  const intent: ExecutionIntent = {
    ...base,
    intentHash: createIntentHash(base),
  };

  // X1 invariant: immutable intent — freeze the document and its nested
  // constraints so no consumer can mutate the record after creation.
  Object.freeze(intent.constraints);
  return Object.freeze(intent);
}
