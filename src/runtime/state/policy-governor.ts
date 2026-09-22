// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Policy-backed transition governor (residual step 2).
 *
 * Adapts the real `PolicyGate` to the `TransitionGovernor` shape the
 * `StateTransitionHarness` expects, so state-transition proposals can be
 * authorized by production policy instead of the tracer patch-only governor.
 * Patch-only proposals are evaluated as the synthetic capability
 * `execution-state.write`; proposals carrying an `action` are denied (tools
 * execute in the task loop, never through this harness).
 *
 * Decision mapping: allow → allow, deny → deny, ask → escalate (the harness
 * treats escalate as a rejection — it never auto-approves). Gate errors fail
 * closed to deny.
 *
 * Approval-spam caveat: with an approvalStore-backed gate in `ask` mode,
 * `evaluateCapability` CREATES a pending approval per evaluation. Do NOT wire
 * this adapter live in ask-mode sessions without an explicit
 * `execution-state.write: allow` policy or approval throttling — every turn
 * would enqueue an approval. With a storeless gate, ask fails closed to deny
 * (no approval created). The live emitter default stays the tracer governor
 * until that throttling exists.
 *
 * @module policy-governor
 */

import type { PolicyGate } from "../../policy/policy-gate.js";
import type { SessionMode } from "../../config/schema.js";
import type { EventLog } from "../../events/event-log.js";
import { ExecutionStateEmitter } from "../execution-state/execution-state-emitter.js";
import type {
  GovernorDecision,
  StateTransitionProposal,
  TransitionGovernor,
} from "./state-transition.js";

/** Synthetic capability state-transition proposals are evaluated under. */
export const EXECUTION_STATE_CAPABILITY = "execution-state.write" as const;

export type PolicyGovernorContext = Readonly<{
  sessionMode: SessionMode;
  sessionId?: string;
  agentId?: string;
}>;

/**
 * Build a TransitionGovernor backed by a real PolicyGate. The gate is taken
 * as a structural `{ evaluateCapability }` so tests can substitute fakes;
 * pass a real `PolicyGate` in production.
 */
export function createPolicyTransitionGovernor(
  gate: Pick<PolicyGate, "evaluateCapability">,
  ctx: PolicyGovernorContext,
): TransitionGovernor {
  // Gate decision → harness decision. ask escalates (the harness treats
  // escalate as a rejection — it never auto-approves).
  const mapDecision = (
    res: { decision: "allow" | "deny" | "ask"; reason: string; matchedRuleId?: string },
  ): GovernorDecision => {
    const policy = { policyId: res.matchedRuleId, ruleId: res.matchedRuleId };
    const table: Record<"allow" | "deny" | "ask", GovernorDecision> = {
      allow: { decision: "allow", ...policy },
      deny: { decision: "deny", reason: res.reason, ...policy },
      ask: { decision: "escalate", reason: res.reason, ...policy },
    };
    return table[res.decision];
  };
  return {
    evaluate: async (proposal: StateTransitionProposal): Promise<GovernorDecision> => {
      if (proposal.action) {
        return {
          decision: "deny",
          reason: "live emitter accepts patch-only proposals; tools execute in the task loop",
        };
      }
      try {
        const res = await gate.evaluateCapability({
          requestId: `exec-state-${proposal.executionId}-v${proposal.baseStateVersion}`,
          capability: EXECUTION_STATE_CAPABILITY,
          sessionMode: ctx.sessionMode,
          sessionId: ctx.sessionId,
          agentId: ctx.agentId,
          source: "tool",
          metadata: { kind: "execution-state-write" },
        });
        return mapDecision(res);
      } catch (err) {
        return { decision: "deny", reason: `policy gate error: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}

/**
 * Composition-root factory: an emitter whose harness proposals are authorized
 * by production policy instead of the tracer governor. Prefer this over the
 * default emitter wherever a `PolicyGate` exists. Honours the same
 * approval-spam caveat above — use with an explicit
 * `execution-state.write: allow` policy or approval throttling in ask-mode
 * sessions.
 */
export function createPolicyBackedEmitter(args: {
  gate: Pick<PolicyGate, "evaluateCapability">;
  log: EventLog;
  sessionId: string;
  executionId?: string;
  sessionMode: SessionMode;
  agentId?: string;
  storeDir?: string;
}): ExecutionStateEmitter {
  return new ExecutionStateEmitter({
    log: args.log,
    sessionId: args.sessionId,
    executionId: args.executionId ?? args.sessionId,
    ...(args.storeDir ? { storeDir: args.storeDir } : {}),
    governor: createPolicyTransitionGovernor(args.gate, {
      sessionMode: args.sessionMode,
      sessionId: args.sessionId,
      agentId: args.agentId,
    }),
  });
}
