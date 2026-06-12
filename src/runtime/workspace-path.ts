/**
 * workspace-path.ts — Central file-path safety resolver.
 *
 * All file tools, patch operations, and policy checks should resolve
 * paths through this single resolver instead of duplicating logic.
 */

import { resolve } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResolvedPath = {
  absolute: string;
  insideWorkspace: boolean;
  protected: boolean;
  sensitive: boolean;
  reason?: string;
};

// ---------------------------------------------------------------------------
// Sensitive path patterns
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS = [
  /(^|\/)\.ssh($|\/)/,
  /(^|\/)\.gnupg($|\/)/,
  /(^|\/)\..*rc($|\/)/,
  /(^|\/)\.env(\..*)?$/,
  /(^|\/)known_hosts$/,
  /(^|\/)id_rsa/,
  /(^|\/)id_ed25519/,
  /(^|\/)\.alix($|\/)/,
  /(^|\/)\.git($|\/)/,
];

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export class WorkspacePathResolver {
  constructor(
    private readonly workspaceRoot: string,
    private readonly protectedPaths: string[] = [],
  ) {}

  resolve(rawPath: string): string {
    if (rawPath.startsWith("/")) return rawPath;
    if (rawPath.startsWith("~")) return resolve(homedir(), rawPath.slice(1));
    return resolve(this.workspaceRoot, rawPath);
  }

  isInWorkspace(absolutePath: string): boolean {
    return absolutePath.startsWith(this.workspaceRoot);
  }

  isProtected(absolutePath: string): boolean {
    const relative = absolutePath.startsWith(this.workspaceRoot)
      ? absolutePath.slice(this.workspaceRoot.length + 1)
      : absolutePath;
    for (const pattern of this.protectedPaths) {
      if (this.matchesPattern(absolutePath, pattern)) return true;
      if (this.matchesPattern(relative, pattern)) return true;
    }
    return false;
  }

  isSensitive(absolutePath: string): boolean {
    return SENSITIVE_PATTERNS.some((re) => re.test(absolutePath));
  }

  check(rawPath: string): ResolvedPath {
    const absolute = this.resolve(rawPath);
    const sensitive = this.isSensitive(absolute);
    const insideWorkspace = this.isInWorkspace(absolute);
    const protected_ = this.isProtected(absolute);

    if (sensitive) {
      return { absolute, insideWorkspace, protected: protected_, sensitive, reason: "Path matches a sensitive system pattern" };
    }
    if (protected_ && insideWorkspace) {
      return { absolute, insideWorkspace, protected: true, sensitive: false, reason: "Path matches a protected pattern" };
    }
    return { absolute, insideWorkspace, protected: false, sensitive: false };
  }

  isTraversalSafe(rawPath: string): boolean {
    if (rawPath.startsWith("..")) return false;
    if (rawPath.startsWith("/")) return rawPath.startsWith(this.workspaceRoot);
    if (rawPath.includes("../")) return false;
    if (rawPath.startsWith("~")) return false;
    if (rawPath.startsWith("$")) return false;
    return true;
  }

  private matchesPattern(path: string, pattern: string): boolean {
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      return path === prefix || path.startsWith(prefix + "/");
    }
    if (pattern.endsWith(".*")) {
      return path === pattern.slice(0, -2) || path.startsWith(pattern.slice(0, -1));
    }
    return path === pattern;
  }
}
