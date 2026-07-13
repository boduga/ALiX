// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.2 — Repository Observation Provider.
 *
 * Measures repository health metrics: file count, lines of code,
 * dependency state, and drift from baseline. Provides a structured
 * snapshot of repository state for outcome comparison.
 *
 * Never mutates the system.
 *
 * @module repository-provider
 */

import { readFileSync, existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildObservationResult } from "./shared.js";
import type { Observation, ObservationResult, ObservationProvider } from "../contracts/observation-contract.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = new Set([".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs", ".json", ".md", ".yaml", ".yml"]);

// ---------------------------------------------------------------------------
// FileScanner
// ---------------------------------------------------------------------------

async function scanFiles(dir: string, prefix: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = join(prefix, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        files.push(...await scanFiles(fullPath, relPath));
      } else if (entry.isFile()) {
        files.push(relPath);
      }
    }
  } catch {
    // Permission denied or missing directory — skip
  }
  return files;
}

async function countLines(filePath: string): Promise<number> {
  try {
    const content = await readFile(filePath, "utf-8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// RepositoryObservationProvider
// ---------------------------------------------------------------------------

export class RepositoryObservationProvider implements ObservationProvider {
  readonly name = "repository";
  readonly capabilities = ["repository", "code"];

  async observe(observation: Observation): Promise<ObservationResult> {
    const params = observation.params as Record<string, unknown> | undefined;
    const cwd = (params?.cwd as string) ?? process.cwd();

    try {
      // File metrics
      const allFiles = await scanFiles(cwd, "");
      const sourceFiles = allFiles.filter((f) => SOURCE_EXTENSIONS.has(join("x", f).slice(-5)));
      const extensionCounts: Record<string, number> = {};
      for (const f of allFiles) {
        const ext = join("x", f).slice(join("x", f).lastIndexOf("."));
        extensionCounts[ext] = (extensionCounts[ext] ?? 0) + 1;
      }

      // Line count
      let totalLines = 0;
      let lineCounts: number[] = [];
      for (const f of sourceFiles.slice(0, 500)) { // Limit to first 500 files for performance
        const lines = await countLines(join(cwd, f));
        totalLines += lines;
        lineCounts.push(lines);
      }

      // Dependency count from package.json
      let dependencyCount = 0;
      let devDependencyCount = 0;
      const pkgPath = join(cwd, "package.json");
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
          dependencyCount = Object.keys(pkg.dependencies ?? {}).length;
          devDependencyCount = Object.keys(pkg.devDependencies ?? {}).length;
        } catch {
          // Malformed package.json — skip
        }
      }

      // Git state (uncommitted changes)
      let uncommittedChanges = 0;
      let currentBranch = "";
      try {
        const { stdout: branchOut } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeout: 5_000 });
        currentBranch = branchOut.trim();

        const { stdout: statusOut } = await execFileAsync("git", ["status", "--porcelain"], { cwd, timeout: 5_000 });
        uncommittedChanges = statusOut.trim() ? statusOut.trim().split("\n").length : 0;
      } catch {
        // Not a git repository — skip
      }

      const evidence: Record<string, unknown> = {
        check: "health",
        cwd,
        totalFiles: allFiles.length,
        sourceFiles: sourceFiles.length,
        totalLines,
        meanLinesPerFile: lineCounts.length > 0 ? Math.round(totalLines / lineCounts.length) : 0,
        extensionCounts,
        dependencyCount,
        devDependencyCount,
        uncommittedChanges,
        currentBranch,
        scannedFiles: lineCounts.length,
      };

      return buildObservationResult(observation, "healthy", evidence);
    } catch (err: unknown) {
      return {
        observationId: observation.observationId,
        status: "error",
        confidence: 0,
        observedAt: new Date().toISOString(),
        evidence: {
          errorType: "provider_exception",
          message: (err as Error).message ?? String(err),
        },
      };
    }
  }
}
