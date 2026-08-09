/**
 * T1a/T1b tool scoping: deterministic keyword-overlap relevance filter
 * (§2 admission-control).
 *
 * T1a = CORE_TOOL_NAMES — always admitted (task-invariant, small schemas).
 * T1b = extended tools — admitted per keyword relevance; fallbackFull when
 *       no relevance signal exists.
 */

import type { ToolDef } from "../providers/types.js";
import type { DeferredToolEntry } from "../mcp/tool-deferral.js";

/** T1a core, always-mandatory tools (task-invariant, small schemas). */
export const CORE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "alix_shell_run",
  "alix_file_read",
  "alix_file_write",
  "alix_patch_apply",
  "alix_patch_create",
  "alix_done",
]);

export type ScopedTools = {
  core: ToolDef[];
  extended: ToolDef[];
  /** true when heuristic could not decide — admitted all + logged */
  fallbackFull: boolean;
};

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function toolSignals(desc: string, name: string, serverName?: string): Set<string> {
  const parts = [desc, name];
  if (serverName) parts.push(serverName);
  return new Set(parts.flatMap((t) => tokens(t)));
}

/**
 * Deterministic, no-LLM relevance filter: keyword overlap between tool
 * description/name/server and task text. Cheap and reproducible.
 */
export function scopeToolsByTask(
  tools: ToolDef[],
  mcpTools: DeferredToolEntry[],
  task: string,
  _taskType?: string,
): ScopedTools {
  const core: ToolDef[] = [];
  const extended: ToolDef[] = [];

  const taskTokens = tokens(task);

  // Partition provider tools
  for (const t of tools) {
    if (CORE_TOOL_NAMES.has(t.name)) {
      core.push(t);
    } else {
      const signals = toolSignals(t.description, t.name);
      const matches = taskTokens.some((token) => signals.has(token));
      if (matches) {
        extended.push(t);
      }
    }
  }

  // Partition and flatten MCP tools
  const all: (ToolDef | DeferredToolEntry)[] = [...tools, ...mcpTools];
  for (const t of mcpTools) {
    if (!CORE_TOOL_NAMES.has(t.name)) {
      const signals = toolSignals(t.description, t.name, t.serverName);
      const matches = taskTokens.some((token) => signals.has(token));
      if (matches) {
        extended.push({
          name: t.name,
          description: t.description,
          input_schema: (t.input_schema ?? { type: "object", properties: {} }) as ToolDef["input_schema"],
        });
      }
    }
  }

  // fallbackFull: no extended matched but non-core tools exist.
  // Admit everything so the model isn't silently crippled, but log
  // it so the miss is visible.
  if (extended.length === 0 && all.some((t) => !CORE_TOOL_NAMES.has(t.name))) {
    const extendedFallback: ToolDef[] = [];
    for (const t of all) {
      if (!CORE_TOOL_NAMES.has(t.name)) {
        extendedFallback.push({
          name: t.name,
          description: t.description,
          input_schema: "input_schema" in t ? t.input_schema : (t as DeferredToolEntry).input_schema ?? { type: "object", properties: {} },
        } as ToolDef);
      }
    }
    return { core, extended: extendedFallback, fallbackFull: true };
  }

  return { core, extended, fallbackFull: false };
}
