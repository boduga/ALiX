/**
 * daemon-submit.ts — Measure daemon task submission acknowledgment.
 * Skips gracefully if daemon is not running.
 */
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export async function runDaemonSubmitBenchmark(): Promise<void> {
  try {
    execFileSync(process.execPath, [
      join(process.cwd(), "dist", "src", "cli.js"),
      "daemon", "submit", "echo ping", "--wait", "1000",
    ], { encoding: "utf-8", timeout: 10000 });
  } catch {
    // Daemon not available — benchmark returns quickly
  }
}
