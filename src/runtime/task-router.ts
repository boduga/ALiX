/**
 * task-router.ts — Shared task intent routing for ALiX.
 *
 * Classifies incoming tasks and returns an execution route.
 * Pure classification — no side effects, no execution.
 *
 * Both TUI modes (daemon and no-daemon) call this same router.
 */

import { isShellTask, classifyTask } from "../task-classifier.js";
import {
  classifyActionWithConfidence,
  modelClassifyAction,
  CONFIDENCE_THRESHOLD,
  type ActionIntent,
  type ActionClassification,
} from "./action-classifier.js";
import type { ModelAdapter } from "../providers/types.js";

/** Route kinds the runtime can dispatch. */
export type TaskRouteKind = "direct" | "tool" | "chat" | "grounded_chat" | "agent";

/**
 * Diagnostic attached to routes that pass through the action classifier.
 * Explains the classifier's intent and the route the runtime took.
 */
export interface RouteDiagnostic {
  classification: ActionIntent;
  route: "direct" | "tool" | "grounded_chat" | "agent" | "chat";
  reason: string;
  confidence?: number;
}

/**
 * A classified task ready for execution.
 *
 * - `direct`     — no lifecycle, tools, or artifacts; either an arithmetic
 *                  answer (carried in `answer`) or a single model call.
 * - `tool`       — explicit shell/file tool invocation; legacy path.
 * - `chat`       — compatibility direct chat (no tools, no retrieval).
 * - `grounded_chat` — retrieval executor with a read-only tool allowlist.
 * - `agent`      — full AgentSession / workflow lifecycle.
 */
export type TaskRoute =
  | {
      kind: "direct";
      prompt: string;
      answer?: string;
      diagnostic: RouteDiagnostic;
    }
  | {
      kind: "tool";
      tool: string;
      args: Record<string, unknown>;
      diagnostic?: RouteDiagnostic;
    }
  | {
      kind: "chat";
      prompt: string;
      diagnostic?: RouteDiagnostic;
    }
  | {
      kind: "grounded_chat";
      prompt: string;
      allowedTools: string[];
      diagnostic: RouteDiagnostic;
    }
  | {
      kind: "agent";
      task: string;
      diagnostic: RouteDiagnostic;
    };

/**
 * Detection signals for grounded_chat — tasks that need current or
 * external information the model's training data cannot provide.
 */
const GROUNDED_CHAT_PATTERNS = [
  /\blatest\b/i, /\bcurrent\b/i, /\btoday\b/i, /\brecent\b/i,
  /\bnews\b/i, /\bsearch\b/i, /\blook up\b/i, /\bweb\b/i,
  /\bprice\b/i, /\bversion\b/i, /\brelease\b/i, /\bschedule\b/i,
  /\bcompare current\b/i,
];

/** Returns true if the task likely needs current or web-sourced information. */
export function isGroundedChatTask(task: string): boolean {
  return GROUNDED_CHAT_PATTERNS.some((p) => p.test(task));
}

/**
 * Natural-language phrases that map to shell tool invocations.
 * Bridges the gap between Phase 1 exact-match (isShellTask) and
 * Phase 2 ML classification. These route through ToolExecutor
 * with full policy enforcement — not bypassed execFile.
 *
 * Key: the normalized phrase (lowercased, trimmed).
 * Value: the shell command to execute.
 */
const NATURAL_SHELL_MAP: Record<string, string> = {
  "list files": "ls -la",
  "show files": "ls -la",
  "list directory": "ls -la",
  "show directory": "ls -la",
  "where am i": "pwd",
  "show current directory": "pwd",
};

/**
 * Regex patterns for natural-language file operations.
 */
