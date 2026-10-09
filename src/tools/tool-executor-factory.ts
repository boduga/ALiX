/**
 * tool-executor-factory.ts — R5.3b sanctioned construction seam for
 * `ToolExecutor`.
 *
 * The `ToolExecutor` implementation lives in `executor.ts` and is protected by
 * the R1 `direct-tool-dispatch` freeze (value imports of `executor.ts` must go
 * through an authorized seam). This module is that single seam: every
 * composition site constructs an executor here rather than importing the
 * implementation directly.
 */

import { ToolExecutor } from "./executor.js";

export type { ToolExecutor } from "./executor.js";

/** Construct a `ToolExecutor` with the canonical constructor arguments. */
export function createToolExecutor(
  ...args: ConstructorParameters<typeof ToolExecutor>
): ToolExecutor {
  return new ToolExecutor(...args);
}
