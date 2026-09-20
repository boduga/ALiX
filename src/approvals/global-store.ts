/**
 * global-store.ts — the cross-project approval store at ~/.alix/approvals.
 *
 * Ordinary tool approvals are per-project (`<cwd>/.alix/approvals`). Schedule
 * proposals are global: they must be visible to the daemon and to the human
 * regardless of which project proposed them. `alix approvals` unions this
 * store with the project store, so there is still one inbox.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { ApprovalStore } from "./approval-store.js";

/** Directory of the global approval store (the ApprovalStore's `cwd` root). */
export function globalApprovalRoot(): string {
  return homedir();
}

/** Open (and load) the global approval store. */
export async function openGlobalApprovalStore(): Promise<ApprovalStore> {
  const store = new ApprovalStore(globalApprovalRoot());
  await store.load();
  return store;
}

/** Absolute path to the global approvals file, for messages/tests. */
export function globalApprovalsPath(): string {
  return join(homedir(), ".alix", "approvals", "approvals.json");
}
