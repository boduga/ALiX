import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { ShellPool } from "../../src/capabilities/tools/shell-pool.js";
import { ShellToolRouter } from "../../src/capabilities/tools/tool-router.js";
import { createToolExecutor } from "../../src/capabilities/tools/tool-executor-factory.js";
import { DEFAULT_CONFIG } from "../../src/operations/config/defaults.js";
import { EventLog } from "../../src/runtime-state/events/event-log.js";
import { closeAllSharedLedgers } from "../../src/runtime-state/storage/runtime-ledger.js";

const roots: string[] = [];
const logs: EventLog[] = [];
const pools = new Set<ShellPool>();
afterEach(async () => {
  for (const pool of pools) pool.close();
  pools.clear();
  vi.restoreAllMocks();
  for (const log of logs.splice(0)) await log.close();
  closeAllSharedLedgers();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "alix-pool-cwd-"));
  roots.push(root);
  await mkdir(join(root, "a"));
  await mkdir(join(root, "b"));
  const run = ShellPool.prototype.run;
  vi.spyOn(ShellPool.prototype, "run").mockImplementation(function (this: ShellPool, ...args) {
    pools.add(this);
    return run.apply(this, args);
  });
  async function executor(session: string) {
    const log = new EventLog(join(root, ".alix", "sessions", session));
    await log.init();
    logs.push(log);
    const config = structuredClone(DEFAULT_CONFIG);
    config.permissions.sessionMode = "bypass";
    return createToolExecutor({ root, config, log });
  }
  return { root, executor, first: await executor("first"), router: new ShellToolRouter(root) };
}

it("real pool: timeout after effect then changed cwd cannot replay in the original directory", async () => {
  const f = await fixture();
  const command = "printf 'charged\\n' >> effects.txt; sleep 5";
  const call = { name: "shell.run", toolCallId: "first", args: { command, cwd: "a", persistent: true, timeoutMs: 300 } };
  expect(await f.first.execute(call)).toMatchObject({ kind: "error", outcomeUnknown: true, message: expect.stringContaining("timed out") });
  expect(await readFile(join(f.root, "a/effects.txt"), "utf8")).toBe("charged\n");
  expect(await f.first.execute({ ...call, toolCallId: "changed", args: { ...call.args, cwd: "b" } })).toMatchObject({ kind: "error", message: expect.stringContaining("initial execution directory") });
  // Changed invocation, alias, transport and a fresh executor do not clear A's claim.
  const fresh = await f.executor("fresh");
  for (const persistent of [false, true]) {
    expect(await fresh.execute({ ...call, toolCallId: "fresh", args: { ...call.args, cwd: join(f.root, "a"), persistent, timeoutMs: 1000 } })).toMatchObject({ kind: "error", message: expect.stringContaining("reconciliation") });
  }
  expect(await readFile(join(f.root, "a/effects.txt"), "utf8")).toBe("charged\n");
  await expect(readFile(join(f.root, "b/effects.txt"))).rejects.toThrow();
  expect(pools.size).toBe(1);
});

it("a warmed pool rejects a changed requested cwd before any command enters it", async () => {
  const f = await fixture();
  expect(await f.router.execute({ name: "shell.run", toolCallId: "call", args: { command: "pwd; :", cwd: "a", persistent: true } })).toMatchObject({ kind: "success", output: `${join(f.root, "a")}\n` });
  expect(await f.router.execute({ name: "shell.run", toolCallId: "call", args: { command: "printf charged >> effects.txt", cwd: "b", persistent: true } })).toMatchObject({ kind: "error", retryable: false });
  await expect(readFile(join(f.root, "a/effects.txt"))).rejects.toThrow();
  await expect(readFile(join(f.root, "b/effects.txt"))).rejects.toThrow();
});

// Expected execution directories span both transports, omitted/relative/absolute
// cwd and safe-shell's existing root-only behavior.
for (const row of [
  { persistent: false, cwd: undefined, command: "pwd; :", expected: "" },
  { persistent: false, cwd: "a", command: "pwd; :", expected: "a" },
  { persistent: true, cwd: "a", command: "pwd; :", expected: "a" },
  { persistent: true, cwd: "a/../b", command: "pwd; :", expected: "b" },
  { persistent: false, cwd: "b", command: "pwd", expected: "" },
  { persistent: true, cwd: "b", command: "pwd", expected: "" },
]) it(`directory parity ${JSON.stringify(row)}`, async () => {
  const f = await fixture();
  expect(await f.first.execute({ name: "shell.run", toolCallId: "call", args: row })).toMatchObject({ kind: "success", output: `${join(f.root, row.expected)}\n` });
});

