import { realpathSync } from "node:fs";
import type { ApprovalStore } from "./approval-store.js";
import {
  computeInvocationFingerprint,
  invocationMatches,
  type InvocationIdentity,
} from "./approval-binding.js";
import { hashArgs } from "../../capabilities/tools/hash-args.js";

/** Host-derived identity: hash actual step data, never a recorded argsHash. */
export function liveStepInvocation(
  cwd: string,
  sessionId: string,
  toolName: string,
  capability: string,
  step: Record<string, unknown>,
): InvocationIdentity {
  return { workspace: realpathSync(cwd), sessionId, toolName, capability, argsHash: hashArgs(step) };
}

/** Claim once before entering any effect adapter. Store lock/ledger is the authority. */
export async function claimLiveStep(
  store: ApprovalStore,
  invocation: InvocationIdentity,
  reason: string,
  metadata: Record<string, unknown>,
): Promise<{ approvalId: string; claimed: boolean; reason?: string; created?: boolean }> {
  const fingerprint = computeInvocationFingerprint(invocation);
  await store.load();
  const exact = store.list().filter(a => a.bindingKey === fingerprint && invocationMatches(a, invocation));
  // The newest exact decision is authoritative. An older grant must never
  // override a later denial, expiry, or consumed grant.
  const matching = exact[0];
  if (!matching) {
    const pending = await store.requestOrReusePending({
      reason,
      bindingKey: fingerprint,
      requestFingerprint: fingerprint,
      policyRevision: "live-step-v1",
      capabilities: [invocation.capability],
      sessionId: invocation.sessionId,
      toolId: invocation.toolName,
      invocation,
      metadata,
    });
    return { approvalId: pending.id, claimed: false, created: true, reason: `Approval required: ${pending.id}` };
  }
  const claim = await store.consumeApproved(matching.id, fingerprint, {}, invocation);
  return claim.consumed
    ? { approvalId: matching.id, claimed: true }
    : { approvalId: matching.id, claimed: false, reason: `Approval ${matching.id} rejected: ${claim.reason}` };
}
