import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createToolExecutor } from "../../src/capabilities/tools/tool-executor-factory.js";
import { ShellToolRouter, McpToolRouter, FileToolRouter } from "../../src/capabilities/tools/tool-router.js";
import { EventLog } from "../../src/runtime-state/events/event-log.js";
import { DEFAULT_CONFIG } from "../../src/operations/config/defaults.js";
import { ApprovalStore } from "../../src/governance/approvals/approval-store.js";
import { closeAllSharedLedgers } from "../../src/runtime-state/storage/runtime-ledger.js";
import type { ToolCallRequest } from "../../src/capabilities/tools/types.js";

const roots: string[] = [];
const logs: EventLog[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const log of logs.splice(0)) await log.close();
  closeAllSharedLedgers();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(mode: "ask" | "auto" | "bypass" = "bypass") {
  const root = await mkdtemp(join(tmpdir(), "alix-effect-boundary-"));
  roots.push(root);
  const store = new ApprovalStore(root);
  await store.load();
  async function executor(session: string) {
    const log = new EventLog(join(root, ".alix", "sessions", session));
    await log.init();
    logs.push(log);
    const config = structuredClone(DEFAULT_CONFIG);
    config.permissions.sessionMode = mode;
    config.permissions.tools = { "shell.run": mode === "ask" ? "ask" : "allow" };
    return createToolExecutor({ root, config, log, approvalStore: store });
  }
  return { root, store, executor, first: await executor("first") };
}

const shellCall = (): ToolCallRequest => ({
  name: "shell.run", args: { command: "node -e 'externalEffect()'" },
  toolCallId: "original", invocationId: "original-invocation", agentId: "original-agent",
});

// A broader outcome/mode table than the implementation's risk predicate:
// negative controls include low-risk reads, idempotent writes and known success.
for (const mode of ["auto", "bypass"] as const) {
  for (const outcome of ["unknown", "error", "throw", "success"] as const) {
    it(`${mode}/${outcome}: exact effect survives fresh call, session and agent identities`, async () => {
      const f = await fixture(mode);
      let effects = 0;
      vi.spyOn(ShellToolRouter.prototype, "execute").mockImplementation(async () => {
        effects++;
        if (outcome === "throw") throw new Error("lost response after effect");
        return outcome === "success"
          ? { kind: "success", output: "applied" }
          : { kind: "error", message: "response lost", retryable: true, ...(outcome === "unknown" ? { outcomeUnknown: true } : {}) };
      });
      const call = shellCall();
      if (outcome === "throw") await expect(f.first.execute(call)).rejects.toThrow("lost response");
      else {
        const result = await f.first.execute(call);
        expect(result.kind).toBe(outcome === "success" ? "success" : "error");
        if (outcome !== "success") expect(result).toMatchObject({ retryable: false, outcomeUnknown: true });
      }
      const fresh = await f.executor("fresh-session");
      const retry = await fresh.execute({ ...call, toolCallId: "fresh", invocationId: "fresh", agentId: "fresh-agent" });
      expect(retry.kind).toBe(outcome === "success" ? "success" : "error");
      if (outcome !== "success") expect(retry).toMatchObject({ retryable: false, message: expect.stringContaining("reconciliation") });
      expect(effects).toBe(outcome === "success" ? 2 : 1);
    });
  }
}

it("a second explicit approval and continuation resume cannot clear an unresolved effect", async () => {
  const f = await fixture("ask");
  let effects = 0;
  vi.spyOn(ShellToolRouter.prototype, "execute").mockImplementation(async () => {
    effects++;
    return { kind: "error", message: "unknown", outcomeUnknown: true };
  });
  const call = shellCall();
  const asked = await f.first.execute(call);
  expect(asked.kind).toBe("denied");
  if (asked.kind !== "denied" || !asked.approvalId) throw new Error("missing approval");
  await f.store.resolve(asked.approvalId, "approved");
  await f.first.execute({ ...call, source: "continuation-resume", approvalId: asked.approvalId });
  expect(await f.store.loadFresh(asked.approvalId)).toMatchObject({ executionOutcome: "pending" });
  const fresh = await f.executor("fresh-session");
  const newCall = { ...call, toolCallId: "new-call", agentId: "new-agent" };
  const second = await fresh.execute(newCall);
  if (second.kind !== "denied" || !second.approvalId) throw new Error("missing second approval");
  expect(second.approvalId).not.toBe(asked.approvalId);
  await f.store.resolve(second.approvalId, "approved");
  const retry = await fresh.execute({ ...newCall, source: "continuation-resume", approvalId: second.approvalId });
  expect(retry).toMatchObject({ kind: "error", retryable: false });
  expect(effects).toBe(1);
});

