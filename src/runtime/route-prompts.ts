// src/runtime/route-prompts.ts
// Layer 3 prompt construction (T16 #393 + T17 #394 + T20 #397, wayfinder map #392).
//
// Consumes canonical-intent labels emitted by Layer 1 (src/runtime/action-classifier.ts).
// Does NOT re-classify raw prompt text — the function signature carries no raw
// text. Per T15 audit (#390), Layer 3 takes the label and returns the prompt.
//
// Each canonical intent has a deterministic prompt construction:
// exact text + tool manifest + permission scope.
//
// - `buildDirectPrompt(intent)` — T16 — used by the `direct` execution route.
// - `buildChatPrompt(intent, threadIntents?)` — T17 — used by the `chat` route
//   (`session.ts:processChat`). Thread metadata tracks prior-turn intents so the
//   model can see what the conversation has been about.
// - `buildExternalRetrievalPrompt(intent)` — T18 — used by the `grounded_chat`
//   route (route-executor.ts + daemon-server.ts). Returns a system prompt,
//   user-prompt template, retrieval-only tool manifest, and read-only scope.
// - `buildIntentMetadataBlock(intent)` — T19 — prepends a structured
//   `[Canonical intent: <intent>]` block to every Layer 3 system prompt so
//   the model can reference the canonical intent at any point in the prompt.

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

const IDENTITY_CHAT =
  "You are ALiX in a lightweight chat session. Be brief, direct, and conversational. " +
  "Do not invoke tools, do not run commands, do not edit files. " +
  "Respond as if you were talking to the operator — short sentences, no markdown headings.";

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

const NETWORK_SCOPE: PermissionScope = {
  workspaceWrite: false,
  shellExecution: false,
  networkAccess: true,
};

const NO_TOOLS: PromptToolDef[] = [];

/**
 * Build the canonical-intent metadata block prepended to every Layer 3
 * system prompt (T19 #396). Format: `## Canonical intent: <intent>` followed
 * by a blank line — a markdown section header the model can reference.
 *
 * The block makes the canonical-intent label visible to the model at any
 * point in the prompt, not just in the body prose. It is structured metadata,
 * not narrative — the model knows this is a routing-tag, not instruction.
 */
export function buildIntentMetadataBlock(intent: ActionIntent): string {
  return `## Canonical intent: ${intent}\n\n`;
}

/**
 * Compose a system prompt body with the intent metadata block prepended.
 * Internal helper — every Layer 3 builder uses this so the metadata format
 * stays consistent across the routing chain.
 */
function withIntentMetadata(intent: ActionIntent, body: string): string {
  return `${buildIntentMetadataBlock(intent)}${body}`;
}

/**
 * Thread a canonical-intent label into an arbitrary base prompt.
 *
 * Public API for callers who compose their own system prompts (e.g., the
 * agent-loop, future T19-style threading at session start). Prepends the
 * structured `[Canonical intent: <intent>]` metadata block to the base.
 *
 * Layer 3 invariant: takes the label and the base, returns the composed
 * prompt. No raw prompt text is accepted.
 */
export function threadCanonicalIntent(
  basePrompt: string,
  intent: ActionIntent,
): string {
  return `${buildIntentMetadataBlock(intent)}${basePrompt}`;
}

const RETRIEVAL_TOOLS: PromptToolDef[] = [
  {
    name: "web_search",
    description: "Search the web for current information.",
  },
  {
    name: "web_fetch",
    description: "Fetch a specific URL and return its content.",
  },
];

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
  // T19 (#396): prepend canonical-intent metadata block to every system prompt
  // so the model can reference the intent label at any point in the prompt.
  const meta = buildIntentMetadataBlock(intent);
  switch (intent) {
    case "arithmetic":
      // Defensive — arithmetic with precomputed answer bypasses the provider
      // entirely (session.ts:938). Included for completeness.
      return {
        systemPrompt: `${meta}${IDENTITY} Answer concisely.`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };

    case "generation":
      return {
        systemPrompt: `${meta}${IDENTITY} Produce the requested text.`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };

    case "read_only_analysis":
      return {
        systemPrompt: `${meta}${IDENTITY} Read the relevant context, then summarize and answer concisely. Do not modify files or run commands.`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };

    case "planning":
      return {
        systemPrompt: `${meta}${IDENTITY} Design or recommend a course of action. Do not modify files, run commands, or take any side effects.`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };

    case "shell_execution":
      // Defensive — shell_execution routes to kind: "tool" (shell.run).
      return {
        systemPrompt: `${meta}${IDENTITY} The user gave a direct shell command. Briefly describe the intent of the command.`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };

    case "external_retrieval":
      // Defensive — external_retrieval routes to kind: "grounded_chat".
      return {
        systemPrompt: `${meta}${IDENTITY} The user needs information that may require external retrieval. Briefly describe what to look up.`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };

    case "workspace_action":
      // Legacy conflated intent — routes to kind: "agent". Defensive only.
      return {
        systemPrompt: `${meta}${IDENTITY} The user wants to inspect or modify the workspace.`,
        toolManifest: NO_TOOLS,
        permissions: MUTATION_SCOPE,
      };

    case "workspace_mutation":
      // workspace_mutation routes to kind: "agent". Defensive only.
      return {
        systemPrompt: `${meta}${IDENTITY} The user wants to modify the workspace.`,
        toolManifest: NO_TOOLS,
        permissions: MUTATION_SCOPE,
      };

    case "ambiguous":
    default:
      return {
        systemPrompt: `${meta}${IDENTITY} Answer concisely.`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };
  }
}

