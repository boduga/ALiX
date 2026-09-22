// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Model-proposal tool contract (residual step 4).
 *
 * `execution_state_propose` lets the model emit a `StatePatch` for the
 * governed execution state — the paper's (R_t, ΔΣ_t) write path. The handler
 * validates the patch shape and routes it through the emitter's
 * `proposePatch` (10-gate harness: schema → version CAS → governor → apply →
 * persist → emit). It never writes state directly and never executes actions.
 *
 * Visibility is SEND-gated (appended to provider tools only when
 * `ALIX_EXECUTION_STATE_SEND` is on); execution is intercepted loop-side in
 * `handleToolCall` before the ToolExecutor, so no executor/policy-registry
 * changes were needed. The harness governor (tracer default or injected
 * policy governor) remains the authorization boundary.
 *
 * Wiring touch points (all three required, all SEND-gated):
 *  1. This module — tool definition + handler.
 *  2. `src/agent/session/setup.ts` — visibility (appended to providerTools).
 *  3. `src/run/event-handlers.ts` — execution (guard clause in handleToolCall).
 *
 * Contract note: `ToolParam` cannot express a nested key enum, so the patch
 * key allowlist is enforced in `executeStateProposal`/`proposePatch` via
 * `validateStatePatch` (unknown keys rejected), not in `input_schema`.
 *
 * @module state-proposal-tool
 */

import type { ToolCall } from "../providers/types.js";
import type { ToolDef } from "../providers/types.js";
import type { NormalizedMessage } from "../providers/types.js";
import { type StatePatch } from "../runtime/execution-state/execution-state.js";
import {
  type ExecutionStateEmitter,
  isExecutionStateSendEnabled,
} from "../runtime/execution-state/execution-state-emitter.js";

export const STATE_PROPOSAL_TOOL_NAME = "execution_state_propose" as const;

export const STATE_PROPOSAL_TOOL: ToolDef = {
  name: STATE_PROPOSAL_TOOL_NAME,
  description:
    "Propose a patch to the governed execution state (objective, status, pending actions, capabilities, constraints, artifacts). " +
    "The patch is validated and committed through the state-transition harness; the result reports committed or the rejection reason. " +
    "Use sparingly — record durable decisions and artifacts, not every observation.",
  input_schema: {
    type: "object",
    properties: {
      patch: {
        type: "object",
        description: "StatePatch: subset of {objective, status, intent, pendingActions, activeCapabilities, constraints, artifacts}; null deletes a field, omission preserves it.",
      },
    },
    required: ["patch"],
  },
};

export type StateProposalOutcome = Readonly<{
  committed: boolean;
  reason?: string;
  detail?: string;
  version?: number | null;
}>;

/**
 * Execute a model tool call against the emitter. Validates the arg shape
 * here; patch semantics are validated once inside `proposePatch` (no duplicate
 * validation). Returns the outcome for the tool-result message. Never throws.
 */
export async function executeStateProposal(
  emitter: ExecutionStateEmitter,
  toolCall: ToolCall,
): Promise<StateProposalOutcome> {
  const raw = (toolCall.args as Record<string, unknown> | undefined)?.patch;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { committed: false, reason: "INVALID_PATCH", detail: "args.patch must be an object" };
  }
  const result = await emitter.proposePatch(raw as StatePatch);
  if (!result.committed) {
    return { committed: false, reason: result.reason, detail: result.detail };
  }
  return { committed: true, version: result.newState.version };
}

/** Render the outcome as model-facing tool-result content. */
export function renderStateProposalResult(outcome: StateProposalOutcome, toolCallId: string): string {
  if (outcome.committed) {
    return `<tool_result id="${toolCallId}">\nState patch committed (version ${outcome.version ?? "?"}).\n</tool_result>`;
  }
  return `<tool_result id="${toolCallId}">\nError: state patch rejected (${outcome.reason ?? "unknown"}): ${outcome.detail ?? "no detail"}\n</tool_result>`;
}

/**
 * Loop-side interception for `handleToolCall`. Returns a tool result when
 * this call targets the state-proposal tool, the SEND behavior flag is on,
 * and an emitter is present — else null (fall through to normal dispatch).
 * Never throws. Visibility (setupTools) and interception share the SEND
 * gate so the model never sees an unexecutable tool.
 */
export async function tryHandleStateProposal(
  toolCall: ToolCall,
  emitter: ExecutionStateEmitter | null | undefined,
): Promise<{ message: NormalizedMessage; continue: boolean } | null> {
  if (!emitter || toolCall.name !== STATE_PROPOSAL_TOOL_NAME) return null;
  if (!isExecutionStateSendEnabled()) return null;
  try {
    const outcome = await executeStateProposal(emitter, toolCall);
    return {
      continue: true,
      message: { role: "user", content: renderStateProposalResult(outcome, toolCall.id) },
    };
  } catch (err) {
    return {
      continue: true,
      message: {
        role: "user",
        content: `<tool_result id="${toolCall.id}">\nError: state proposal failed: ${err instanceof Error ? err.message : String(err)}\n</tool_result>`,
      },
    };
  }
}
