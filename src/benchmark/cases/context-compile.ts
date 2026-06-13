/**
 * context-compile.ts — Measure repo map + context compilation.
 */
export async function runContextCompileBenchmark(): Promise<void> {
  const { buildRepoMapLite } = await import("../../repomap/repomap-lite.js");
  const result = await buildRepoMapLite(process.cwd());
  if (!result) throw new Error("context compile returned null");
}