const FILE_WRITE_PATTERN = /^(?:write|put|save)\s+(.+?)\s+(?:to|into|in|as)\s+(.+)$/i;
const FILE_APPEND_PATTERN = /^(?:append|add)\s+(.+?)\s+(?:to|into)\s+(.+)$/i;
const FILE_DELETE_PATTERN = /^(?:delete|remove|rm)\s+(.+)$/i;
const FILE_READ_PATTERN = /^(?:show|read|cat|display|view|print|get)\s+(.+)$/i;
const FILE_CREATE_WITH_CONTENT = /^create\s+(.+?)\s+(?:with|containing|that says)\s+(.+)$/i;
const FILE_DELETE_DIR_PATTERN = /^(?:delete|remove)\s+(?:directory|folder|dir)\s+(.+)$/i;
const FILE_CREATE_NAMED_PATTERN = /^create\s+a\s+file\s+(?:called|named)\s+(.+?)\s+(?:with|containing)\s+(.+)$/i;
const MAKE_FILE_NAMED_PATTERN = /^make\s+a\s+file\s+(?:called|named)\s+(.+?)\s+(?:with|containing)\s+(.+)$/i;
const CREATE_FILE_PATTERN = /^create\s+file\s+(.+?)\s+(?:with|containing)\s+(.+)$/i;

/**
 * Shell-quote a string safely. Wraps in single quotes and escapes
 * any single quotes inside.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Strip surrounding quotes if present.
 */
function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Guard: reject conceptual/help questions that happen to start with
 * words like "how", "what", "why", "explain", or contain tutorial/example keywords.
 */
function isConceptualFileQuestion(task: string): boolean {
  const normalized = task.trim().toLowerCase();
  return (
    normalized.startsWith("how ") ||
    normalized.startsWith("how do ") ||
    normalized.startsWith("how to ") ||
    normalized.startsWith("what ") ||
    normalized.startsWith("why ") ||
    normalized.startsWith("explain ") ||
    normalized.includes(" tutorial") ||
    normalized.includes(" example") ||
    normalized.includes(" examples")
  );
}

/**
 * Guard: check whether a string looks like a concrete file path or filename.
 */
function looksLikeFileTarget(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  // Accept explicit relative/absolute paths
  if (trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith("/") || trimmed.startsWith("~/")) {
    return true;
  }

  // Accept names with file extensions (allows spaces: "my file.txt", "notes 2026.md")
  if (/^[\w .~/-]+\.[A-Za-z0-9]{1,12}$/.test(trimmed)) {
    return true;
  }

  // Accept quoted names that include a file extension or path separator
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const unquoted = stripOuterQuotes(trimmed);
    return unquoted.includes("/") || /^[\w .~/-]+\.[A-Za-z0-9]{1,12}$/.test(unquoted);
  }

  return false;
}

/**
 * Guard: reject vague/unambiguous delete targets (e.g. "this", "the section").
 */
function looksLikeDeleteTarget(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return false;

  const vagueTargets = [
    "this", "that", "it",
    "the file", "the folder", "the directory",
    "this feature", "the feature",
    "this section", "the section",
  ];

  if (vagueTargets.includes(trimmed)) return false;

  return looksLikeFileTarget(value);
}

/**
 * Try to match a file operation from natural language.
 * Returns a shell command with shell-quoted args if matched, null otherwise.
 */
