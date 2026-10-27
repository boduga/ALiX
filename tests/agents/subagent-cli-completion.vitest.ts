import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, unlink, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeSharedLedger } from "../../src/runtime-state/storage/runtime-ledger.js";
import type { NormalizedRequest } from "../../src/models/providers/types.js";

const harness = vi.hoisted(() => ({ complete: vi.fn(), execute: vi.fn(), durable: [] as { type: string; payload?: unknown }[], providerConfig: null as { timeoutMs?: number; streamIdleTimeoutMs?: number } | null }));
vi.mock("../../src/models/providers/registry.js", () => ({ createProvider: async (config: { timeoutMs?: number; streamIdleTimeoutMs?: number }) => { harness.providerConfig = config; return { complete: harness.complete }; } }));
vi.mock("../../src/operations/config/loader.js", async () => {
  const { DEFAULT_CONFIG } = await import("../../src/operations/config/defaults.js");
  return { loadConfig: async () => ({ ...structuredClone(DEFAULT_CONFIG), models: { default: { provider: "fixture", name: "fixture", timeoutMs: 1_800_000, streamIdleTimeoutMs: 900_000 } } }) };
});
vi.mock("../../src/runtime-state/events/event-log.js", () => ({ EventLog: class { async init() {} async append() {} async readAll() { return harness.durable; } } }));
vi.mock("../../src/context/repomap/context-compiler.js", () => ({ ContextCompiler: class {
  async warm() {} async compileContext() { return { primaryFiles: [] }; }
} }));
vi.mock("../../src/capabilities/mcp/manager.js", () => ({ McpManager: class {
  async initialize() { throw new Error("No MCP in deterministic fixture"); }
  async closeAll() {}
} }));
vi.mock("../../src/capabilities/tools/executor.js", () => ({ ToolExecutor: class { execute = harness.execute; } }));
vi.mock("../../src/run.js", () => ({ buildToolsForProvider: () => ["alix_grep_search", "alix_file_create", "alix_file_delete", "alix_done"].map(name => ({
  name, description: name, input_schema: { type: "object", properties: {} },
})) }));

import { SubagentCLI } from "../../src/agents/subagent-cli.js";

afterEach(() => { vi.restoreAllMocks(); harness.complete.mockReset(); harness.execute.mockReset(); harness.durable.length = 0; harness.providerConfig = null; });

