import { ALIX_BUILTIN_EXECUTORS } from "./tool-manifest.js";

export type OfferedExecutableTool = { name: string; execName?: string };

export class ToolNotFoundError extends Error {
  constructor(public readonly requestedName: string, public readonly offeredTools: string[]) {
    super(`Unknown tool call: '${requestedName}'. Available tools this turn: ${offeredTools.join(", ")}`);
    this.name = "ToolNotFoundError";
  }
}

/**
 * ONE vocabulary: a tool has exactly one callable name, the `alix_*` form
 * offered this turn. Internal executor IDs (`shell.run`, `file.create`) are the
 * code's own vocabulary and are never accepted from a caller.
 *
 * This resolver used to carry a documented-executor alias that mapped
 * `shell.run` -> `alix_shell_run`, justified by the repository naming tools by
 * executor ID in its own DOX and specs. That justification is gone: every
 * model-facing contract bullet now names the `alix_*` tool, so the alias no
 * longer bridges anything real — it only widened the accepted surface.
 *
 * A second vocabulary on the model's call path is not free even when
 * offered-gated. It made `resolveExecutableToolName` accept two spellings per
 * tool, forced every consumer of tool identity to decide which form it holds,
 * and meant a contract typo could not be caught by rejecting the call. The
 * rejection message already names the callable options, so a wrong name costs
 * one turn and is self-correcting — which is the intended failure mode, not a
 * defect.
 *
 * Executor IDs remain correct in CODE, where they are the dispatch identity.
 * See `tool-manifest.ts` for the single canonical mapping.
 */

/** Resolve an offered model-facing name. Executor IDs are NOT accepted. */
export function resolveExecutableToolName(
  requestedName: string,
  offeredTools: ReadonlyArray<OfferedExecutableTool>,
): string {
  const offered = offeredTools.find((tool) => tool.name === requestedName);
  if (offered && Object.hasOwn(ALIX_BUILTIN_EXECUTORS, requestedName)) {
    return ALIX_BUILTIN_EXECUTORS[requestedName as keyof typeof ALIX_BUILTIN_EXECUTORS];
  }
  if (offered && requestedName.startsWith("mcp__") && offered.execName?.startsWith("mcp.")) {
    return offered.execName;
  }
  // MCP handles are opaque and minted per turn, so the discovered executor
  // name is accepted as an equivalent spelling — still gated on an
  // `mcp__`-named, `mcp.`-executing offered entry. Built-ins get no such
  // latitude: their callable name is fixed by the manifest.
  for (const tool of offeredTools) {
    if (tool.execName === requestedName && tool.name.startsWith("mcp__") && tool.execName?.startsWith("mcp.")) {
      return tool.execName;
    }
  }
  const names = offeredTools
    .filter((tool) => Object.hasOwn(ALIX_BUILTIN_EXECUTORS, tool.name)
      || (tool.name.startsWith("mcp__") && tool.execName?.startsWith("mcp.")))
    .map((tool) => tool.name);
  throw new ToolNotFoundError(requestedName, [...new Set(names)]);
}