function matchNaturalFileOperation(task: string): string | null {
  const trimmed = task.trim();

  // Guard 1: Conceptual/help questions are not file operations
  if (isConceptualFileQuestion(trimmed)) {
    return null;
  }

  const content = (s: string) => stripOuterQuotes(s.trim());

  // "write X to Y" → printf '%s\n' 'X' > 'Y'
  let match = trimmed.match(FILE_WRITE_PATTERN);
  if (match) {
    if (!looksLikeFileTarget(match[2].trim())) return null;
    return `printf '%s\\n' ${shellQuote(content(match[1]))} > ${shellQuote(match[2].trim())}`;
  }


  // "create a file called Y with X" -> printf '%s\n' 'X' > 'Y'
  match = trimmed.match(FILE_CREATE_NAMED_PATTERN);
  if (match) {
    if (!looksLikeFileTarget(match[1].trim())) return null;
    return `printf '%s\n' ${shellQuote(content(match[2]))} > ${shellQuote(match[1].trim())}`;
  }

  // "make a file called Y with X" -> printf '%s\n' 'X' > 'Y'
  match = trimmed.match(MAKE_FILE_NAMED_PATTERN);
  if (match) {
    if (!looksLikeFileTarget(match[1].trim())) return null;
    return `printf '%s\n' ${shellQuote(content(match[2]))} > ${shellQuote(match[1].trim())}`;
  }

  // "create file Y with X" -> printf '%s\n' 'X' > 'Y'
  match = trimmed.match(CREATE_FILE_PATTERN);
  if (match) {
    if (!looksLikeFileTarget(match[1].trim())) return null;
    return `printf '%s\n' ${shellQuote(content(match[2]))} > ${shellQuote(match[1].trim())}`;
  }
  // "create Y with X" → printf '%s\n' 'X' > 'Y'
  match = trimmed.match(FILE_CREATE_WITH_CONTENT);
  if (match) {
    if (!looksLikeFileTarget(match[1].trim())) return null;
    return `printf '%s\\n' ${shellQuote(content(match[2]))} > ${shellQuote(match[1].trim())}`;
  }

  // "append X to Y" → printf '%s\n' 'X' >> 'Y'
  match = trimmed.match(FILE_APPEND_PATTERN);
  if (match) {
    if (!looksLikeFileTarget(match[2].trim())) return null;
    return `printf '%s\\n' ${shellQuote(content(match[1]))} >> ${shellQuote(match[2].trim())}`;
  }

  // "delete directory Y" → rm -rf -- 'Y'
  match = trimmed.match(FILE_DELETE_DIR_PATTERN);
  if (match) {
    if (!looksLikeFileTarget(match[1].trim())) return null;
    return `rm -rf -- ${shellQuote(match[1].trim())}`;
  }

  // "delete Y" → rm -- 'Y'
  match = trimmed.match(FILE_DELETE_PATTERN);
  if (match) {
    if (!looksLikeDeleteTarget(match[1].trim())) return null;
    return `rm -- ${shellQuote(match[1].trim())}`;
  }

  // "show Y" → cat -- 'Y'
  match = trimmed.match(FILE_READ_PATTERN);
  if (match) {
    if (!looksLikeFileTarget(match[1].trim())) return null;
    return `cat -- ${shellQuote(match[1].trim())}`;
  }

  return null;
}

/**
 * Normalize task text for natural-phrase matching.
 */
function normalizePhrase(task: string): string {
  return task.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "");
}

/**
 * Check if a task matches a natural-language phrase that maps to a shell tool.
 * Returns the shell command if matched, null otherwise.
 */
function matchNaturalShellPhrase(task: string): string | null {
  const normalized = normalizePhrase(task);
  return NATURAL_SHELL_MAP[normalized] ?? null;
}

/**
 * Build a `RouteDiagnostic` from the action classifier's output. The
 * `route` field is supplied by the caller because the same intent can
 * map to different routes in different contexts (e.g. `workspace_action`
 * always maps to `agent`).
 */
function toDiagnostic(
  c: ActionClassification,
  route: RouteDiagnostic["route"],
): RouteDiagnostic {
  return {
    classification: c.intent,
    route,
    reason: c.reason,
    confidence: c.confidence,
  };
}

/**
 * Classify a task and return the appropriate execution route.
 *
 * When `opts.classifierProvider` is provided, prompts that the deterministic
 * classifier scores below `CONFIDENCE_THRESHOLD` (0.7) are passed to a
 * model-based fallback for reclassification. When no provider is configured,
 * the router stays purely deterministic.
 *
 * Classification priority:
 *
 *  1. Action classifier — workspace_action (always dominates) → agent.
 *  2. Pure arithmetic — direct answer (no model call, no tools).
 *  3. Shell commands (bare commands like "ls", "cat", "pwd") → tool
 *  4. Natural-language shell phrases ("list files", "where am i") → tool
 *  5. Natural-language file operations ("write X to Y") → tool
 *  6. Action classifier (with optional model fallback):
 *       - external_retrieval → grounded_chat
 *       - standalone_generation → direct (one model call)
 *       - ambiguous → (may reclassify via model) then legacy fallback
 *  7. Legacy fallback: research → chat, else → agent.
 *
 * Steps 1-5 are always deterministic — the model fallback only activates
 * on ambiguous/low-confidence results from step 6.
 */
