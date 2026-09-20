/**
 * propose.ts — the agent-facing schedule proposal.
 *
 * The agent never schedules anything. This validates a proposal, records it as
 * a pending approval in the (global) ApprovalStore, and returns "not scheduled".
 * A human approves it in `alix approvals`; the daemon then materializes an
 * active job in ScheduledTaskStore and runs it on the schedule.
 */

import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import {
  validateScheduleSpec,
  withinExpiryWindow,
  describeSchedule,
  type ScheduleSpec,
} from "./schedule-spec.js";
import type { ApprovalStore } from "../approvals/approval-store.js";

/** Capability marker the daemon keys on to find schedule approvals. */
export const SCHEDULE_CAPABILITY = "schedule.propose";
export const SCHEDULE_POLICY_REVISION = "schedule-v1";

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const MAX_TASK_LEN = 2000;

export type ScheduleProposal = {
  name: string;
  task: string;
  cwd: string;
  schedule: ScheduleSpec;
  expires: string;
  reason?: string;
};

export type ProposalValidation =
  | { ok: true; proposal: ScheduleProposal }
  | { ok: false; error: string };

export function validateProposal(input: unknown, now: Date = new Date()): ProposalValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "proposal must be an object" };
  }
  const p = input as Record<string, unknown>;
  if (typeof p.name !== "string" || !NAME_RE.test(p.name)) {
    return { ok: false, error: "name must be lowercase letters, digits, and dashes (2..41 chars)" };
  }
  if (typeof p.task !== "string" || p.task.trim().length === 0 || p.task.length > MAX_TASK_LEN) {
    return { ok: false, error: `task must be a non-empty string up to ${MAX_TASK_LEN} chars` };
  }
  if (typeof p.cwd !== "string" || !isAbsolute(p.cwd)) {
    return { ok: false, error: "cwd must be an absolute path" };
  }
  const sched = validateScheduleSpec(p.schedule);
  if (!sched.ok) return { ok: false, error: sched.error };
  if (typeof p.expires !== "string" || !withinExpiryWindow(p.expires, now)) {
    return { ok: false, error: "expires must be a YYYY-MM-DD date within the allowed horizon" };
  }
  if (p.reason !== undefined && (typeof p.reason !== "string" || p.reason.length > 300)) {
    return { ok: false, error: "reason must be a string up to 300 chars" };
  }
  return {
    ok: true,
    proposal: {
      name: p.name,
      task: p.task,
      cwd: p.cwd,
      schedule: sched.spec,
      expires: p.expires,
      ...(typeof p.reason === "string" ? { reason: p.reason } : {}),
    },
  };
}

/** Content hash of the proposal, stored on the approval for change detection. */
export function proposalFingerprint(p: ScheduleProposal): string {
  return createHash("sha256")
    .update(JSON.stringify({ name: p.name, task: p.task, cwd: p.cwd, schedule: p.schedule, expires: p.expires }))
    .digest("hex");
}

export type ProposeOutcome =
  | { ok: true; approvalId: string; description: string }
  | { ok: false; error: string };

export async function proposeSchedule(
  input: unknown,
  deps: { approvals: ApprovalStore; sessionId?: string; now?: Date },
): Promise<ProposeOutcome> {
  const validated = validateProposal(input, deps.now ?? new Date());
  if (!validated.ok) return { ok: false, error: validated.error };
  const p = validated.proposal;

  const record = await deps.approvals.requestBound({
    reason: `Schedule '${p.name}' (${describeSchedule(p.schedule)}): ${p.task.slice(0, 200)}`,
    bindingKey: `schedule:${p.name}`,
    requestFingerprint: proposalFingerprint(p),
    policyRevision: SCHEDULE_POLICY_REVISION,
    capabilities: [SCHEDULE_CAPABILITY],
    riskLevel: "high",
    // The review window tracks the JOB horizon, not ApprovalStore's 30-minute
    // default: a human may approve days later, and the job's own expiry still
    // bounds how long it can run.
    expiresAt: `${p.expires}T23:59:59`,
    ...(deps.sessionId !== undefined ? { sessionId: deps.sessionId } : {}),
    metadata: { scheduleProposal: p },
  });

  return { ok: true, approvalId: record.id, description: describeSchedule(p.schedule) };
}
