/**
 * ownership-claim-compiler.ts — Convert glob patterns to portable ownership claims.
 *
 * Conservative conversion: unrepresentable wildcards widen scope to the
 * nearest safe parent directory. This may reduce concurrency but never
 * under-protects the workspace.
 *
 * Security: traversal patterns, absolute paths, and empty paths are rejected.
 */

import type { WorkerOwnershipClaim } from "./coordination-types.js";

export type OwnershipClaimCompileResult = {
  claims: WorkerOwnershipClaim[];
  warnings: string[];
};

/**
 * Compile glob patterns into portable WorkerOwnershipClaim objects.
 *
 * Conversion rules:
 *   src/**                → path=src, recursive=true
 *   docs/**               → path=docs, recursive=true
 *   package.json          → path=package.json, recursive=false
 *   README.md             → path=README.md, recursive=false
 *   .github/**            → path=.github, recursive=true
 *   **                    → path=., recursive=true
 *   Dockerfile*           → path=., recursive=true
 *   docker-compose*.yml   → path=., recursive=true
 *   unsupported wildcard  → nearest safe parent or "."
 */
export function compileOwnershipClaims(patterns: string[]): OwnershipClaimCompileResult {
  const claims: WorkerOwnershipClaim[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    // Security: reject dangerous patterns
    if (!pattern || pattern.length === 0) {
      warnings.push('Empty pattern skipped');
      continue;
    }
    if (pattern.includes('\0')) {
      warnings.push(`Pattern contains NUL character, skipping: ${pattern}`);
      continue;
    }
    if (pattern.startsWith('/')) {
      warnings.push(`Absolute path rejected: ${pattern}`);
      continue;
    }
    if (pattern.startsWith('~')) {
      warnings.push(`Tilde path rejected: ${pattern}`);
      continue;
    }
    if (pattern.startsWith('../') || pattern === '..' || pattern.includes('/../')) {
      warnings.push(`Traversal path rejected: ${pattern}`);
      continue;
    }

    let claim: WorkerOwnershipClaim | null = null;

    // Match against known patterns
    if (pattern === '**') {
      claim = { path: '.', recursive: true, sourcePattern: pattern };
    } else if (pattern.endsWith('/**')) {
      const base = pattern.slice(0, -3);
      claim = { path: base, recursive: true, sourcePattern: pattern };
    } else if (pattern.includes('*') || pattern.includes('?')) {
      // Unsupported wildcard — widen to workspace root
      claim = { path: '.', recursive: true, sourcePattern: pattern };
      warnings.push(`Unsupported wildcard "${pattern}" widened to workspace root`);
    } else {
      // Plain path, no wildcards
      claim = { path: pattern, recursive: false, sourcePattern: pattern };
    }

    if (claim && !seen.has(claim.path + claim.recursive)) {
      claims.push(claim);
      seen.add(claim.path + claim.recursive);
    }
  }

  return { claims, warnings };
}
