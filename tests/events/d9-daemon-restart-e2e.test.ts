import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from "node:fs/promises";
import { openSync, closeSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CoordinationStore } from "../../src/coordination/kernel/coordination-store.js";
import { CoordinationResultStore } from "../../src/coordination/kernel/coordination-result-store.js";
import { CoordinationAggregateStore } from "../../src/coordination/kernel/coordination-aggregate-store.js";
import { createCompletionService } from "../../src/coordination/kernel/coordination-completion-service.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/coordination/kernel/coordination-types.js";
import { deriveRunCompletion } from "../../src/coordination/kernel/coordination-view.js";
import { EventLog } from "../../src/runtime-state/events/event-log.js";
import { closeSharedLedger } from "../../src/runtime-state/storage/runtime-ledger.js";
import { DEFAULT_CONFIG } from "../../src/operations/config/defaults.js";

type Variant = "valid" | "stale" | "wrong-host" | "missing";
type Fixture = Awaited<ReturnType<typeof seed>>;

async function seed(cwd: string, variant: Variant, createdAt?: string) {
  const store = new CoordinationStore(cwd);
  const run = createCoordinationRun({ sessionId: `d9-${variant}-${crypto.randomUUID()}`, rootGoal: "Retain completed receipt", coordinatorAgentId: "alix" });
  run.hostKind = variant === "wrong-host" ? "inspector" : "daemon";
  run.status = "completed";
  if (createdAt) run.createdAt = createdAt;
  const effectPath = `${run.sessionId}.txt`;
  const worker = createWorkerAssignment({ coordinationRunId: run.id, agentId: "alix#1", taskLabel: "receipt", goalPrompt: "Retain receipt", ownershipScopes: [effectPath], status: "completed", attempt: 1, maxAttempts: 3, startedAt: "2026-10-25T10:00:00.000Z", completedAt: "2026-10-25T10:00:01.000Z" });
  await writeFile(join(cwd, effectPath), "D9-R3-EXECUTED-ONCE\n");
  worker.resultRef = await new CoordinationResultStore(cwd).persist(worker, run.id, { outcome: "success", summary: "Seeded completed receipt", outputPath: effectPath });
  run.workers = [worker];
  await store.save(run);
  // Production finalization without an event sink reproduces the durable
  // attach-before-event boundary without executing a worker or model.
  await createCompletionService(cwd, { store }).finalize(run.id);
  const attached = (await store.load(run.id))!;
  if (variant === "stale") {
    await store.attachAggregate(run.id, { aggregateResultRef: attached.aggregateResultRef!, aggregateGeneratedAt: attached.aggregateGeneratedAt!, aggregateSourceFingerprint: "stale-source", outcome: "success" });
  }
  if (variant === "missing") await rm(join(cwd, attached.aggregateResultRef!));
  const log = new EventLog(join(cwd, ".alix", "sessions", run.sessionId));
  await log.init();
  await log.append({ sessionId: run.sessionId, actor: "tool", type: "file.created", payload: { path: effectPath, changed: true } });
  await log.close();
  return { id: run.id, sessionId: run.sessionId, effectPath };
}

async function snapshot(cwd: string, fixture: Fixture) {
  const run = (await new CoordinationStore(cwd).load(fixture.id))!;
  const log = new EventLog(join(cwd, ".alix", "sessions", fixture.sessionId));
  await log.init();
  try {
    return {
      run,
      result: await new CoordinationResultStore(cwd).load(run.workers[0].id),
      aggregate: await new CoordinationAggregateStore(cwd).load(run.id),
      events: await log.readAll(),
      effect: await readFile(join(cwd, fixture.effectPath), "utf8"),
      effectMtime: (await stat(join(cwd, fixture.effectPath))).mtimeMs,
      completion: (await deriveRunCompletion(cwd, run)).completion,
    };
  } finally { await log.close(); }
}

type Snapshot = Awaited<ReturnType<typeof snapshot>>;
const completions = (value: Snapshot) => value.events.filter(e => e.type === "coordination.aggregate.completed");

