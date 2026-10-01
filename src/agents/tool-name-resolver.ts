import { ALIX_BUILTIN_EXECUTORS } from "./tool-manifest.js";

export type OfferedExecutableTool = { name: string; execName?: string };

export class ToolNotFoundError extends Error {
  constructor(public readonly requestedName: string, public readonly offeredTools: string[]) {
    super(`Unknown tool call: '${requestedName}'. Available tools this turn: ${offeredTools.join(", ")}`);
    this.name = "ToolNotFoundError";
  }
}

/**
 * Reverse index: internal executor ID -> canonical model-facing name.
 *
 * The repo's own documentation, DOX contracts, and specs name tools by
 * executor ID (`shell.run`, `file.create`, `patch.apply`, `verify.claim` —
 * ~100 backticked mentions across `docs/` and `AGENTS.md`), because that is
 * how the code refers to them. A model that reads those docs and then calls
 * `shell.run` is not hallucinating a capability; it is naming a tool the
 * repository itself taught it to name. Rejecting that costs a turn and
 * teaches nothing.
 *
 * The alias is deliberately narrow: it resolves ONLY when the requested name
 * is the exact executor ID of a tool that was OFFERED this turn. It is a
 * naming-convention bridge, not a capability grant — authority still comes
 * from the offered surface, never from the requested string.
 */
const EXECUTOR_TO_CANONICAL: ReadonlyMap<string, string> = new Map(
  Object.entries(ALIX_BUILTIN_EXECUTORS).map(([canonical, execName]) => [execName, canonical]),
);

/** Resolve an offered model-facing name, or its documented executor alias. */
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
  // Documented-executor alias: `shell.run` -> `alix_shell_run`, offered-only.
  const canonical = EXECUTOR_TO_CANONICAL.get(requestedName);
  if (canonical) {
    const aliased = offeredTools.find((tool) => tool.name === canonical);
    if (aliased) return ALIX_BUILTIN_EXECUTORS[canonical as keyof typeof ALIX_BUILTIN_EXECUTORS];
  }
  // MCP handles are opaque; accept the discovered executor name for the same
  // reason, still gated on an `mcp__`-named, `mcp.`-executing offered entry.
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
