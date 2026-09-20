/**
 * approval-stores.ts — the single-inbox helper for approval CLIs.
 *
 * Tool approvals live in the project store (`<cwd>/.alix/approvals`); schedule
 * proposals live in the global store (`~/.alix/approvals`). Both CLI surfaces
 * that review approvals must present them as ONE list and resolve by id across
 * both, so the union/owner logic lives here rather than being copied per call site.
 */

import { ApprovalStore } from "../../approvals/approval-store.js";
import { openGlobalApprovalStore } from "../../approvals/global-store.js";

export type ApprovalStores = {
  stores: ApprovalStore[];
  /** Concatenate a per-store query, de-duplicating by record id. */
  union: <T extends { id: string }>(pick: (store: ApprovalStore) => T[]) => T[];
  /** The store that owns `id` (project store when unknown). */
  owner: (id: string) => ApprovalStore;
};

export async function openApprovalStores(cwd: string): Promise<ApprovalStores> {
  const project = new ApprovalStore(cwd);
  await project.load();
  const global = await openGlobalApprovalStore();
  const stores = [project, global];
  const union = <T extends { id: string }>(pick: (store: ApprovalStore) => T[]): T[] => {
    const seen = new Set<string>();
    return stores.flatMap(pick).filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  };
  const owner = (id: string): ApprovalStore => stores.find((s) => s.get(id)) ?? project;
  return { stores, union, owner };
}
