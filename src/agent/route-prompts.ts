// src/agent/route-prompts.ts
// Layer 3 prompt construction (T16 #393, wayfinder map #392).
//
// Consumes canonical-intent labels emitted by Layer 1 (src/runtime/action-classifier.ts).
// Does NOT re-classify raw prompt text — the function signature carries no raw
// text. Per T15 audit (#390), Layer 3 takes the label and returns the prompt.
//
// Each canonical intent has a deterministic prompt construction:
// exact text + tool manifest + permission scope.

import type { ActionIntent } from "../runtime/action-classifier.js";

/** Minimal tool manifest shape — name + description. Mirrors `ToolDef` shape. */
export interface PromptToolDef {
  name: string;
  description: string;
}

/** Permission scope for the prompt's downstream execution. */
export interface PermissionScope {
  /** Whether the prompt allows workspace writes (file mutations). */
  workspaceWrite: boolean;
  /** Whether the prompt allows shell command execution. */
  shellExecution: boolean;
  /** Whether the prompt allows network access (web_fetch, web_search). */
  networkAccess: boolean;
}

/** Result of Layer 3 prompt construction. */
export interface DirectPrompt {
  systemPrompt: string;
  toolManifest: PromptToolDef[];
  permissions: PermissionScope;
}

const IDENTITY = "You are ALiX, an AI assistant.";

const READ_ONLY_SCOPE: PermissionScope = {
  workspaceWrite: false,
  shellExecution: false,
  networkAccess: false,
};

const MUTATION_SCOPE: PermissionScope = {
  workspaceWrite: true,
  shellExecution: true,
  networkAccess: false,
};

const NO_TOOLS: PromptToolDef[] = [];

/**
 * Build the direct-route prompt for a given canonical-intent label.
 *
 * Layer 3 invariant: takes the label, returns the prompt. No raw prompt text
 * is accepted — re-classification is forbidden per T15 audit.
 *
 * Defensive cases (`shell_execution`, `external_retrieval`, `workspace_action`,
 * `workspace_mutation`, `read_only_analysis`, `planning`, `ambiguous`) are
 * included so that if any of these ever leaks through to the direct route,
 * `buildDirectPrompt` returns a sensible prompt rather than throwing.
 * Production routing currently sends each of these to `tool`, `grounded_chat`,
 * or `agent` — not `direct`. `generation` is the only intent that the
 * direct-route provider-call path exercises in practice.
 */
export function buildDirectPrompt(intent: ActionIntent): DirectPrompt {
  switch (intent) {
    case "arithmetic":
      // Defensive — arithmetic with precomputed answer bypasses the provider
      // entirely (session.ts:938). Included for completeness.
      return {
        systemPrompt: `${IDENTITY} Answer concisely.`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };

    case "generation":
      return {
        systemPrompt: `${IDENTITY} Produce the requested text.`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };

    case "read_only_analysis":
      return {
        systemPrompt: `${IDENTITY} Read the relevant context, then summarize and answer concisely. Do not modify files or run commands.`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };

    case "planning":
      return {
        systemPrompt: `${IDENTITY} Design or recommend a course of action. Do not modify files, run commands, or take any side effects.`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };

    case "shell_execution":
      // Defensive — shell_execution routes to kind: "tool" (shell.run).
      return {
        systemPrompt: `${IDENTITY} The user gave a direct shell command. Briefly describe the intent of the command.`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };

    case "external_retrieval":
      // Defensive — external_retrieval routes to kind: "grounded_chat".
      return {
        systemPrompt: `${IDENTITY} The user needs information that may require external retrieval. Briefly describe what to look up.`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };

    case "workspace_action":
      // Legacy conflated intent — routes to kind: "agent". Defensive only.
      return {
        systemPrompt: `${IDENTITY} The user wants to inspect or modify the workspace.`,
        toolManifest: NO_TOOLS,
        permissions: MUTATION_SCOPE,
      };

    case "workspace_mutation":
      // workspace_mutation routes to kind: "agent". Defensive only.
      return {
        systemPrompt: `${IDENTITY} The user wants to modify the workspace.`,
        toolManifest: NO_TOOLS,
        permissions: MUTATION_SCOPE,
      };

    case "ambiguous":
    default:
      return {
        systemPrompt: `${IDENTITY} Answer concisely.`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };
  }
}
