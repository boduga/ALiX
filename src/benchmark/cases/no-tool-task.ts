/**
 * no-tool-task.ts — Measure end-to-end alix run with a trivial task using mock provider.
 */
export async function runNoToolTaskBenchmark(): Promise<void> {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { randomUUID } = await import("node:crypto");
  const tmpDir = join(tmpdir(), `bench-task-${randomUUID()}`);
  mkdirSync(join(tmpDir, ".alix"), { recursive: true });
  writeFileSync(join(tmpDir, ".alix", "config.json"), JSON.stringify({
    model: { provider: "mock", name: "mock" },
    permissions: { default: "allow", tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] },
    context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
    runtime: { provider: "process", shell: "/bin/sh", commandTimeoutMs: 30000, envAllowlist: [] },
    ui: { enabled: false, host: "localhost", port: 3000, transport: "sse" },
    mcpServers: [],
  }));
  const { runTask } = await import("../../run.js");
  await runTask(tmpDir, 'respond with "hello"', { planMode: false, skipContext: true, sessionMode: "bypass" });
}