export async function taskRouter(
  task: string,
  opts?: { classifierProvider?: ModelAdapter },
): Promise<TaskRoute> {
  // 1. Deterministic classification with confidence score.
  const classification = classifyActionWithConfidence(task);

  if (classification.intent === "workspace_action") {
    return {
      kind: "agent",
      task,
      diagnostic: toDiagnostic({ ...classification, intent: "workspace_action" }, "agent"),
    };
  }

  // 2. Pure arithmetic — direct answer. Dominates every other signal.
  //    The deterministic classifier already evaluated the expression, so
  //    read the pre-computed answer from the classification result.
  if (classification.intent === "arithmetic" && classification.arithmeticAnswer !== undefined) {
    return {
      kind: "direct",
      prompt: task,
      answer: classification.arithmeticAnswer,
      diagnostic: {
        classification: "arithmetic",
        route: "direct",
        reason: "prompt is a pure arithmetic expression",
      },
    };
  }

  // 3. Shell tasks — route to shell.run tool
  if (isShellTask(task)) {
    return {
      kind: "tool",
      tool: "shell.run",
      args: { command: task },
    };
  }

  // 4. Natural-language shell phrases
  const naturalShellCommand = matchNaturalShellPhrase(task);
  if (naturalShellCommand) {
    return {
      kind: "tool",
      tool: "shell.run",
      args: { command: naturalShellCommand },
    };
  }

  // 5. Natural-language file operations — route to tool unconditionally
  //    when the pattern matches. The regex patterns (write X to Y, show Y,
  //    delete Y, etc.) are precise enough that false positives are rare, and
  //    the `isConceptualFileQuestion` / `looksLikeFileTarget` guards reject
  //    fuzzy/non-file prompts. Deferring these to the model fallback would
  //    silently drop legitimate file operations when the classifier returns
  //    ambiguous (e.g. "write hello to test.txt" has no workspace anchor).
  const naturalFileCommand = matchNaturalFileOperation(task);
  if (naturalFileCommand) {
    return {
      kind: "tool",
      tool: "shell.run",
      args: { command: naturalFileCommand },
    };
  }

  // 6. High-confidence deterministic results — no model call needed.
  if (classification.confidence >= CONFIDENCE_THRESHOLD) {
    if (classification.intent === "external_retrieval") {
      return {
        kind: "grounded_chat",
        prompt: task,
        allowedTools: ["web.search", "web_fetch"],
        diagnostic: toDiagnostic(classification, "grounded_chat"),
      };
    }
    if (classification.intent === "standalone_generation") {
      return {
        kind: "direct",
        prompt: task,
        diagnostic: toDiagnostic(classification, "direct"),
      };
    }
  }

  // 7. Low-confidence / ambiguous — try model-based fallback when configured.
  if (
    opts?.classifierProvider &&
    (classification.intent === "ambiguous" || classification.confidence < CONFIDENCE_THRESHOLD)
  ) {
    const modelResult = await modelClassifyAction(task, opts.classifierProvider);
    // Use the model's classification instead of the deterministic result.
    if (modelResult.intent !== "ambiguous") {
      // Route based on the model's classification.
      if (modelResult.intent === "workspace_action") {
        return {
          kind: "agent",
          task,
          diagnostic: toDiagnostic(modelResult, "agent"),
        };
      }
      if (modelResult.intent === "external_retrieval") {
        return {
          kind: "grounded_chat",
          prompt: task,
          allowedTools: ["web.search", "web_fetch"],
          diagnostic: toDiagnostic(modelResult, "grounded_chat"),
        };
      }
      if (modelResult.intent === "standalone_generation") {
        return {
          kind: "direct",
          prompt: task,
          diagnostic: toDiagnostic(modelResult, "direct"),
        };
      }
      // model returned arithmetic — unlikely but handle it as direct.
      if (modelResult.intent === "arithmetic") {
        return {
          kind: "direct",
          prompt: task,
          diagnostic: toDiagnostic(modelResult, "direct"),
        };
      }
      // Fall through to legacy path for remaining ambiguities.
    }
  }

  // 8. ambiguous — legacy fallback with workspace-write carve-out.
  const trimmedTask = task.trim();
  const hasWorkspaceWriteIntent =
    /^(?:write|put|save|create|make|append|delete|remove|rm)\b[^.\n]*\b(?:to|into|in|as|from|on)\b/i.test(trimmedTask);
  if (hasWorkspaceWriteIntent) {
    return {
      kind: "agent",
      task,
      diagnostic: toDiagnostic(classification, "agent"),
    };
  }

  const taskType = classifyTask(task);
  if (taskType === "research" || taskType === "docs") {
    return {
      kind: "chat",
      prompt: task,
    };
  }

  return {
    kind: "agent",
    task,
    diagnostic: toDiagnostic(classification, "agent"),
  };
}
