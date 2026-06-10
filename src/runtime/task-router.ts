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
 * Classify a task and return the appropriate execution route.
 *
 * Classification priority:
 * 1. Shell commands (bare commands like "ls", "cat", "pwd") → tool via shell.run
 * 2. Grounded questions (current events, web search, versions) → grounded_chat
 * 3. Research/docs tasks → chat (direct model, no tools)
 * 4. Everything else (feature, bugfix, refactor, unknown) → full agent loop
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

  // 2. Grounded questions — route to model + read-only tools
  if (isGroundedChatTask(task)) {
    return {
      kind: "grounded_chat",
      prompt: task,
      allowedTools: ["web.search", "web_fetch"],
    };
  }

  // 3. Research/doc tasks — route to direct chat
  const taskType = classifyTask(task);
  if (taskType === "research" || taskType === "docs") {
    return {
      kind: "chat",
      prompt: task,
    };
  }

  // 4. Everything else — full agent loop
  return {
    kind: "agent",
    task,
  };
}
