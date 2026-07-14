/**
 * cli-startup.ts — Measure cold CLI startup by spawning `node dist/src/cli.js --help`.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function findRepoRoot(startDir: string): string {
  let current = startDir;

  while (true) {
    if (existsSync(join(current, "package.json"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Unable to find repository root from ${startDir}`);
    }

    current = parent;
  }
}

export function resolveBuiltCliPath(startDir = __dirname): string {
  const repoRoot = findRepoRoot(startDir);
  return join(repoRoot, "dist", "src", "cli.js");
}

export async function runCliStartupBenchmark(): Promise<void> {
  execFileSync(process.execPath, [resolveBuiltCliPath(), "--help"], { encoding: "utf-8", timeout: 15000 });
}
