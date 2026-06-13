/**
 * runtime-index.ts — Measure RuntimeIndex build and query in a real repo.
 */
import { buildRuntimeIndex } from "../../runtime/runtime-index.js";

export async function runRuntimeIndexBenchmark(): Promise<void> {
  const cwd = process.cwd();
  const index = await buildRuntimeIndex(cwd);
  // Exercise all query methods
  index.byAction("");
  index.bySession("");
  index.byGraph("");
  index.events;
}