async function poll<T>(read: () => Promise<T>, ready: (value: T) => boolean, label: string, alive: () => void = () => {}, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  do {
    alive();
    const value = await read();
    if (ready(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 40));
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}

async function ping(socketPath: string): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection(socketPath);
    let buffer = "";
    const finish = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(10_000, () => finish(false));
    socket.on("error", () => finish(false));
    socket.on("connect", () => socket.write('{"command":"ping"}\n'));
    socket.on("data", chunk => {
      buffer += String(chunk);
      if (buffer.includes("\n")) {
        try { finish(JSON.parse(buffer.split("\n")[0]).type === "pong"); }
        catch { finish(false); }
      }
    });
  });
}

describe("D9-R3 actual daemon restart reconciliation", { timeout: 120_000 }, () => {
  let root: string, cwd: string, home: string, socketPath: string;
  let child: ChildProcess | undefined;
  let exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  let spawnError: Error | undefined;
  let generation = 0;
  const pids: number[] = [];
  const daemonLogs: string[] = [];
  const fixtures: Fixture[] = [];
  const beforeState: Snapshot[] = [], firstState: Snapshot[] = [], restartState: Snapshot[] = [];

  async function stop() {
    if (!child) return;
    const current = child;
    if (current.exitCode === null && current.signalCode === null) current.kill("SIGTERM");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([exited, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Daemon SIGTERM timeout")), 10_000);
      })]);
      assert.equal(result.code, 0, `daemon shutdown: ${JSON.stringify(result)}`);
    } finally {
      if (timer) clearTimeout(timer);
      if (current.exitCode === null && current.signalCode === null) {
        current.kill("SIGKILL");
        await exited;
      }
      child = undefined;
    }
  }

  async function start() {
    generation++;
    const output = openSync(join(root, `daemon-${generation}.log`), "w");
    try {
      // Minimal child environment prevents live config, provider credentials,
      // eval scenarios or daemon addresses from leaking into this fixture.
      child = spawn(process.execPath, [fileURLToPath(new URL("../../src/operations/daemon/daemon-server.js", import.meta.url)), "--socket", socketPath, "--cwd", cwd], {
        cwd, env: { HOME: home, PATH: process.env.PATH, TMPDIR: root, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share") }, stdio: ["ignore", output, output],
      });
    } finally { closeSync(output); }
    spawnError = undefined;
    exited = new Promise(resolve => {
      child!.once("exit", (code, signal) => resolve({ code, signal }));
      child!.once("error", error => { spawnError = error; resolve({ code: -1, signal: null }); });
    });
    const alive = () => {
      if (spawnError) throw spawnError;
      if (child!.exitCode !== null || child!.signalCode !== null) throw new Error(`Daemon exited before reconciliation: ${readFileSync(join(root, `daemon-${generation}.log`), "utf8")}`);
    };
    await poll(() => readFile(join(root, `daemon-${generation}.log`), "utf8"), text => text.includes("Daemon listening on"), "daemon listener readiness", alive);
    await poll(() => ping(socketPath), Boolean, "daemon protocol readiness", alive);
    assert.ok(child.pid);
    pids.push(child.pid);
    return alive;
  }

  before(async () => {
    root = await mkdtemp(join(tmpdir(), "alix-d9-r3-"));
    cwd = join(root, "project"); home = join(root, "home"); socketPath = join(root, "daemon.sock");
    await mkdir(cwd); await mkdir(join(home, ".config", "alix"), { recursive: true });
    const config = structuredClone(DEFAULT_CONFIG);
    config.models = { default: { provider: "scripted-mock", name: "scripted-mock-model" } };
    config.subagents = { ...config.subagents, roles: config.subagents?.roles ?? [], enabled: false };
    config.apiKeys = {};
    await writeFile(join(home, ".config", "alix", "config.json"), JSON.stringify(config));
    for (const variant of ["valid", "stale", "wrong-host", "missing"] as const) {
      const fixture = await seed(cwd, variant);
      fixtures.push(fixture);
      const initial = await snapshot(cwd, fixture);
      assert.equal(completions(initial).length, 0);
      assert.equal(initial.completion.verification, "unverified");
      beforeState.push(initial);
    }
    // list() scans newest first. An older healthy sentinel provides a durable
    // barrier after all target fixtures, including the negative cases.
    const barrier = await seed(cwd, "valid", "2000-01-01T00:00:00.000Z");
    const alive = await start();
    await poll(() => snapshot(cwd, barrier), s => completions(s).length === 1, "first startup scan barrier", alive);
    for (const fixture of fixtures) firstState.push(await snapshot(cwd, fixture));
    await stop();
    daemonLogs.push(await readFile(join(root, "daemon-1.log"), "utf8"));
    const secondBarrier = await seed(cwd, "valid", "1999-01-01T00:00:00.000Z");
    const restartedAlive = await start();
    await poll(() => snapshot(cwd, secondBarrier), s => completions(s).length === 1, "restart startup scan barrier", restartedAlive);
    for (const fixture of fixtures) restartState.push(await snapshot(cwd, fixture));
    await stop();
    daemonLogs.push(await readFile(join(root, "daemon-2.log"), "utf8"));
    assert.equal(new Set(pids).size, 2, "restart must use two distinct daemon OS processes");
    console.log(JSON.stringify({ evidence: "D9-R3", daemonPids: pids, daemonLogs, runs: fixtures.map((fixture, index) => ({ runId: fixture.id, firstEvents: completions(firstState[index]), restartEvents: completions(restartState[index]) })) }));
  });

  after(async () => {
    try { await stop(); }
    finally {
      if (cwd) closeSharedLedger(cwd);
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  it("repairs one matching event and preserves its identity after an OS-process restart", () => {
    const initial = beforeState[0], first = firstState[0], restarted = restartState[0];
    const events = completions(first);
    assert.equal(events.length, 1);
    const event = events[0];
    const payload = event.payload as Record<string, unknown>;
    assert.equal(event.sessionId, initial.run.sessionId);
    assert.equal(payload.runId, initial.run.id);
    assert.equal(payload.aggregateResultRef, initial.run.aggregateResultRef);
    assert.equal(payload.sourceFingerprint, initial.run.aggregateSourceFingerprint);
    assert.deepEqual(completions(restarted), events, "id, sequence, timestamp and binding remain identical");
    assert.equal(first.completion.verification, "verified");
    assert.equal(restarted.completion.verification, "verified");
    assert.deepEqual(first.aggregate, initial.aggregate);
    assert.deepEqual(restarted.aggregate, initial.aggregate);
  });

  it("does not replay workers, results or execution effects during either startup", () => {
    for (let index = 0; index < fixtures.length; index++) {
      for (const value of [firstState[index], restartState[index]]) {
        const initial = beforeState[index];
        assert.deepEqual(value.run, initial.run, "worker statuses, attempts, references and run metadata remain unchanged");
        assert.deepEqual(value.result, initial.result);
        assert.equal(value.effect, initial.effect);
        assert.equal(value.effectMtime, initial.effectMtime);
        assert.deepEqual(value.events.filter(e => e.type !== "coordination.aggregate.completed"), initial.events, "no additional execution lifecycle or effect events");
      }
    }
  });

  for (const [index, label] of [[1, "stale fingerprint"], [2, "wrong host"], [3, "missing aggregate"]] as const) {
    it(`does not verify or repair a ${label} fixture`, () => {
      for (const log of daemonLogs) {
        const diagnostic = `completion recovery failed for ${fixtures[index].id}`;
        assert.equal(log.includes(diagnostic), index !== 2, "invalid daemon evidence is diagnosed; other hosts are skipped");
      }
      for (const value of [firstState[index], restartState[index]]) {
        assert.equal(completions(value).length, 0);
        assert.equal(value.completion.verification, "unverified");
        assert.deepEqual(value.aggregate, beforeState[index].aggregate, "startup must not regenerate or rewrite aggregate evidence");
      }
    });
  }
});
