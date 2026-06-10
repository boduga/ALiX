/**
 * task-router.ts — Shared task intent routing for ALiX.
 *
 * Classifies incoming tasks and returns an execution route.
 * Pure classification — no side effects, no execution.
 *
 * Both TUI modes (daemon and no-daemon) call this same router.
 */

import { isShellTask, classifyTask } from "../task-classifier.js";

export type TaskRouteKind = "tool" | "chat" | "grounded_chat" | "agent";

export type TaskRoute =
  | { kind: "tool"; tool: string; args: Record<string, unknown> }
  | { kind: "chat"; prompt: string }
  | { kind: "grounded_chat"; prompt: string; allowedTools: string[] }
  | { kind: "agent"; task: string };

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
 * Classify a task and return the appropriate execution route.
 *
 * Classification priority:
 * 1. Shell commands (bare commands like "ls", "cat", "pwd") → tool via shell.run
 * 2. Natural-language shell phrases ("list files", "where am i") → tool via shell.run
 * 3. Grounded questions (current events, web search, versions) → grounded_chat
 * 4. Research/docs tasks → chat (direct model, no tools)
 * 5. Everything else (feature, bugfix, refactor, unknown) → full agent loop
 */
export function taskRouter(task: string): TaskRoute {
  // 1. Shell tasks — route to shell.run tool
  if (isShellTask(task)) {
    return {
      kind: "tool",
      tool: "shell.run",
      args: { command: task },
    };
  }

  // 2. Natural-language shell phrases — route to shell.run tool
  const naturalShellCommand = matchNaturalShellPhrase(task);
  if (naturalShellCommand) {
    return {
      kind: "tool",
      tool: "shell.run",
      args: { command: naturalShellCommand },
    };
  }

  // 3. Grounded questions — route to model + read-only tools
  if (isGroundedChatTask(task)) {
    return {
      kind: "grounded_chat",
      prompt: task,
      allowedTools: ["web.search", "web_fetch"],
    };
  }

  // 4. Research/doc tasks — route to direct chat
  const taskType = classifyTask(task);
  if (taskType === "research" || taskType === "docs") {
    return {
      kind: "chat",
      prompt: task,
    };
  }

  // 5. Everything else — full agent loop
  return {
    kind: "agent",
    task,
  };
}