it("safe-shell reads retain existing retry behavior", async () => {
  const f = await fixture("ask");
  const router = vi.spyOn(ShellToolRouter.prototype, "execute").mockResolvedValue({ kind: "error", message: "unknown" });
  const call = { ...shellCall(), args: { command: "pwd" } };
  await f.first.execute(call);
  expect(await f.first.execute({ ...call, toolCallId: "new" })).toMatchObject({ kind: "error" });
  expect(router).toHaveBeenCalledTimes(2);
});

it("simultaneous callers cannot enter one uncertain effect twice", async () => {
  const f = await fixture();
  const router = vi.spyOn(ShellToolRouter.prototype, "execute").mockResolvedValue({ kind: "error", message: "unknown" });
  await Promise.all([f.first.execute(shellCall()), f.first.execute({ ...shellCall(), toolCallId: "concurrent" })]);
  expect(router).toHaveBeenCalledTimes(1);
});

it("a git output flag admitted by safe-shell grammar cannot bypass replay quarantine", async () => {
  const f = await fixture("ask");
  const router = vi.spyOn(ShellToolRouter.prototype, "execute").mockResolvedValue({ kind: "error", message: "lost git output response" });
  const call = { ...shellCall(), args: { command: "git show --output effect.txt" } };
  expect(await f.first.execute(call)).toMatchObject({ kind: "error", outcomeUnknown: true });
  expect(await f.first.execute({ ...call, toolCallId: "new" })).toMatchObject({ kind: "error", retryable: false });
  expect(router).toHaveBeenCalledTimes(1);
});

for (const mode of ["ask", "auto", "bypass"] as const) {
  it(`${mode}: real rg executable preprocessing runs at most once after an ambiguous result`, async () => {
    const f = await fixture(mode);
    // Quoting the executable flag passes the existing safe-shell grammar;
    // rg still interprets it as --pre and runs sh on the discovered script.
    await writeFile(join(f.root, "script.txt"), "printf 'charged\\n' >> effects.txt\nprintf 'no-match\\n'\n");
    const router = vi.spyOn(ShellToolRouter.prototype, "execute");
    // Supply a path as well as a pattern: shell-tool keeps stdin piped open.
    const call = { ...shellCall(), args: { command: "rg '--pre' sh script.txt script.txt" } };
    const first = await f.first.execute(call);
    expect(await readFile(join(f.root, "effects.txt"), "utf8")).toBe("charged\n");
    const fresh = await f.executor("rg-retry");
    const retry = await fresh.execute({ ...call, toolCallId: "retry" });
    expect(await readFile(join(f.root, "effects.txt"), "utf8")).toBe("charged\n");
    expect(router).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ kind: "error", outcomeUnknown: true, retryable: false });
    expect(retry).toMatchObject({ kind: "error", retryable: false, message: expect.stringContaining("reconciliation") });
  });

  it(`${mode}: cwd-only variations cannot bypass a retained safe-shell effect claim`, async () => {
    const f = await fixture(mode);
    await mkdir(join(f.root, "subdir"));
    const router = vi.spyOn(ShellToolRouter.prototype, "execute").mockResolvedValue({ kind: "error", message: "lost git output response" });
    const command = "git show --output effect.txt";
    expect(await f.first.execute({ ...shellCall(), args: { command } })).toMatchObject({ kind: "error", outcomeUnknown: true });
    const fresh = await f.executor("cwd-retry");
    for (const cwd of [".", "subdir", join(f.root, "subdir"), f.root]) {
      expect(await fresh.execute({ ...shellCall(), toolCallId: cwd, args: { command, cwd } })).toMatchObject({ kind: "error", retryable: false, message: expect.stringContaining("reconciliation") });
    }
    expect(router).toHaveBeenCalledTimes(1);
    expect(await readdir(join(f.root, ".alix", "effect-replay", "v1"))).toHaveLength(1);
  });
}

