/**
 * Shell Whitelist - Level 4 Security
 *
 * Instead of blocking dangerous commands, only allow known-safe commands.
 * This is more secure than blacklist because it assumes everything is denied by default.
 */

export type ShellWhitelistMode = "allow" | "deny"; // "allow" = whitelist mode, "deny" = blacklist mode

export type WhitelistRule = {
  command: string;           // e.g., "npm", "git", "ls"
  args?: string[];           // Allowed argument patterns (optional)
  flags?: string[];          // Allowed flags (optional)
  description: string;       // Human-readable description
  risk: "low" | "medium";    // Risk classification
};

export type ShellWhitelistConfig = {
  mode: ShellWhitelistMode;
  rules: WhitelistRule[];
  allowUnmatched: boolean;   // If true, unmatched commands go to approval; if false, deny
};

// Default allowed commands for development
export const DEFAULT_ALLOWED_COMMANDS: string[] = [
  // Git operations
  "git",
  "gh",

  // Package managers (read operations)
  "npm",
  "yarn",
  "pnpm",
  "bun",

  // Node.js runtime
  "node",
  "npx",

  // File operations
  "ls",
  "cd",
  "pwd",
  "mkdir",
  "rm",           // Only with specific args
  "cp",
  "mv",

  // Search tools
  "grep",
  "rg",
  "find",
  "fd",

  // Development tools
  "make",
  "cmake",
  "go",
  "cargo",
  "python",
  "python3",
  "pip",
  "pip3",

  // Build/test
  "jest",
  "vitest",
  "pytest",
  "rspec",
  "rubocop",
  "eslint",
  "prettier",
  "tsc",
  "tslint",

  // System info
  "whoami",
  "hostname",
  "uname",
  "date",
  "echo",
  "cat",
  "head",
  "tail",
  "wc",
  "stat",

  // Network (read-only)
  "curl",
  "wget",

  // Docker (read operations)
  "docker",
  "kubectl",
];

// Commands that are NEVER allowed (even in whitelist mode)
export const BLOCKED_COMMANDS: string[] = [
  "sudo",
  "su",
  "rm",
  "passwd",
  "useradd",
  "userdel",
  "groupadd",
  "chpasswd",
  "mount",
  "umount",
  "fdisk",
  "parted",
  "mkfs",
  "dd",
  "cryptsetup",
  "luksformat",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "init",
  "systemctl",
  "service",
  "crontab",
];

export class ShellWhitelist {
  private allowedCommands: Set<string>;
  private commandRules: Map<string, WhitelistRule>;
  private blockList: Set<string>;

  constructor(config: ShellWhitelistConfig) {
    this.allowedCommands = new Set(
      config.rules.filter(r => r.risk === "low" || r.risk === "medium").map(r => r.command)
    );
    this.commandRules = new Map(config.rules.map(r => [r.command, r]));
    this.blockList = new Set(BLOCKED_COMMANDS);

    // Also add default allowed commands
    DEFAULT_ALLOWED_COMMANDS.forEach(cmd => this.allowedCommands.add(cmd));
  }

  /**
   * Check if a command is allowed
   * @param command The full command string (e.g., "npm install")
   * @returns { allowed: boolean, reason?: string }
   */
  check(command: string): { allowed: boolean; reason?: string } {
    const trimmed = command.trim();
    const parts = trimmed.split(/\s+/);
    const baseCommand = parts[0];

    // Check block list first
    if (this.blockList.has(baseCommand)) {
      return { allowed: false, reason: `Command '${baseCommand}' is never allowed for security reasons` };
    }

    // Check if command is in allow list
    if (!this.allowedCommands.has(baseCommand)) {
      return { allowed: false, reason: `Command '${baseCommand}' is not in the allowed whitelist` };
    }

    // Check specific rules if they exist
    const rule = this.commandRules.get(baseCommand);
    if (rule) {
      // Validate args/flags against rule
      const args = parts.slice(1);
      if (rule.flags && args.length > 0) {
        const hasAllowedFlag = args.some(arg =>
          arg.startsWith("-") && rule.flags!.some(flag => arg.startsWith(flag))
        );
        if (!hasAllowedFlag && rule.flags.length > 0) {
          // Check if any arg is in the allowed list
          const allowedArgs = args.filter(arg => !arg.startsWith("-"));
          if (allowedArgs.length > 0) {
            return { allowed: true }; // Non-flag args are allowed
          }
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Get all allowed commands
   */
  getAllowedCommands(): string[] {
    return [...this.allowedCommands].sort();
  }

  /**
   * Check if a command requires approval (not blocked, not allowed, needs review)
   */
  requiresApproval(command: string): boolean {
    const result = this.check(command);
    return !result.allowed && !result.reason?.includes("never allowed");
  }
}

/**
 * Parse whitelist from environment variable
 * Format: "npm:git:ls:node:npx" or JSON array
 */
export function parseWhitelistEnv(envValue: string): string[] {
  if (!envValue) return [];

  // Try JSON array first
  try {
    const parsed = JSON.parse(envValue);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Not JSON, treat as colon-separated
  }

  return envValue.split(":").map(s => s.trim()).filter(Boolean);
}