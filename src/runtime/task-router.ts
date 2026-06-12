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
 * Regex patterns for natural-language file operations.
 */
const FILE_WRITE_PATTERN = /^(?:write|put|save)\s+(.+?)\s+(?:to|into|in|as)\s+(.+)$/i;
const FILE_APPEND_PATTERN = /^(?:append|add)\s+(.+?)\s+(?:to|into)\s+(.+)$/i;
const FILE_DELETE_PATTERN = /^(?:delete|remove|rm)\s+(.+)$/i;
const FILE_READ_PATTERN = /^(?:show|read|cat|display|view|print|get)\s+(.+)$/i;
const FILE_CREATE_WITH_CONTENT = /^create\s+(.+?)\s+(?:with|containing|that says)\s+(.+)$/i;
const FILE_DELETE_DIR_PATTERN = /^(?:delete|remove)\s+(?:directory|folder|dir)\s+(.+)$/i;

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
 * Classify a task and return the appropriate execution route.
 *
 * Classification priority:
 * 1. Shell commands (bare commands like "ls", "cat", "pwd") → tool via shell.run
 * 2. Natural-language shell phrases ("list files", "where am i") → tool via shell.run
 * 2b. Natural-language file operations ("write X to Y") → tool via shell.run
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

  // 2b. Natural-language file operations — route to shell.run tool
  const naturalFileCommand = matchNaturalFileOperation(task);
  if (naturalFileCommand) {
    return {
      kind: "tool",
      tool: "shell.run",
      args: { command: naturalFileCommand },
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
