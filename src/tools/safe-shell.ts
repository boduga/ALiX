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
  "rg",            // Ripgrep

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
 * Check if a command is in the safe shell whitelist
 */
export function isSafeShellCommand(command: string): boolean {
  const trimmed = command.trim();

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
    /^rg\s+['"][^'"]*['"]\s+[\w\/.\-_\s]+$/,

    // wc with file
    /^wc\s+[\w\/.\-_\s]+$/,

    // git status with optional flags
    /^git\s+status(\s+--?[a-z]+)*$/,

    // git log with commits count
    /^git\s+log(\s+--?oneline)?(\s+-n\d+)?$/,

    // git diff with optional staged flag
    /^git\s+diff(\s+--staged)?(\s+--?[a-z]+)*$/,

    // git branch (list only)
    /^git\s+branch(\s+-?[a-z]+)*$/,

    // git remote -v
    /^git\s+remote\s+-v$/,

    // git show with commit ref
    /^git\s+show(\s+--?[a-z]+)*(\s+[\w.\-]+)?$/,

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
export async function executeSafeShell(command: string): Promise<{
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
    const { execSync } = await import("child_process");
    const output = execSync(trimmed, {
      encoding: "utf-8",
      maxBuffer: SAFE_SHELL_MAX_BUFFER_BYTES,
      timeout: SAFE_SHELL_TIMEOUT_MS,
    });

    return { allowed: true, output };
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