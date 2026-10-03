import { ALIX_BUILTIN_EXECUTORS } from "./tool-manifest.js";

export type OfferedExecutableTool = { name: string; execName?: string };

/**
 * Compose the resolution surface from the tools actually offered, pairing each
 * with its MCP executor when it has one.
 *
 * ONE derivation, because the composition was previously written out twice and
 * the two copies read DIFFERENT lists: the event handler used the offered
 * surface (`wireTools`), while the task loop's telemetry helper used
 * `selectedTools` — a relevance-truncated list capped at 20, against a registry
 * of 24. Instrumenting the real path showed 102 of 170 resolutions asking for a
 * name absent from `selectedTools`.
 *
 * `mcp__*` handles are opaque and minted per turn, so their executor id is
 * never in the manifest and can only come from the MCP index. That is why the
 * pairing is not optional here.
 */
export function buildOfferedExecutableTools(
  visibleTools: ReadonlyArray<{ name: string }>,
  mcpTools: ReadonlyArray<{ name: string; execName?: string }> = [],
): OfferedExecutableTool[] {
  return visibleTools.map((tool) => ({
    name: tool.name,
    execName: mcpTools.find((entry) => entry.name === tool.name)?.execName,
  }));
}

export class ToolNotFoundError extends Error {
  constructor(public readonly requestedName: string, public readonly offeredTools: string[]) {
    super(`Unknown tool call: '${requestedName}'. Available tools this turn: ${offeredTools.join(", ")}`);
    this.name = "ToolNotFoundError";
  }
}

/**
 * Resolve only exact offered built-in names or opaque MCP handles.
 * Executor IDs are internal dispatch identities, never callable aliases.
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
  const names = offeredTools
    .filter((tool) => Object.hasOwn(ALIX_BUILTIN_EXECUTORS, tool.name)
      || (tool.name.startsWith("mcp__") && tool.execName?.startsWith("mcp.")))
    .map((tool) => tool.name);
  throw new ToolNotFoundError(requestedName, [...new Set(names)]);
}
