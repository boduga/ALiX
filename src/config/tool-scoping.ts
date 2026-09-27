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
  "alix_patch_apply",
  "alix_done",
  "alix_collaboration_publish_finding",
  "alix_collaboration_publish_artifact",
  "alix_collaboration_query_findings",
  "alix_collaboration_get_dependency_results",
  "alix_collaboration_report_conflict",
  "alix_collaboration_list_conflicts",
]);

/**
 * Stable machine-readable scoping reason codes. Never prose, never speculation:
 * a reason is recorded only when a subsystem actually made that determination.
 */
export const SCOPING_REASONS = {
  CORE: "core",
  RELEVANCE_MATCH: "relevance_match",
  FALLBACK_FULL: "fallback_full",
  NOT_RELEVANT: "not_relevant",
} as const;

export type ScopingReason = (typeof SCOPING_REASONS)[keyof typeof SCOPING_REASONS];

export type ScopingDisposition = { tool: string; reasons: string[] };

/**
 * Why each tool was admitted or dropped. `excluded` is provenance for the
 * "requirement-closing tool disappeared" question; callers that persist it
 * should gate it behind a debug flag.
 */
export type ScopingProvenance = {
  admitted: ScopingDisposition[];
  excluded: ScopingDisposition[];
  fallbackFull: boolean;
};

export type ScopedTools = {
  core: ToolDef[];
  extended: ToolDef[];
  /** true when heuristic could not decide — admitted all + logged */
  fallbackFull: boolean;
  provenance: ScopingProvenance;
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
  const admitted: ScopingDisposition[] = [];
  const excluded: ScopingDisposition[] = [];

  const taskTokens = tokens(task);

  // Partition provider tools
  for (const t of tools) {
    if (CORE_TOOL_NAMES.has(t.name)) {
      core.push(t);
      admitted.push({ tool: t.name, reasons: [SCOPING_REASONS.CORE] });
    } else {
      const signals = toolSignals(t.description, t.name);
      const matches = taskTokens.some((token) => signals.has(token));
      if (matches) {
        extended.push(t);
        admitted.push({ tool: t.name, reasons: [SCOPING_REASONS.RELEVANCE_MATCH] });
      } else {
        excluded.push({ tool: t.name, reasons: [SCOPING_REASONS.NOT_RELEVANT] });
      }
    }
  }

  // Partition and flatten MCP tools
  const all: (ToolDef | DeferredToolEntry)[] = [...tools, ...mcpTools];
  for (const t of mcpTools) {
    if (!CORE_TOOL_NAMES.has(t.name)) {
      const signals = toolSignals(t.description, t.searchName ?? t.name, t.serverName);
      const matches = taskTokens.some((token) => signals.has(token));
      if (matches) {
        extended.push({
          name: t.name,
          description: t.description,
          input_schema: (t.input_schema ?? { type: "object", properties: {} }) as ToolDef["input_schema"],
        });
        admitted.push({ tool: t.name, reasons: [SCOPING_REASONS.RELEVANCE_MATCH] });
      } else {
        excluded.push({ tool: t.name, reasons: [SCOPING_REASONS.NOT_RELEVANT] });
      }
    }
  }

  // fallbackFull: no extended matched but non-core tools exist.
  // Admit everything so the model isn't silently crippled, but log
  // it so the miss is visible.
  if (extended.length === 0 && all.some((t) => !CORE_TOOL_NAMES.has(t.name))) {
    const extendedFallback: ToolDef[] = [];
    const fallbackAdmitted: ScopingDisposition[] = [];
    for (const t of all) {
      if (!CORE_TOOL_NAMES.has(t.name)) {
        extendedFallback.push({
          name: t.name,
          description: t.description,
          input_schema: "input_schema" in t ? t.input_schema : (t as DeferredToolEntry).input_schema ?? { type: "object", properties: {} },
        } as ToolDef);
        fallbackAdmitted.push({ tool: t.name, reasons: [SCOPING_REASONS.FALLBACK_FULL] });
      }
    }
    return {
      core,
      extended: extendedFallback,
      fallbackFull: true,
      // Everything non-core is admitted in this branch, so nothing is excluded.
      provenance: { admitted: [...admitted, ...fallbackAdmitted], excluded: [], fallbackFull: true },
    };
  }

  return { core, extended, fallbackFull: false, provenance: { admitted, excluded, fallbackFull: false } };
}
