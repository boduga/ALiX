/**
 * tool-selection-candidates.ts — T2-f1: the frozen candidate descriptor.
 *
 * A selection scope freezes *candidate identities*, not executor identifiers.
 * The frozen descriptor is sanitized and bounded, so it can cross the remote
 * (Jev) trust boundary: an MCP candidate is identified by `mcp:<short hash>`
 * and a bounded human label, never by its opaque `mcp__<handle>`.
 *
 * The handle stays in a LOCAL-ONLY binding:
 *
 *   candidateId  ->  local binding  ->  mcp__<opaque handle>  ->  executor
 *
 * ALiX owns that mapping; Jev only ever ranks candidate ids.
 */

import { createHash } from "node:crypto";
import { redactSecrets } from "../policy/secret-scanner.js";

export type ToolSelectionDomain = "builtin" | "mcp";

/** Reserved model-facing namespace for MCP tools. */
export const MCP_TOOL_PREFIX = "mcp__";

export function toolSelectionDomain(modelName: string): ToolSelectionDomain {
  return modelName.startsWith(MCP_TOOL_PREFIX) ? "mcp" : "builtin";
}

/** Bounded so a hostile description cannot inflate the projection. */
export const MAX_CANDIDATE_DESCRIPTION_CHARS = 240;
export const MAX_CANDIDATE_LABEL_CHARS = 120;

/**
 * A frozen candidate: the identity Jev ranks and the label a reader sees.
 * `tool` is set only for a builtin manifest name — an MCP candidate carries no
 * executable identifier at all.
 */
export type FrozenToolCandidate = {
  candidateId: string;
  domain: ToolSelectionDomain;
  label: string;
  description: string;
  tool?: string;
};

/**
 * LOCAL-ONLY resolution of a candidate to executable machinery. Never part of
 * a remote projection, never hashed into one.
 */
export type LocalToolBinding = {
  candidateId: string;
  domain: ToolSelectionDomain;
  /** Model-facing name (the opaque handle for an MCP candidate). */
  modelName: string;
  /** Executor the model-facing name resolves to, when known. */
  executorName?: string;
};

export function builtinCandidateId(name: string): string {
  return `builtin:${name}`;
}

/**
 * Stable within a trace/replay, opaque, and derived from the handle — so two
 * distinct handles never collide with a readable-looking id.
 */
export function mcpCandidateId(handle: string): string {
  return `mcp:${createHash("sha256").update(handle, "utf8").digest("hex").slice(0, 6)}`;
}

export function candidateIdFor(modelName: string): string {
  return toolSelectionDomain(modelName) === "mcp"
    ? mcpCandidateId(modelName)
    : builtinCandidateId(modelName);
}

function bounded(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Redact first, then bound. A description that trip the secret patterns keeps
 * only its redacted form — the raw string never enters the descriptor.
 */
function safeText(text: string | undefined, max: number): string {
  if (typeof text !== "string" || text.length === 0) return "";
  return bounded(redactSecrets(text), max);
}

export type FreezableBuiltinTool = { name: string; description?: string };

export type FreezableMcpTool = {
  /** `mcp__<opaque handle>` — the model-facing name. */
  name: string;
  /** Readable discovery text (never executable). */
  searchName?: string;
  serverName?: string;
  toolName?: string;
  /** Internal executor name, e.g. `mcp.github.repos.list`. */
  execName?: string;
  description?: string;
};

export type FrozenCandidateSurface = {
  candidates: FrozenToolCandidate[];
  /** Local-only: candidateId -> executable machinery. */
  bindings: LocalToolBinding[];
};

/**
 * Freeze the surface actually offered to the model this iteration: builtin
 * tools plus the MCP entries that were genuinely admitted. Order is preserved,
 * because offered order is the stable tie-break for every later ranking.
 */
export function freezeToolCandidates(input: {
  builtin: ReadonlyArray<FreezableBuiltinTool>;
  mcp?: ReadonlyArray<FreezableMcpTool>;
}): FrozenCandidateSurface {
  const candidates: FrozenToolCandidate[] = [];
  const bindings: LocalToolBinding[] = [];
  const seen = new Set<string>();
  /** candidateId -> model name, so a genuine id collision can be told apart. */
  const boundNames = new Map<string, string>();

  const push = (candidate: FrozenToolCandidate, binding: LocalToolBinding): void => {
    const existing = boundNames.get(candidate.candidateId);
    if (existing !== undefined) {
      // The same tool offered twice is one candidate (the model-facing list is
      // a set for selection purposes). Two *different* names sharing an id
      // would silently shrink the surface, so that fails closed.
      if (existing !== binding.modelName) {
        throw new Error(
          `frozen candidate id collision: ${candidate.candidateId} covers both ${existing} and ${binding.modelName}`,
        );
      }
      return;
    }
    seen.add(candidate.candidateId);
    boundNames.set(candidate.candidateId, binding.modelName);
    candidates.push(candidate);
    bindings.push(binding);
  };

  for (const tool of input.builtin) {
    push(
      {
        candidateId: builtinCandidateId(tool.name),
        domain: "builtin",
        label: bounded(tool.name, MAX_CANDIDATE_LABEL_CHARS),
        description: safeText(tool.description, MAX_CANDIDATE_DESCRIPTION_CHARS),
        tool: tool.name,
      },
      { candidateId: builtinCandidateId(tool.name), domain: "builtin", modelName: tool.name },
    );
  }

  for (const tool of input.mcp ?? []) {
    const candidateId = mcpCandidateId(tool.name);
    const readable =
      tool.serverName && tool.toolName
        ? `${tool.serverName}/${tool.toolName}`
        : tool.searchName ?? "mcp tool";
    // A readable label that trips the secret scanner is replaced outright:
    // sending "[REDACTED] list repos" would be noise, not provenance.
    const label =
      redactSecrets(readable) === readable
        ? bounded(readable, MAX_CANDIDATE_LABEL_CHARS)
        : `mcp tool ${candidateId.slice(4)}`;
    push(
      {
        candidateId,
        domain: "mcp",
        label: label.length > 0 ? label : `mcp tool ${candidateId.slice(4)}`,
        description: safeText(tool.description, MAX_CANDIDATE_DESCRIPTION_CHARS),
      },
      {
        candidateId,
        domain: "mcp",
        modelName: tool.name,
        ...(tool.execName !== undefined ? { executorName: tool.execName } : {}),
      },
    );
  }

  return { candidates, bindings };
}

/** Local resolution: candidateId -> executable machinery. */
export function bindingFor(
  bindings: ReadonlyArray<LocalToolBinding> | undefined,
  candidateId: string,
): LocalToolBinding | undefined {
  return bindings?.find(entry => entry.candidateId === candidateId);
}

/**
 * Guard for tests and for any caller that assembles a projection by hand: a
 * frozen surface must not carry a model-facing MCP handle anywhere.
 */
export function frozenSurfaceLeaksHandles(surface: {
  candidates: ReadonlyArray<FrozenToolCandidate>;
}): boolean {
  return surface.candidates.some(candidate => {
    if (candidate.domain !== "mcp") return false;
    const serialized = JSON.stringify(candidate);
    return serialized.includes(MCP_TOOL_PREFIX) || redactSecrets(serialized) !== serialized;
  });
}
