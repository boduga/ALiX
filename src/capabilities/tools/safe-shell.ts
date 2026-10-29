/**
 * Safe Shell Operations - Level 5 Security
 *
 * A curated whitelist of shell operations that are safe to execute
 * without additional prompts or restrictions.
 */

// Buffer and timeout limits for safe shell operations
// 1MB = 1024 * 1024 bytes - sufficient for typical command output
// (git diff, log, status, file contents, directory listings)
const SAFE_SHELL_MAX_BUFFER_BYTES = 1024 * 1024;

// 30 seconds - long enough for git operations, network queries,
// or file reading; short enough to prevent runaway processes
const SAFE_SHELL_TIMEOUT_MS = 30_000;

export const SAFE_SHELL_COMMANDS = [
  // Navigation & info
  "pwd",           // Print working directory
  "echo",          // Echo text (for output)
  "printf",        // Formatted output
  "date",          // Current date/time
  "whoami",        // Current user
  "id",            // User info

  // Directory listing (read-only)
  "ls",            // List files
  "dir",           // Windows-compatible listing

  // Git queries (read-only)
  "git status",    // Repository status
  "git log",       // Commit history
  "git log --oneline",  // Oneline history
  "git diff",      // Changes
  "git diff --staged",  // Staged changes
  "git branch",    // Branches
  "git remote -v", // Remotes
  "git show",      // Show commit details
  "git show --stat", // Show commit with stats

  // File queries (read-only)
  "cat",           // Read file contents
  "head",          // First lines
  "tail",          // Last lines
  "wc",            // Word/line count
  "stat",          // File stats
  "file",          // File type
  "md5sum",        // MD5 hash
  "sha256sum",     // SHA256 hash

  // Search (read-only)
  "grep",          // Text search

  // Node/npm queries (read-only)
  "node --version",    // Node version
  "npm --version",      // npm version
  "npm list",           // Installed packages
  "npm list --depth=0", // Top-level packages
  "which",             // Command location
  "type",              // Command type
  "command -v",        // Find command
] as const;

export type SafeShellCommand = typeof SAFE_SHELL_COMMANDS[number];

/**
 * Extract filesystem operands from commands admitted by isSafeShellCommand.
 * The whitelist grammar deliberately excludes quoting for file operands, so
 * whitespace tokenization is sufficient and fails closed for traversal.
 */
export function safeShellPathOperands(command: string): string[] {
  const tokens = command.trim().split(/\s+/);
  const executable = tokens[0];
  if (executable === "cat" || executable === "stat" || executable === "file" || executable === "md5sum" || executable === "sha256sum") {
    return tokens.slice(1);
  }
  if (executable === "head" || executable === "tail") {
    return tokens.slice(1).filter((token, index, all) => {
      if (token === "-n") return false;
      if (index > 0 && all[index - 1] === "-n") return false;
      return !/^\d+$/.test(token);
    });
  }
  if (executable === "wc") return tokens.slice(1).filter((token) => !token.startsWith("-"));
  if (executable === "grep" || executable === "rg") {
    const quotedPattern = command.match(/^\w+\s+(['"])[\s\S]*?\1\s+([\s\S]+)$/);
    return quotedPattern?.[2]?.trim().split(/\s+/) ?? [];
  }
  return [];
}

/**
 * Check if a command is in the safe shell whitelist
 */
export function isSafeShellCommand(command: string): boolean {
  const trimmed = command.trim();
  // A "safe" command must never invoke shell composition or expansion.
  if (/[;&|`$<>\n\r]/.test(trimmed)) return false;

  // Exact match
  if (SAFE_SHELL_COMMANDS.includes(trimmed as SafeShellCommand)) {
    return true;
  }

  // Allow safe commands with benign arguments
  const safePatterns = [
    // echo with arguments (common for output)
    /^echo(\s+\S+)*$/,

    // ls variants (only listing, no recursive dangerous flags)
    /^ls(\s+-?[laR1d]+)?\s*$/,
    /^dir(\s+-?[la]+)?\s*$/,

    // cat with file path (no pipes)
    /^cat\s+[\w\/.\-_]+$/,

    // head/tail with line count and file (without -n flag)
    /^head\s+\d+\s+[\w\/.\-_]+$/,
    /^head\s+-n\s*\d+\s+[\w\/.\-_]+$/,
    /^tail\s+\d+\s+[\w\/.\-_]+$/,
    /^tail\s+-n\s*\d+\s+[\w\/.\-_]+$/,

    // grep with pattern and file (no pipes, no exec)
    /^grep\s+['"][^'"]*['"]\s+[\w\/.\-_\s]+$/,

    // wc with file
    /^wc\s+[\w\/.\-_\s]+$/,

    // git status with optional flags
    /^git\s+status(\s+--?[a-z]+)*$/,

    // git log with commits count
    /^git\s+log(\s+--?oneline)?(\s+-n\d+)?$/,

    // git diff: presentation-only allowlist. Broad flag matching is unsafe:
    // `--output` can write a file and option/value ambiguity can turn another
    // flag token into that output filename.
    /^git\s+diff(?:\s+(?:--staged|--stat|--name-only|--name-status))*$/,

    // git branch — LISTING ONLY.
    //
    // The previous pattern was `/^git\s+branch(\s+-?[a-z]+)*$/`, which accepts
    // `git branch -d <name>`: a destructive command classified as read-only, so
    // it skipped the approval gate. An allowlist of flags is the only safe form
    // here; `[a-z]+` accepts every mutating flag ever added.
    /^git\s+branch$/,
    /^git\s+branch\s+(-a|--all|-r|--remotes|-v|--verbose|-vv|--list|--show-current)$/,

    // git remote -v
    /^git\s+remote\s+-v$/,

    // git show: allow only explicitly non-mutating presentation flags.
    // Broad `--?[a-z]+` admitted effect-capable options such as `--output`.
    /^git\s+show(?:\s+(?:--stat|--oneline|--summary|--name-only|--name-status))*(?:\s+[\w.\-]+)?$/,

    // npm version commands
    /^npm\s+list(\s+--depth=?\d+)?$/,
    /^npm\s+--version$/,
    /^node\s+--version$/,
  ];

  return safePatterns.some(pattern => pattern.test(trimmed));
}

/**
 * Execute a safe shell command with output validation
 */
export async function executeSafeShell(command: string, options: { cwd?: string; envAllowlist?: string[] } = {}): Promise<{
  allowed: boolean;
  output?: string;
  error?: string;
}> {
  const trimmed = command.trim();

  if (!isSafeShellCommand(trimmed)) {
    return {
      allowed: false,
      error: `Command '${trimmed}' is not in the safe shell whitelist. Use an explicit tool instead.`
    };
  }

  try {
    const { runCommand } = await import("./shell-tool.js");
    const result = await runCommand({
      command: trimmed,
      cwd: options.cwd ?? process.cwd(),
      timeoutMs: SAFE_SHELL_TIMEOUT_MS,
      envAllowlist: options.envAllowlist,
    });
    return result.kind === "success"
      ? { allowed: true, output: (result.output ?? "").slice(0, SAFE_SHELL_MAX_BUFFER_BYTES) }
      : { allowed: true, error: result.message };
  } catch (err) {
    return {
      allowed: true,  // Still allowed, but command failed
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Get list of allowed safe shell commands
 */
export function getAllowedSafeCommands(): string[] {
  return [...SAFE_SHELL_COMMANDS];
}