describe("child provider call budget", () => {
  it("carries the configured model timeout into the provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "alix-timeout-"));
    const cwd = process.cwd();
    const oldExit = process.exitCode;
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    harness.complete.mockImplementation(async () => ({ text: "", toolCalls: [{ id: "done", name: "alix_done", args: {} }] }));
    harness.execute.mockImplementation(async () => ({ kind: "success", output: "Task completed." }));
    try {
      process.chdir(root);
      await SubagentCLI.main(["--subagent", "worker", "--mode", "write", "--task-id", "writer", "--session-id", "fixture", "--prompt", "Write the file"]);
      expect(harness.providerConfig?.timeoutMs).toBe(1_800_000);
      expect(harness.providerConfig?.streamIdleTimeoutMs).toBe(900_000);
    } finally {
      process.chdir(cwd);
      process.exitCode = oldExit;
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty); else Reflect.deleteProperty(process.stdin, "isTTY");
      closeSharedLedger(root);
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("coordination worker completion boundary", () => {
  it.each(["done", "no_calls", "budget"])("reviews %s exit and retains retrieved evidence", async exit => {
    const root = await mkdtemp(join(tmpdir(), "alix-completion-"));
    const cwd = process.cwd();
    const oldExit = process.exitCode;
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    let workerCalls = 0;
    harness.complete.mockImplementation(async (request: NormalizedRequest) => {
      if (request.tools?.length === 0) {
        expect(request.systemPrompt).toContain("President of Nigeria");
        expect(JSON.stringify(request.messages)).toContain("https://statehouse.gov.ng/");
        return { text: JSON.stringify({ satisfied: false, summary: "Commentary does not answer the assigned research", gaps: ["Missing substantive final findings"] }) };
      }
      workerCalls++;
      if (workerCalls === 1 || exit === "budget") return {
        text: workerCalls === 1 ? "The first search returned no results. Trying another source." : "",
        toolCalls: [{ id: `search-${workerCalls}`, name: "alix_grep_search", args: { pattern: "president" } }],
      };
      return { text: "", toolCalls: exit === "done" ? [{ id: "done", name: "alix_done", args: {} }] : [] };
    });
    harness.execute.mockImplementation(async ({ name }: { name: string }) => name === "task.complete"
      ? { kind: "success", output: "Task completed." }
      : { kind: "success", matches: [{ path: "sources.md", lineNumber: 1, line: "Bola Ahmed Tinubu — https://statehouse.gov.ng/" }] });
    try {
      process.chdir(root);
      await SubagentCLI.main(["--subagent", "researcher", "--task-id", "research", "--session-id", "fixture", "--prompt", "Research President of Nigeria", "--coordination-run-id", "coord-fixture"]);
      const result = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
      expect(result.status).toBe("failed");
      expect(JSON.stringify(result.findings)).toContain("https://statehouse.gov.ng/");
      expect(harness.complete).toHaveBeenCalledTimes(workerCalls + 1);
      expect(workerCalls).toBe(exit === "budget" ? 5 : 2);
      expect(process.exitCode).toBe(1);
    } finally {
      process.chdir(cwd);
      process.exitCode = oldExit;
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty); else Reflect.deleteProperty(process.stdin, "isTTY");
      closeSharedLedger(root);
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(["correct", "wrong", "deleted"])("checks persisted %s deliverable without writing unrelated permission scopes", async outcome => {
    const root = await mkdtemp(join(tmpdir(), "alix-artifact-review-"));
    const cwd = process.cwd();
    const oldExit = process.exitCode;
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    let turns = 0;
    const deleting = outcome === "deleted";
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "README.md"), "Existing README");
    await writeFile(join(root, "CHANGELOG.md"), "Existing changelog");
    if (deleting) await writeFile(join(root, "docs/report.md"), "Obsolete report");
    const reportContent = outcome === "wrong" ? "Donald Trump is US President." : "Bola Ahmed Tinubu is Nigeria President. https://statehouse.gov.ng/";
    harness.complete.mockImplementation(async (request: NormalizedRequest) => {
      if (request.tools?.length === 0) {
        const evidence = JSON.stringify(request.messages);
        expect(evidence).toContain("docs/report.md");
        expect(evidence).toContain(deleting ? 'exists' : outcome === "wrong" ? "Donald Trump" : "Bola Ahmed Tinubu");
        return { text: JSON.stringify({ satisfied: outcome !== "wrong", summary: outcome === "wrong" ? "Report has wrong subject" : "Requested deliverable verified", gaps: outcome === "wrong" ? ["Nigeria report discusses United States"] : [] }), toolCalls: [] };
      }
      turns++;
      return turns === 1
        ? { text: "Working on requested deliverable.", toolCalls: [{ id: "mutation", name: deleting ? "alix_file_delete" : "alix_file_create", args: { path: "docs/report.md", content: reportContent } }] }
        : { text: "", toolCalls: [{ id: "done", name: "alix_done", args: {} }] };
    });
    harness.execute.mockImplementation(async ({ name, args }: { name: string; args: { path?: string; content?: string } }) => {
      const path = join(root, args.path ?? ".");
      if (name === "file.create") { await writeFile(path, args.content ?? ""); return { kind: "success", createdPath: args.path, output: "Created report" }; }
      if (name === "file.delete") { await unlink(path); return { kind: "success", deletedPath: args.path, output: "Deleted report" }; }
      if (name === "file.read") {
        try { return { kind: "success", content: await readFile(path, "utf8") }; }
        catch { return { kind: "error", message: "ENOENT" }; }
      }
      if (name === "file.exists") {
        try { await access(path); return { kind: "success", exists: true }; }
        catch { return { kind: "success", exists: false }; }
      }
      return { kind: "success", output: "Task completed." };
    });
    try {
      process.chdir(root);
      await SubagentCLI.main(["--subagent", "worker", "--mode", "write", "--task-id", "writer", "--session-id", "fixture", "--prompt", deleting ? "Delete docs/report.md" : "Write Nigeria president report to docs/report.md", "--coordination-run-id", "coord-fixture", "--owned-paths", "docs,README.md,CHANGELOG.md"]);
      const result = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
      expect(result.status).toBe(outcome === "wrong" ? "partial" : "success");
      expect(harness.complete).toHaveBeenCalledTimes(3);
      const mutations = harness.execute.mock.calls.filter(([call]) => ["file.create", "file.delete"].includes(call.name));
      expect(mutations).toHaveLength(1);
      expect(mutations[0][0].args.path).toBe("docs/report.md");
      expect(await readFile(join(root, "README.md"), "utf8")).toBe("Existing README");
      expect(await readFile(join(root, "CHANGELOG.md"), "utf8")).toBe("Existing changelog");
      if (outcome === "wrong") {
        expect(result.error).toContain("Changed: docs/report.md");
        expect(await readFile(join(root, "docs/report.md"), "utf8")).toContain("Donald Trump");
      }
    } finally {
      process.chdir(cwd);
      process.exitCode = oldExit;
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty); else Reflect.deleteProperty(process.stdin, "isTTY");
      closeSharedLedger(root);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps an earlier attempt's durable evidence when the retry writes nothing", async () => {
    const root = await mkdtemp(join(tmpdir(), "alix-durable-review-"));
    const cwd = process.cwd();
    const oldExit = process.exitCode;
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs/report.md"), "Bola Ahmed Tinubu is Nigeria President.");
    // An EARLIER attempt of this worker wrote the deliverable; the session log
    // is durable. The retry itself writes nothing.
    harness.durable.push({ type: "file.created", payload: { path: "docs/report.md" } });
    let turns = 0;
    harness.complete.mockImplementation(async (request: NormalizedRequest) => {
      if (request.tools?.length === 0) {
        expect(JSON.stringify(request.messages)).toContain("docs/report.md");
        return { text: JSON.stringify({ satisfied: true, summary: "Requested deliverable verified", gaps: [] }), toolCalls: [] };
      }
      turns++;
      return turns === 1
        ? { text: "Checking the deliverable.", toolCalls: [{ id: "search", name: "alix_grep_search", args: { pattern: "report" } }] }
        : { text: "", toolCalls: [{ id: "done", name: "alix_done", args: {} }] };
    });
    harness.execute.mockImplementation(async ({ name, args }: { name: string; args: { path?: string } }) => {
      const path = join(root, args.path ?? ".");
      if (name === "file.read") {
        try { return { kind: "success", content: await readFile(path, "utf8") }; }
        catch { return { kind: "error", message: "ENOENT" }; }
      }
      if (name === "file.exists") {
        try { await access(path); return { kind: "success", exists: true }; }
        catch { return { kind: "success", exists: false }; }
      }
      return { kind: "success", matches: [{ path: "docs/report.md", lineNumber: 1, line: "Bola Ahmed Tinubu" }] };
    });
    try {
      process.chdir(root);
      await SubagentCLI.main(["--subagent", "worker", "--mode", "write", "--task-id", "writer", "--session-id", "fixture", "--prompt", "Write Nigeria president report to docs/report.md", "--coordination-run-id", "coord-fixture", "--owned-paths", "docs"]);
      const result = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
      expect(result.status).toBe("success");
      expect(harness.execute.mock.calls.filter(([call]) => call.name === "file.create")).toHaveLength(0);
    } finally {
      process.chdir(cwd);
      process.exitCode = oldExit;
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty); else Reflect.deleteProperty(process.stdin, "isTTY");
      closeSharedLedger(root);
      await rm(root, { recursive: true, force: true });
    }
  });
});
