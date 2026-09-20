/**
 * global-store.ts — the cross-project approval store at ~/.alix/approvals.
 *
 * Ordinary tool approvals are per-project (`<cwd>/.alix/approvals`). Schedule
 * proposals are global: they must be visible to the daemon and to the human
 * regardless of which project proposed them. `alix approvals` unions this
 * store with the project store, so there is still one inbox.
 */

import { homedir } from "node:os";
import { ApprovalStore } from "./approval-store.js";

/** Open (and load) the global approval store at `~/.alix/approvals`. */
export async function openGlobalApprovalStore(): Promise<ApprovalStore> {
  const store = new ApprovalStore(homedir());
  await store.load();
  return store;
}
