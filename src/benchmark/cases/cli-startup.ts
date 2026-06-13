/**
 * cli-startup.ts — Measure cold CLI startup by spawning `node dist/src/cli.js --help`.
 */
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "..", "..", "dist", "src", "cli.js");

export async function runCliStartupBenchmark(): Promise<void> {
  execFileSync(process.execPath, [CLI, "--help"], { encoding: "utf-8", timeout: 15000 });
}
