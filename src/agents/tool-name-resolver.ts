import { ALIX_BUILTIN_EXECUTORS } from "./tool-manifest.js";

export type OfferedExecutableTool = { name: string; execName?: string };

export class ToolNotFoundError extends Error {
  constructor(public readonly requestedName: string, public readonly offeredTools: string[]) {
    super(`Unknown tool call: '${requestedName}'. Available tools this turn: ${offeredTools.join(", ")}`);
    this.name = "ToolNotFoundError";
  }
}

/** Resolve only an exact model-facing name that was offered this turn. */
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