it("benign safe-shell still runs at router root despite request cwd, and successful rg remains repeatable", async () => {
  const f = await fixture("ask");
  await mkdir(join(f.root, "subdir"));
  await writeFile(join(f.root, "input.txt"), "needle\n");
  expect(await f.first.execute({ ...shellCall(), args: { command: "pwd", cwd: join(f.root, "subdir") } })).toMatchObject({ kind: "success", output: `${f.root}\n` });
  const call = { ...shellCall(), args: { command: "rg 'needle' input.txt" } };
  for (let i = 0; i < 2; i++) expect(await f.first.execute({ ...call, toolCallId: String(i) })).toMatchObject({ kind: "success", output: "needle\n" });
  expect(await readdir(join(f.root, ".alix", "effect-replay", "v1"))).toHaveLength(0);
});

it("non-safe-shell execution preserves distinct effective working directories", async () => {
  const f = await fixture();
  const subdir = join(f.root, "subdir");
  await mkdir(subdir);
  const call = { ...shellCall(), args: { command: "printf 'charged\\n' >> effects.txt; exit 7", cwd: f.root } };
  expect(await f.first.execute(call)).toMatchObject({ kind: "error", outcomeUnknown: true });
  expect(await f.first.execute({ ...call, toolCallId: "different-cwd", args: { ...call.args, cwd: subdir } })).toMatchObject({ kind: "error", outcomeUnknown: true });
  expect(await f.first.execute({ ...call, toolCallId: "same-cwd" })).toMatchObject({ kind: "error", message: expect.stringContaining("reconciliation") });
  expect(await readFile(join(f.root, "effects.txt"), "utf8")).toBe("charged\n");
  expect(await readFile(join(subdir, "effects.txt"), "utf8")).toBe("charged\n");
});

it("corrupt claims fail closed and contain no command text", async () => {
  const f = await fixture();
  const router = vi.spyOn(ShellToolRouter.prototype, "execute").mockResolvedValue({ kind: "error", message: "unknown" });
  await f.first.execute(shellCall());
  const dir = join(f.root, ".alix", "effect-replay", "v1");
  const [marker] = await readdir(dir);
  expect(await readFile(join(dir, marker), "utf8")).not.toContain("externalEffect");
  await writeFile(join(dir, marker), "");
  await f.first.execute({ ...shellCall(), toolCallId: "fresh" });
  expect(router).toHaveBeenCalledTimes(1);
});

it("claim persistence failure cannot dispatch an effect", async () => {
  const f = await fixture();
  await writeFile(join(f.root, ".alix", "effect-replay"), "unavailable");
  const router = vi.spyOn(ShellToolRouter.prototype, "execute");
  expect(await f.first.execute(shellCall())).toMatchObject({ kind: "error", retryable: false });
  expect(router).not.toHaveBeenCalled();
});

it("low-risk reads and ordinary idempotent file creation retain existing retry behavior", async () => {
  const f = await fixture();
  const router = vi.spyOn(FileToolRouter.prototype, "execute").mockResolvedValue({ kind: "error", message: "read/write failure" });
  for (const name of ["file.read", "file.create"]) {
    const call = { toolCallId: name, name, args: { path: "test.txt", content: "same" } };
    await f.first.execute(call);
    await f.first.execute({ ...call, toolCallId: "fresh" });
  }
  expect(router).toHaveBeenCalledTimes(4);
});

it("dynamic MCP errors after dispatch are uncertain even without adapter outcomeUnknown", async () => {
  const f = await fixture();
  // Only connection availability is needed; the actual router is the effect seam.
  const log = logs[0];
  const config = structuredClone(DEFAULT_CONFIG);
  config.permissions.sessionMode = "bypass";
  const manager = {} as NonNullable<Parameters<typeof createToolExecutor>[0]["mcpManager"]>;
  const executor = createToolExecutor({ root: f.root, log, config, mcpManager: manager });
  const router = vi.spyOn(McpToolRouter.prototype, "execute").mockResolvedValue({ kind: "error", message: "timeout" });
  const call = { toolCallId: "mcp-original", name: "mcp.payment.charge", args: { amount: 100 } };
  expect(await executor.execute(call)).toMatchObject({ kind: "error", retryable: false, outcomeUnknown: true });
  await executor.execute({ ...call, toolCallId: "fresh" });
  expect(router).toHaveBeenCalledTimes(1);
});