/**
 * Build the chat-route prompt for a given canonical-intent label.
 *
 * Layer 3 invariant: takes the label(s), returns the prompt. No raw prompt
 * text is accepted — re-classification is forbidden per T15 audit.
 *
 * `threadIntents` (optional) lists the canonical intents of prior turns in
 * this chat thread. When non-empty, a one-line metadata block is appended so
 * the model can see what the conversation has been about without inspecting
 * raw turn text.
 *
 * The chat path is conversational and lightweight — no tools, no shell, no
 * file edits across every intent. This is a Layer-3 invariant of the chat
 * route itself, not a per-intent decision.
 */
export function buildChatPrompt(
  intent: ActionIntent,
  threadIntents?: readonly ActionIntent[],
): DirectPrompt {
  // T19 (#396): prepend canonical-intent metadata block to every chat prompt.
  const meta = buildIntentMetadataBlock(intent);
  const threadMetadata =
    threadIntents && threadIntents.length > 0
      ? `\n\n[Thread intents so far: ${threadIntents.join(", ")}]`
      : "";

  switch (intent) {
    case "arithmetic":
      return {
        systemPrompt: `${meta}${IDENTITY_CHAT}\n\nIf the user asks an arithmetic question, answer it directly with just the number.${threadMetadata}`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };

    case "generation":
      return {
        systemPrompt: `${meta}${IDENTITY_CHAT}\n\nThe user wants text generated. Produce it conversationally.${threadMetadata}`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };

    case "read_only_analysis":
      return {
        systemPrompt: `${meta}${IDENTITY_CHAT}\n\nThe user is asking you to analyze or summarize. Read the conversation context and respond.${threadMetadata}`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };

    case "planning":
      return {
        systemPrompt: `${meta}${IDENTITY_CHAT}\n\nThe user is asking for a plan or design. Discuss, compare options, recommend — do not take any side effects.${threadMetadata}`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };

    case "shell_execution":
      return {
        systemPrompt: `${meta}${IDENTITY_CHAT}\n\nThe user gave a direct shell command. Note its intent briefly — do not execute it.${threadMetadata}`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };

    case "external_retrieval":
      return {
        systemPrompt: `${meta}${IDENTITY_CHAT}\n\nThe user needs current/external information. Acknowledge briefly and explain that the agent path is required for retrieval.${threadMetadata}`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };

    case "workspace_action":
    case "workspace_mutation":
      // Defensive — these route to kind: "agent" not "chat".
      return {
        systemPrompt: `${meta}${IDENTITY_CHAT}\n\nThe user wants workspace changes. Briefly note this requires the agent path.${threadMetadata}`,
        toolManifest: NO_TOOLS,
        permissions: MUTATION_SCOPE,
      };

    case "ambiguous":
    default:
      return {
        systemPrompt: threadMetadata
          ? `${meta}${IDENTITY_CHAT}${threadMetadata}`
          : `${meta}${IDENTITY_CHAT}`,
        toolManifest: NO_TOOLS,
        permissions: READ_ONLY_SCOPE,
      };
  }
}

/** External-retrieval prompt pair shape — system + user template + tools. */
export interface RetrievalPrompt {
  systemPrompt: string;
  /** Wraps the raw user query into a retrieval-aware user message. */
  userPromptTemplate: (rawQuery: string) => string;
  toolManifest: PromptToolDef[];
  permissions: PermissionScope;
}

/** Default system prompt for grounded_chat route, keyed to external_retrieval. */
const RETRIEVAL_SYSTEM_PROMPT =
  "You are ALiX, a helpful AI assistant. If you need current information, use the available tools to search. " +
  "Answer fully and directly: you may generate code, designs, analysis, or any requested content in your reply. " +
  "Your workspace is read-only — do not modify files or run shell commands.";

/**
 * Build the grounded_chat (external-retrieval) prompt pair.
 *
 * Layer 3 invariant: takes the canonical-intent label, returns the prompt.
 * The `userPromptTemplate` accepts the raw user query at the call site (the
 * executor owns the raw text — Layer 3 itself never inspects it).
 *
 * Per the canonical taxonomy, the `external_retrieval` intent routes to the
 * `grounded_chat` executor (`src/runtime/route-executor.ts:executeGroundedChat`
 * and `src/daemon/daemon-server.ts:executeGroundedChatRoute`). This function
 * returns the deterministic prompt for that route.
 *
 * Defensive: if a non-retrieval intent is passed (e.g., `ambiguous` from the
 * legacy fallback), the function still returns a sensible retrieval prompt —
 * the executor can choose to fall through to a different route, or use the
 * retrieval prompt as a neutral default.
 */
export function buildExternalRetrievalPrompt(
  intent: ActionIntent,
): RetrievalPrompt {
  // Defensive: warn if the intent is not the canonical external_retrieval.
  // This is a Layer-3 invariant — Layer 3 doesn't re-classify, but it can
  // note when the caller passed something other than what the routing chain
  // should have computed. For now: silent — the executor owns routing.
  void intent;
  const meta = buildIntentMetadataBlock(intent);

  return {
    systemPrompt: `${meta}${RETRIEVAL_SYSTEM_PROMPT}`,
    userPromptTemplate: (rawQuery: string) =>
      `[External retrieval request]\n\n${rawQuery}`,
    toolManifest: RETRIEVAL_TOOLS,
    permissions: NETWORK_SCOPE,
  };
}
