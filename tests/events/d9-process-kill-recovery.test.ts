import { it } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/runtime-state/events/event-log.js";

const moduleUrl = new URL("../../src/runtime-state/events/event-log.js", import.meta.url).href;
const completion = { sessionId: "d9-kill-session", actor: "coordination" as const, type: "coordination.aggregate.completed", payload: { runId: "d9-kill-run", aggregateResultRef: "d9-kill-ref", sourceFingerprint: "d9-kill-fp" } };
const matches = (e: { type: string; sessionId: string; payload: unknown }) => e.type === completion.type && e.sessionId === completion.sessionId && (e.payload as typeof completion.payload)?.runId === completion.payload.runId && (e.payload as typeof completion.payload)?.aggregateResultRef === completion.payload.aggregateResultRef && (e.payload as typeof completion.payload)?.sourceFingerprint === completion.payload.sourceFingerprint;
const setup = (dir: string) => `const { EventLog } = await import(${JSON.stringify(moduleUrl)}); const log = new EventLog(${JSON.stringify(dir)}); await log.init(); const completion = ${JSON.stringify(completion)}; const matches = e => e.type === completion.type && e.sessionId === completion.sessionId && e.payload?.runId === completion.payload.runId && e.payload?.aggregateResultRef === completion.payload.aggregateResultRef && e.payload?.sourceFingerprint === completion.payload.sourceFingerprint;`;

async function killAfterReady(source: string): Promise<void> {
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`child readiness timeout: ${stderr}`)), 10_000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", chunk => { if (String(chunk).includes("READY")) { clearTimeout(timeout); resolve(); } });
      child.once("exit", (code, signal) => { clearTimeout(timeout); reject(new Error(`child exited before ready: ${code}/${signal} ${stderr}`)); });
      child.once("error", err => { clearTimeout(timeout); reject(err); });
    });
    assert.equal(child.kill("SIGKILL"), true);
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("child termination timeout")), 10_000);
      child.once("exit", (code, signal) => { clearTimeout(timeout); resolve({ code, signal }); });
    });
    assert.equal(result.signal, "SIGKILL");
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
}

it("D9 process killed after append is recovered without duplicate completion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-d9-kill-after-"));
  try {
    await killAfterReady(`${setup(dir)} await log.appendIfAbsent(completion, matches); process.stdout.write("READY\\n"); await new Promise(() => {});`);
    const reader = new EventLog(dir);
    await reader.init();
    const before = await reader.readAll();
    assert.equal(before.length, 1);
    const worker = `${setup(dir)} const event = await log.appendIfAbsent(completion, matches); process.stdout.write(JSON.stringify(event));`;
    const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", worker], { timeout: 15_000 });
    assert.deepEqual(JSON.parse(stdout), before[0]);
    assert.deepEqual(await reader.readAll(), before);
    await reader.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("D9 process killed holding append lock permits safe stale-owner recovery", { timeout: 20_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-d9-kill-lock-"));
  try {
    await killAfterReady(`${setup(dir)} const { writeFile } = await import("node:fs/promises"); await writeFile(${JSON.stringify(join(dir, "events.jsonl.lock"))}, JSON.stringify({ pid: process.pid, token: "killed-owner", heartbeat: new Date(Date.now() - 60_000).toISOString() })); process.stdout.write("READY\\n"); await new Promise(() => {});`);
    const reader = new EventLog(dir);
    await reader.init();
    const event = await reader.appendIfAbsent(completion, matches);
    assert.equal(event.seq, 1);
    assert.equal((await reader.readAll()).length, 1);
    await reader.close();
    await assert.rejects(readFile(join(dir, "events.jsonl.lock")), { code: "ENOENT" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
