import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/** Host-local filesystem identity, shared by server binding and enrollment. */
export function canonicalWorkspaceId(root: string): string {
  return realpathSync.native(resolve(root));
}

/** Ordinary Inspector eligibility. Remote decisions must also require explicit scope. */
export function allowsWorkspace(
  workspaceIds: readonly string[] | undefined,
  targetWorkspace: string | undefined,
): boolean {
  if (workspaceIds === undefined) return true;
  return Array.isArray(workspaceIds) && targetWorkspace !== undefined &&
    workspaceIds.includes(targetWorkspace);
}
