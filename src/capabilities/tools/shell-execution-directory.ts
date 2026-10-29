import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/** Shared execution/identity contract, not path authorization. Relative cwd is
 * workspace-relative; safe-shell always runs at the canonical workspace root.
 * Require an existing directory identity rather than hashing a request alias. */
export function shellExecutionDirectory(root: string, cwd: unknown, safeShell: boolean): string {
  const workspace = realpathSync(root);
  return safeShell ? workspace : realpathSync(resolve(workspace, typeof cwd === "string" ? cwd : "."));
}
