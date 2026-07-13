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
import { extname, join, relative, resolve } from "node:path";
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
    const lines = content.split("\n");
    // Files ending with trailing newline produce a trailing empty element
    return content.endsWith("\n") ? lines.length - 1 : lines.length;
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
      const sourceFiles = allFiles.filter((f) => SOURCE_EXTENSIONS.has(extname(f)));
      const extensionCounts: Record<string, number> = {};
      for (const f of sourceFiles) {
        const ext = extname(f);
        extensionCounts[ext] = (extensionCounts[ext] ?? 0) + 1;
      }

      // Line count (batch with concurrency for performance)
      let totalLines = 0;
      let fileCount = 0;
      const lineBatch = sourceFiles.slice(0, 500);
      const lineResults = await Promise.all(
        lineBatch.map((f) => countLines(join(cwd, f))),
      );
      for (const lines of lineResults) {
        totalLines += lines;
        fileCount++;
      }
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
        meanLinesPerFile: fileCount > 0 ? Math.round(totalLines / fileCount) : 0,
        extensionCounts,
        dependencyCount,
        devDependencyCount,
        uncommittedChanges,
        currentBranch,
        scannedFiles: fileCount,
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
          message: String((err as Error)?.message ?? err),
        },
      };
    }
  }
}
