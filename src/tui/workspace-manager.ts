/**
 * workspace-manager.ts — Workspace switching commands for the TUI.
 *
 * Parses /workspaces, /switch, /open commands and resolves workspace references
 * by path, name, or path suffix.
 */

import { basename, resolve, join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import type { WorkspaceEntry } from "../daemon/workspace-registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkspaceMatch =
  | { status: "unique"; workspace: WorkspaceEntry }
  | { status: "ambiguous"; matches: WorkspaceEntry[]; partial: string }
  | { status: "not_found" };

export type WorkspaceCommandResult =
  | { handled: false }
  | { handled: true; changedWorkspace: boolean; message: string; nextCwd?: string };

export interface WorkspaceManagerDeps {
  listWorkspaces(): Promise<WorkspaceEntry[]>;
  recordWorkspaceActivity(cwd: string): Promise<void>;
  getWorkspace(path: string): Promise<WorkspaceEntry | undefined>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMMAND_PREFIXES = ["/workspaces", "/workspace", "/ws"] as const;
const SWITCH_PREFIXES = ["/switch", "/sw"] as const;

// ---------------------------------------------------------------------------
// WorkspaceManager
// ---------------------------------------------------------------------------

export class WorkspaceManager {
  private lastAmbiguity: { partial: string; matches: WorkspaceEntry[] } | null = null;
  private deps: WorkspaceManagerDeps;

  constructor(deps: WorkspaceManagerDeps) {
    this.deps = deps;
  }

  // ---- Public entry point ----

  /**
   * Attempt to handle `input` as a workspace command.
   * Returns `{ handled: false }` when the input does not match any command prefix.
   */
  async tryHandleCommand(input: string): Promise<WorkspaceCommandResult> {
    const parsed = this.parseCommand(input);
    if (!parsed) return { handled: false };

    const { cmd, arg } = parsed;

    if (isListCommand(cmd)) return this.handleList();
    if (isSwitchCommand(cmd)) return this.handleSwitch(arg);
    if (cmd === "/open") return this.handleOpen(arg);

    return { handled: false };
  }

  // ---- Command parsing ----

  /**
   * Parse `input` into a command + argument pair, or null if no command is matched.
   */
  private parseCommand(input: string): { cmd: string; arg: string } | null {
    const trimmed = input.trim();

    // List command prefixes — exact match only (no argument)
    for (const prefix of COMMAND_PREFIXES) {
      if (trimmed === prefix) return { cmd: prefix, arg: "" };
    }

    // Switch prefixes — exact match (no arg) or prefix followed by a space + arg
    for (const prefix of SWITCH_PREFIXES) {
      if (trimmed === prefix) return { cmd: prefix, arg: "" };
      if (trimmed.startsWith(prefix + " ")) {
        return { cmd: prefix, arg: trimmed.slice(prefix.length + 1) };
      }
    }

    // /open — requires an argument after a space
    if (trimmed === "/open") return { cmd: "/open", arg: "" };
    if (trimmed.startsWith("/open ")) {
      return { cmd: "/open", arg: trimmed.slice(6) };
    }

    return null;
  }

  // ---- Handlers ----

  private async handleList(): Promise<WorkspaceCommandResult> {
    const workspaces = await this.deps.listWorkspaces();

    if (workspaces.length === 0) {
      return {
        handled: true,
        changedWorkspace: false,
        message: "No workspaces recorded yet.",
      };
    }

    const lines = workspaces.map((w) => {
      const marker = w.status === "active" ? "●" : "○";
      return `  ${marker} ${w.name} (${w.path}) — last used: ${new Date(w.lastUsed).toLocaleString()}`;
    });

    return {
      handled: true,
      changedWorkspace: false,
      message: `Workspaces:\n${lines.join("\n")}`,
    };
  }

  private async handleSwitch(arg: string): Promise<WorkspaceCommandResult> {
    // 1. Numeric selection from last ambiguity cache
    if (this.lastAmbiguity && /^\d+$/.test(arg)) {
      const idx = parseInt(arg, 10) - 1; // [1] displayed for first entry → index 0
      if (idx >= 0 && idx < this.lastAmbiguity.matches.length) {
        const workspace = this.lastAmbiguity.matches[idx];
        this.lastAmbiguity = null;
        await this.deps.recordWorkspaceActivity(workspace.path);
        return {
          handled: true,
          changedWorkspace: true,
          message: `Switched to workspace: ${workspace.name}`,
          nextCwd: workspace.path,
        };
      }
      // Invalid numeric — preserve cache for retry, but let the user
      // know the selection was out of range.
      return {
        handled: true,
        changedWorkspace: false,
        message: `Invalid selection: ${arg}. Choose a number between 1 and ${this.lastAmbiguity.matches.length}, or type /switch with a different name or path.`,
      };
    }

    // 2. Resolve by path / name / suffix
    const match = await this.resolveWorkspace(arg);

    if (match.status === "unique") {
      this.lastAmbiguity = null;
      await this.deps.recordWorkspaceActivity(match.workspace.path);
      return {
        handled: true,
        changedWorkspace: true,
        message: `Switched to workspace: ${match.workspace.name}`,
        nextCwd: match.workspace.path,
      };
    }

    if (match.status === "ambiguous") {
      this.lastAmbiguity = { partial: match.partial, matches: match.matches };
      const lines = match.matches.map((w, i) => `  [${i + 1}] ${w.name} (${w.path})`);
      return {
        handled: true,
        changedWorkspace: false,
        message: `Multiple workspaces match "${match.partial}":\n${lines.join("\n")}`,
      };
    }

    // not_found
    this.lastAmbiguity = null;
    return {
      handled: true,
      changedWorkspace: false,
      message: `No workspace found matching "${arg}". Use /workspaces to list all workspaces.`,
    };
  }

  private async handleOpen(rawPath: string): Promise<WorkspaceCommandResult> {
    if (!rawPath.trim()) {
      return { handled: true, changedWorkspace: false, message: "Usage: /open <path>" };
    }

    // Expand tilde to home directory
    let resolved = rawPath;
    if (resolved.startsWith("~/")) {
      resolved = join(homedir(), resolved.slice(2));
    } else if (resolved === "~") {
      resolved = homedir();
    }

    // Resolve against process cwd (handles relative paths)
    resolved = resolve(resolved);

    // Validate that the target exists and is a directory
    let isDir = false;
    try {
      const { statSync } = await import("node:fs");
      isDir = statSync(resolved).isDirectory();
    } catch {
      // statSync threw (ENOENT, EACCES, etc.)
    }
    if (!existsSync(resolved)) {
      return {
        handled: true,
        changedWorkspace: false,
        message: `Path does not exist: ${resolved}`,
      };
    }
    if (!isDir) {
      return {
        handled: true,
        changedWorkspace: false,
        message: `Not a directory: ${resolved}`,
      };
    }

    await this.deps.recordWorkspaceActivity(resolved);
    return {
      handled: true,
      changedWorkspace: true,
      message: `Opened workspace: ${resolved}`,
      nextCwd: resolved,
    };
  }

  // ---- Workspace resolution ----

  /**
   * Resolve a free-form `arg` to a specific workspace.
   *
   * Resolution order:
   *  1. Exact path match (arg === w.path)
   *  2. Exact name match (arg === w.name), must be unique
   *  3. Unique path suffix (w.path ends with "/" + arg), must be unique
   *  4. Not found
   */
  private async resolveWorkspace(arg: string): Promise<WorkspaceMatch> {
    if (!arg) return { status: "not_found" };

    const workspaces = await this.deps.listWorkspaces();

    // 1. Exact path match
    const byPath = workspaces.filter((w) => w.path === arg);
    if (byPath.length === 1) return { status: "unique", workspace: byPath[0] };
    if (byPath.length > 1) {
      return { status: "ambiguous", matches: byPath, partial: arg };
    }

    // 2. Exact name match (must be unique)
    const byName = workspaces.filter((w) => w.name === arg);
    if (byName.length === 1) return { status: "unique", workspace: byName[0] };
    if (byName.length > 1) {
      return { status: "ambiguous", matches: byName, partial: arg };
    }

    // 3. Unique path suffix
    const bySuffix = workspaces.filter((w) => w.path.endsWith("/" + arg));
    if (bySuffix.length === 1) return { status: "unique", workspace: bySuffix[0] };
    if (bySuffix.length > 1) {
      return { status: "ambiguous", matches: bySuffix, partial: arg };
    }

    // 4. Not found
    return { status: "not_found" };
  }
}

// ---------------------------------------------------------------------------
// Command prefix helpers
// ---------------------------------------------------------------------------

function isListCommand(cmd: string): boolean {
  return (COMMAND_PREFIXES as readonly string[]).includes(cmd);
}

function isSwitchCommand(cmd: string): boolean {
  return (SWITCH_PREFIXES as readonly string[]).includes(cmd);
}

// ---------------------------------------------------------------------------
// Prompt label helper
// ---------------------------------------------------------------------------

/**
 * Format a prompt label `[<name>] > ` with at most 28 characters.
 *
 * Priority order for the label content:
 *  1. `workspaceName` (trimmed, non-empty)
 *  2. `basename(workspacePath)`
 *  3. `basename(cwd)`
 *
 * When the label exceeds 28 characters it is truncated with an ellipsis (25 + "...").
 */
export function promptLabel(
  cwd: string,
  workspaceName?: string,
  workspacePath?: string,
): string {
  const raw = workspaceName?.trim() || basename(workspacePath || "") || basename(cwd);
  const label = raw.length > 28 ? raw.slice(0, 25) + "..." : raw;
  return `[${label}] > `;
}