it("pool aliases agree, command cd cannot drift, and safe-shell does not inherit pool cwd", async () => {
  const f = await fixture();
  const args = { cwd: "a", persistent: true };
  expect(await f.router.execute({ name: "shell.run", toolCallId: "call", args: { ...args, command: "cd ../b" } })).toMatchObject({ kind: "success" });
  expect(await f.router.execute({ name: "shell.run", toolCallId: "call", args: { ...args, cwd: join(f.root, "a"), command: "pwd; :" } })).toMatchObject({ kind: "success", output: `${join(f.root, "a")}\n` });
  expect(await f.router.execute({ name: "shell.run", toolCallId: "call", args: { ...args, command: "pwd" } })).toMatchObject({ kind: "success", output: `${f.root}\n` });
});

it("non-persistent relative cwd and symlink aliases cannot replay an uncertain effect", async () => {
  const f = await fixture();
  await symlink(join(f.root, "a"), join(f.root, "alias"), "dir");
  const command = "printf 'charged\\n' >> effects.txt; exit 7";
  const call = { name: "shell.run", toolCallId: "call", args: { command, cwd: "a" } };
  expect(await f.first.execute(call)).toMatchObject({ kind: "error", outcomeUnknown: true });
  for (const cwd of ["./a", "b/../a", "alias", join(f.root, "a")]) {
    expect(await f.first.execute({ ...call, args: { command, cwd } })).toMatchObject({ kind: "error", message: expect.stringContaining("reconciliation") });
  }
  expect(await readFile(join(f.root, "a/effects.txt"), "utf8")).toBe("charged\n");
  // A genuinely distinct non-persistent directory retains its distinct identity.
  expect(await f.first.execute({ ...call, args: { command, cwd: "b" } })).toMatchObject({ kind: "error", outcomeUnknown: true });
  expect(await readFile(join(f.root, "b/effects.txt"), "utf8")).toBe("charged\n");
});

it("relative router roots resolve to the same actual execution directory", async () => {
  const f = await fixture();
  const router = new ShellToolRouter(relative(process.cwd(), f.root));
  expect(await router.execute({ name: "shell.run", toolCallId: "call", args: { command: "pwd; :", cwd: "a" } })).toMatchObject({ kind: "success", output: `${join(f.root, "a")}\n` });
});

it("busy, timed-out, cancelled and prematurely exited pools cannot accept another execution", async () => {
  const f = await fixture();
  const pool = new ShellPool({ cwd: f.root, fixedCwd: true });
  pools.add(pool);
  const pending = pool.run("printf first >> effects.txt; sleep 5", 300);
  await expect(pool.run("printf second >> effects.txt")).rejects.toThrow("busy");
  await expect(pending).rejects.toThrow("timed out");
  await expect(pool.run("printf second >> effects.txt")).rejects.toThrow("closed");
  expect(await readFile(join(f.root, "effects.txt"), "utf8")).toBe("first");
  const cancelled = new ShellPool({ cwd: f.root, fixedCwd: true });
  pools.add(cancelled);
  const controller = new AbortController();
  const active = cancelled.run("sleep 5", 5000, controller.signal);
  controller.abort();
  await expect(active).rejects.toMatchObject({ name: "ExecutionCancelledError" });
  await expect(cancelled.run("printf second >> effects.txt")).rejects.toThrow("closed");
  const exited = new ShellPool({ cwd: f.root });
  pools.add(exited);
  await expect(exited.run("exit 0")).rejects.toThrow("before command completion");
});

it("real pooled nonzero exit retains the claim instead of reporting success", async () => {
  const f = await fixture();
  const call = { name: "shell.run", toolCallId: "call", args: { command: "printf charged >> effects.txt; exit 7", cwd: "a", persistent: true } };
  expect(await f.first.execute(call)).toMatchObject({ kind: "error", outcomeUnknown: true });
  expect(await f.first.execute(call)).toMatchObject({ kind: "error", message: expect.stringContaining("reconciliation") });
  expect(await readFile(join(f.root, "a/effects.txt"), "utf8")).toBe("charged");
});

it("direct legacy ShellPool users retain cd persistence", async () => {
  const f = await fixture();
  const pool = new ShellPool({ cwd: f.root });
  pools.add(pool);
  expect(await pool.run("cd a")).toMatchObject({ exitCode: 0 });
  expect(await pool.run("pwd")).toMatchObject({ exitCode: 0, output: `${join(f.root, "a")}\n` });
});
