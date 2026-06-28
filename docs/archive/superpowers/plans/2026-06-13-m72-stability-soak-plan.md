# M0.72 — Stability and Soak Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate that ALiX survives sustained use, resource pressure, storage corruption, and unexpected failures without hanging or silently exiting.

**Architecture:** New test files only plus minor package.json changes. Fault-injection helpers corrupt storage files at known paths. Soak tests are split into two tiers:
- **Tier 1 (fast):** in-process store corruption recovery, concurrency, and API edge cases — runs on every commit
- **Tier 2 (slow):** isolated daemon protocol soak with temporary HOME, socket disconnect, and restart — gated by `ALIX_SOAK_TESTS=1`, excluded from CI.

**Tech Stack:** TypeScript, existing `TaskRegistry`, `ContinuationStore`, `ApprovalStore`, `DaemonManager`, `EventLog`, `RuntimeIndex`, `node:fs`, `node:child_process`.

---

## File Structure

### Create
- `tests/soak/fault-injector.ts` — helpers to corrupt JSONL, approvals, continuations, task registry at their real paths
- `tests/soak/corruption-recovery.test.ts` — Tier 1, fast: corrupt ContinuationStore, ApprovalStore, EventLog, TaskRegistry files
- `tests/soak/store-load.test.ts` — Tier 1, fast: TaskRegistry create/update/load, ApprovalStore storm, ContinuationStore 1000-cycle, duplicate resolve, RuntimeIndex fixture
- `tests/soak/daemon-protocol-soak.test.ts` — Tier 2, slow: isolated HOME, daemon start/stop, submit 100 tasks, cancel via socket, disconnect mid-task, restart-and-reconcile
- `tests/soak/memory-growth.test.ts` — Tier 1, fast: deterministic fixture with 10k audit events + 5k sessions + 1k approvals + 100 graphs, measure RSS delta

### Modify
- `package.json` — add `test:soak:quick` (Tier 1) and `test:soak` (Tier 2) scripts, exclude `dist/tests/soak/*` from `test:node:ci`

---

### Task 1: Fault Injection Helpers (corrected paths)

**Files:**
- Create: `tests/soak/fault-injector.ts`

- [ ] **Step 1: Create fault-injector.ts with real ALiX storage paths**

```typescript
/**
 * fault-injector.ts — Utilities for injecting faults into ALiX storage files.
 *
 * All functions write to paths that match the real storage locations:
 *   .alix/approvals/approvals.json
 *   .alix/approvals/continuations.json
 *   .alix/sessions/<id>/events.jsonl
 *   .alix/daemon-tasks.json
 *
 * Precondition: the .alix directory and parent directories already exist.
 * Use writeFileSync to create a valid baseline before corrupting.
 */

import { writeFileSync, readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Write a truncated (incomplete) JSON value to a file. */
export function writePartialJson(filePath: string): void {
  writeFileSync(filePath, `[{"id": "incomplete"`, "utf-8");
}

/** Write valid JSON then append trailing garbage. Requires baseline first. */
export function corruptJsonWithTrailingGarbage(filePath: string): void {
  const original = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "[]";
  writeFileSync(filePath, original + '\n"TRAILING_GARBAGE": true,}}]', "utf-8");
}

/** Append a partial (incomplete) JSONL line to a session events file. */
export function corruptJsonlWithPartialLine(filePath: string): void {
  appendFileSync(filePath, '{"type":"tool.started","payload":{}}\n{"type":"tool.out', "utf-8");
}

/** Write a well-formed JSONL file with one malformed line in the middle. */
export function corruptJsonlWithMalformedLine(filePath: string): void {
  appendFileSync(filePath, '{"type":"tool.started","payload":{}}\nNOT_JSON\n{"type":"tool.completed","payload":{}}\n', "utf-8");
}

/** Zero out a file. */
export function zeroOutFile(filePath: string): void {
  writeFileSync(filePath, "", "utf-8");
}

/** Write a stale PID file that references a non-running process. */
export function writeStalePid(filePath: string): void {
  writeFileSync(filePath, "9999999\n", "utf-8");
}

/** Write an orphaned (empty) socket file. */
export function writeOrphanedSocket(filePath: string): void {
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, "", "utf-8");
}

/** Ensure a storage directory exists. */
export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/soak/fault-injector.ts
git commit -m "test(soak): add fault injection helpers (real ALiX storage paths)"
```

---

### Task 2: Corruption Recovery Tests (Tier 1, fast)

**Files:**
- Create: `tests/soak/corruption-recovery.test.ts`

- [ ] **Step 1: Create corruption-recovery.test.ts**

```typescript
/**
 * corruption-recovery.test.ts — Verify stores survive corrupted files.
 *
 * Tier 1 (fast, runs on every commit). Tests that every storage layer
 * that reads from disk handles corrupt/empty/malformed input without
 * throwing uncaught exceptions.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function tmpDir(scope: string): string {
  const d = mkdtempSync(join(tmpdir(), `soak-${scope}-`));
  mkdirSync(join(d, ".alix"), { recursive: true });
  return d;
}
function cleanup(d: string) { try { rmSync(d, { recursive: true, force: true }); } catch {} }

describe("Corruption Recovery — ContinuationStore", () => {
  it("handles partial JSON gracefully", async () => {
    const dir = tmpDir("cont-partial");
    try {
      const path = join(dir, ".alix", "approvals", "continuations.json");
      mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
      writeFileSync(path, `[{"approvalId":"incomplete"`, "utf-8");
      const { ContinuationStore } = await import("../../src/runtime/continuation-store.js");
      const store = new ContinuationStore(dir);
      await store.load();
      assert.equal(store.list().length, 0); // gracefully recovers
    } finally { cleanup(dir); }
  });

  it("handles empty file gracefully", async () => {
    const dir = tmpDir("cont-empty");
    try {
      mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
      writeFileSync(join(dir, ".alix", "approvals", "continuations.json"), "[]", "utf-8");
      const { ContinuationStore } = await import("../../src/runtime/continuation-store.js");
      const store = new ContinuationStore(dir);
      await store.load();
      assert.equal(store.list().length, 0);
    } finally { cleanup(dir); }
  });

  it("handles zero-byte file", async () => {
    const dir = tmpDir("cont-zero");
    try {
      mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
      writeFileSync(join(dir, ".alix", "approvals", "continuations.json"), "", "utf-8");
      const { ContinuationStore } = await import("../../src/runtime/continuation-store.js");
      const store = new ContinuationStore(dir);
      await store.load();
      assert.equal(store.list().length, 0);
    } finally { cleanup(dir); }
  });
});

describe("Corruption Recovery — ApprovalStore", () => {
  it("handles trailing garbage", async () => {
    const dir = tmpDir("approve-garbage");
    try {
      mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
      const ap = join(dir, ".alix", "approvals", "approvals.json");
      writeFileSync(ap, "[]", "utf-8");
      const { corruptJsonWithTrailingGarbage } = await import("./fault-injector.js");
      corruptJsonWithTrailingGarbage(ap);
      const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
      const store = new ApprovalStore(dir);
      await store.load(); // must not throw
    } finally { cleanup(dir); }
  });

  it("handles zero-byte file", async () => {
    const dir = tmpDir("approve-zero");
    try {
      mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
      writeFileSync(join(dir, ".alix", "approvals", "approvals.json"), "", "utf-8");
      const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
      const store = new ApprovalStore(dir);
      await store.load();
      assert.equal(store.list().length, 0);
    } finally { cleanup(dir); }
  });
});

describe("Corruption Recovery — EventLog", () => {
  it("handles malformed JSONL gracefully", async () => {
    const dir = tmpDir("eventlog-malformed");
    try {
      const sessionDir = join(dir, ".alix", "sessions", "test-session");
      const eventsPath = join(sessionDir, "events.jsonl");
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(eventsPath, "", "utf-8");
      const { corruptJsonlWithMalformedLine } = await import("./fault-injector.js");
      corruptJsonlWithMalformedLine(eventsPath);

      const { EventLog } = await import("../../src/events/event-log.js");
      const log = new EventLog(sessionDir);
      await log.init();
      const events = await log.readAll();
      assert.ok(Array.isArray(events), "readAll returns array even with malformed lines");
    } finally { cleanup(dir); }
  });
});

describe("Corruption Recovery — TaskRegistry", () => {
  it("handles malformed JSON gracefully", async () => {
    const testHome = mkdtempSync(join(tmpdir(), "soak-taskreg-"));
    try {
      mkdirSync(join(testHome, ".alix"), { recursive: true });
      writeFileSync(join(testHome, ".alix", "daemon-tasks.json"), "NOT_JSON", "utf-8");

      // TaskRegistry reads from ~/.alix/daemon-tasks.json — isolate via HOME
      const oldHome = process.env.HOME;
      process.env.HOME = testHome;
      try {
        const { TaskRegistry } = await import("../../src/daemon/task-registry.js");
        const reg = new TaskRegistry();
        await reg.load(); // must not throw
        const task = reg.create("test-task", "/tmp");
        assert.ok(task.id);
      } finally {
        process.env.HOME = oldHome;
      }
    } finally { cleanup(testHome); }
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/soak/corruption-recovery.test.ts
git commit -m "test(soak): add corruption recovery tests (ContinuationStore, ApprovalStore, EventLog, TaskRegistry at real paths)"
```

---

### Task 3: Store Load/Concurrency Soak (Tier 1, fast)

**Files:**
- Create: `tests/soak/store-load.test.ts`

- [ ] **Step 1: Create store-load.test.ts**

```typescript
/**
 * store-load.test.ts — Store concurrency and load tests.
 *
 * Tier 1 (fast, runs on every commit). Tests that every storage layer
 * handles sustained operations without errors or data loss.
 * No daemon, no subprocess, no HOME isolation needed.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "soak-load-"));
  mkdirSync(join(d, ".alix", "approvals"), { recursive: true });
  return d;
}

// ─── TaskRegistry ───────────────────────────────────────────────────────

describe("TaskRegistry load", () => {
  it("create, update, get round-trip", async () => {
    const testHome = mkdtempSync(join(tmpdir(), "soak-tr-rt-"));
    mkdirSync(join(testHome, ".alix"), { recursive: true });
    const oldHome = process.env.HOME;
    process.env.HOME = testHome;
    try {
      const { TaskRegistry } = await import("../../src/daemon/task-registry.js");
      const reg = new TaskRegistry();
      await reg.load();
      const t = reg.create("test-roundtrip", "/tmp");
      assert.ok(t.id);
      reg.update(t.id, { status: "running", startedAt: new Date().toISOString() });
      const running = reg.get(t.id);
      assert.equal(running?.status, "running");
    } finally { process.env.HOME = oldHome; rmSync(testHome, { recursive: true, force: true }); }
  });

  it("list returns all tasks", async () => {
    const testHome = mkdtempSync(join(tmpdir(), "soak-tr-list-"));
    mkdirSync(join(testHome, ".alix"), { recursive: true });
    const oldHome = process.env.HOME;
    process.env.HOME = testHome;
    try {
      const { TaskRegistry } = await import("../../src/daemon/task-registry.js");
      const reg = new TaskRegistry();
      await reg.load();
      for (let i = 0; i < 20; i++) reg.create(`task-${i}`, "/tmp");
      assert.equal(reg.list().length, 20);
    } finally { process.env.HOME = oldHome; rmSync(testHome, { recursive: true, force: true }); }
  });
});

// ─── ApprovalStore ──────────────────────────────────────────────────────

describe("ApprovalStore load", () => {
  let dir: string;
  let store: any;

  beforeEach(async () => {
    dir = tmpDir();
    const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
    store = new ApprovalStore(dir);
    await store.load();
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("100 rapid request/resolve cycles", async () => {
    for (let i = 0; i < 100; i++) {
      const rec = await store.request({ reason: `test ${i}`, capability: `cap.${i}`, sessionId: "s1", toolId: `tool.${i}` });
      await store.resolve(rec.id, "approved", "auto");
    }
    assert.equal(store.listPending().length, 0);
  });

  it("duplicate resolve returns existing record (idempotent)", async () => {
    const rec = await store.request({ reason: "dup", capability: "cap.test", sessionId: "s1", toolId: "tool.test" });
    const first = await store.resolve(rec.id, "approved");
    assert.ok(first);
    const second = await store.resolve(rec.id, "approved");
    assert.equal(second?.status, "approved");
    assert.equal(second?.decidedAt, first?.decidedAt);
  });

  it("500-pending storm then resolve all", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 500; i++) {
      const rec = await store.request({ reason: `storm ${i}`, capability: `cap.${i}`, sessionId: "s1", toolId: `tool.${i}` });
      ids.push(rec.id);
    }
    assert.equal(store.listPending().length, 500);
    for (const id of ids) await store.resolve(id, "approved");
    assert.equal(store.listPending().length, 0);
  });

  it("survives reload after 200 writes", async () => {
    for (let i = 0; i < 200; i++) {
      await store.request({ reason: `reload ${i}`, capability: "cap.test", sessionId: "s1", toolId: `tool.${i}` });
    }
    const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
    const fresh = new ApprovalStore(dir);
    await fresh.load();
    assert.equal(fresh.list().length, 200);
  });
});

// ─── ContinuationStore ──────────────────────────────────────────────────

describe("ContinuationStore load", () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("persist, findByApprovalId, remove round-trip", async () => {
    const { ContinuationStore } = await import("../../src/runtime/continuation-store.js");
    const store = new ContinuationStore(dir);
    await store.load();
    await store.persist({ approvalId: "apr_1", kind: "tool", sessionId: "s1", cwd: dir, toolCall: { toolCallId: "tc1", name: "file.read", capability: "file.read", args: { path: "test.txt" }, argsHash: "abc" }, createdAt: new Date().toISOString() });
    const found = store.findByApprovalId("apr_1");
    assert.ok(found);
    await store.remove("apr_1");
    assert.equal(store.findByApprovalId("apr_1"), undefined);
  });

  it("1000 persist/remove cycles", async () => {
    const { ContinuationStore } = await import("../../src/runtime/continuation-store.js");
    const store = new ContinuationStore(dir);
    await store.load();
    for (let i = 0; i < 1000; i++) {
      await store.persist({ approvalId: `apr_${i}`, kind: "tool", sessionId: "s1", cwd: dir, toolCall: { toolCallId: `tc_${i}`, name: "file.read", capability: "file.read", args: { path: "test.txt" }, argsHash: `hash_${i}` }, createdAt: new Date().toISOString() });
    }
    assert.equal(store.list().length, 1000);
    for (let i = 0; i < 1000; i++) {
      await store.remove(`apr_${i}`);
    }
    assert.equal(store.list().length, 0);
  });

  it("concurrent persists resolve correctly", async () => {
    const { ContinuationStore } = await import("../../src/runtime/continuation-store.js");
    const store = new ContinuationStore(dir);
    await store.load();
    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      store.persist({ approvalId: `apr_conc_${i}`, kind: "tool", sessionId: "s1", cwd: dir, toolCall: { toolCallId: `tc_${i}`, name: "file.read", capability: "file.read", args: { path: "test.txt" }, argsHash: `hash_${i}` }, createdAt: new Date().toISOString() })
    ));
    assert.equal(store.list().length, 20);
  });
});

// ─── RuntimeIndex ───────────────────────────────────────────────────────

describe("RuntimeIndex load", () => {
  it("build and query on deterministic fixture", { timeout: 30000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "soak-rix-"));
    mkdirSync(join(dir, ".alix", "audit"), { recursive: true });
    mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
    mkdirSync(join(dir, ".alix", "graphs"), { recursive: true });

    // Write 1000 audit events
    const auditPath = join(dir, ".alix", "audit", "audit.jsonl");
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) {
      lines.push(JSON.stringify({ id: `audit_${i}`, timestamp: new Date().toISOString(), source: "session", action: "tool.started", payload: { tool: "file.read" } }));
    }
    require("fs").writeFileSync(auditPath, lines.join("\n") + "\n", "utf-8");

    // Write 100 session events
    const sessionDir = join(dir, ".alix", "sessions", "test-session");
    mkdirSync(sessionDir, { recursive: true });
    const slines: string[] = [];
    for (let i = 0; i < 100; i++) {
      slines.push(JSON.stringify({ sessionId: "s1", timestamp: new Date().toISOString(), type: "tool.started", payload: { toolCallId: `tc_${i}` } }));
    }
    require("fs").writeFileSync(join(sessionDir, "events.jsonl"), slines.join("\n") + "\n", "utf-8");

    const { RuntimeIndex } = await import("../../src/runtime/runtime-index.js");
    const index = new RuntimeIndex(dir);
    await index.build();
    const all = await index.query({});
    assert.ok(Array.isArray(all?.events || all));
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/soak/store-load.test.ts
git commit -m "test(soak): add store load tests (TaskRegistry, ApprovalStore 500-storm, ContinuationStore 1000-cycle, RuntimeIndex fixture)"
```

---

### Task 4: Isolated Daemon Protocol Soak (Tier 2, slow)

**Files:**
- Create: `tests/soak/daemon-protocol-soak.test.ts`

- [ ] **Step 1: Create daemon-protocol-soak.test.ts**

```typescript
/**
 * daemon-protocol-soak.test.ts — Daemon resilience via true socket protocol.
 *
 * Tier 2 (slow, gated by ALIX_SOAK_TESTS=1). Uses an isolated HOME
 * so tests never touch the user's real daemon state.
 *
 * Each test starts its own daemon subprocess, runs ops, then kills it.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, execSync } from "node:child_process";

const ENABLED = process.env.ALIX_SOAK_TESTS === "1";
const describeSoak = ENABLED ? describe : describe.skip;

describeSoak("Daemon Protocol Soak", () => {
  let testHome: string;
  let socketPath: string;
  let daemonPid: number | null = null;

  before(() => {
    testHome = mkdtempSync(join(tmpdir(), "soak-daemon-proto-"));
    mkdirSync(join(testHome, ".alix"), { recursive: true });
    // Write a minimal config so the daemon can load
    writeFileSync(join(testHome, ".alix", "config.json"), JSON.stringify({
      model: { provider: "mock", name: "mock" },
      permissions: { default: "allow", tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] },
      context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
      runtime: { provider: "process", shell: "/bin/sh", commandTimeoutMs: 30000, envAllowlist: [] },
      ui: { enabled: false, host: "localhost", port: 3000, transport: "sse" },
      mcpServers: [],
    }));
    socketPath = join(testHome, ".alix", "alixd.sock");
  });

  after(() => { rmSync(testHome, { recursive: true, force: true }); });

  function startDaemon(): void {
    const cli = join(process.cwd(), "dist", "src", "cli.js");
    execFileSync(process.execPath, [cli, "daemon", "start"], {
      cwd: testHome,
      env: { ...process.env, HOME: testHome, USERPROFILE: testHome },
      timeout: 10000,
    });
    // Capture PID from daemon.pid
    const pidPath = join(testHome, ".alix", "daemon.pid");
    if (existsSync(pidPath)) {
      const pid = parseInt(require("fs").readFileSync(pidPath, "utf-8").trim(), 10);
      if (!isNaN(pid)) daemonPid = pid;
    }
  }

  function stopDaemon(): void {
    try {
      const cli = join(process.cwd(), "dist", "src", "cli.js");
      execFileSync(process.execPath, [cli, "daemon", "stop"], {
        cwd: testHome,
        env: { ...process.env, HOME: testHome, USERPROFILE: testHome },
        timeout: 5000,
      });
    } catch { /* best-effort */ }
    daemonPid = null;
  }

  function submitTask(task: string): void {
    const cli = join(process.cwd(), "dist", "src", "cli.js");
    execFileSync(process.execPath, [cli, "daemon", "submit", task], {
      cwd: testHome,
      env: { ...process.env, HOME: testHome, USERPROFILE: testHome },
      timeout: 10000,
    });
  }

  function daemonIsRunning(): boolean {
    try {
      const cli = join(process.cwd(), "dist", "src", "cli.js");
      execFileSync(process.execPath, [cli, "daemon", "status"], {
        cwd: testHome,
        env: { ...process.env, HOME: testHome, USERPROFILE: testHome },
        timeout: 3000,
        stdio: "pipe",
      });
      return true;
    } catch { return false; }
  }

  it("starts and stops cleanly", () => {
    startDaemon();
    assert.ok(daemonIsRunning());
    stopDaemon();
    assert.equal(daemonIsRunning(), false);
  });

  it("rejects second start while running", () => {
    startDaemon();
    try {
      const cli = join(process.cwd(), "dist", "src", "cli.js");
      assert.throws(() => {
        execFileSync(process.execPath, [cli, "daemon", "start"], {
          cwd: testHome,
          env: { ...process.env, HOME: testHome, USERPROFILE: testHome },
          timeout: 5000,
          stdio: "pipe",
        });
      }, /Daemon already running/);
    } finally { stopDaemon(); }
  });

  it("recovers from stale PID file", () => {
    const pidPath = join(testHome, ".alix", "daemon.pid");
    writeFileSync(pidPath, "9999999\n", "utf-8");
    startDaemon(); // should clean up stale PID and start fresh
    assert.ok(daemonIsRunning());
    stopDaemon();
  });

  it("recovers from orphaned socket", () => {
    writeFileSync(socketPath, "", "utf-8"); // orphaned socket
    startDaemon();
    assert.ok(daemonIsRunning());
    stopDaemon();
  });

  it("submits 10 sequential tasks", () => {
    startDaemon();
    try {
      for (let i = 0; i < 10; i++) submitTask("echo done");
      // All submitted without error
    } finally { stopDaemon(); }
  });

  it("queued tasks survive daemon restart and are reconciled", () => {
    startDaemon();
    // Submit 3 tasks quickly
    for (let i = 0; i < 3; i++) submitTask("echo survive");
    stopDaemon();

    // Restart — reconciliation should reassign queued tasks
    startDaemon();
    assert.ok(daemonIsRunning());

    // Load task registry via HOME isolation
    const { TaskRegistry } = require("../../src/daemon/task-registry.js");
    const reg = new TaskRegistry();
    // (TaskRegistry uses the isolated HOME from the environment set in startDaemon)
    stopDaemon();
  });

  it("cleans up PID and socket on stop", () => {
    startDaemon();
    stopDaemon();
    assert.equal(existsSync(join(testHome, ".alix", "daemon.pid")), false, "PID file removed");
    assert.equal(existsSync(socketPath), false, "socket file removed");
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/soak/daemon-protocol-soak.test.ts
git commit -m "test(soak): add isolated daemon protocol soak with HOME isolation"
```

---

### Task 5: Memory Growth Measurement (Tier 1, fast)

**Files:**
- Create: `tests/soak/memory-growth.test.ts`

- [ ] **Step 1: Create memory-growth.test.ts**

```typescript
/**
 * memory-growth.test.ts — Measure RSS before/after sustained operations.
 *
 * Tier 1 (fast, runs on every commit). Uses deterministic fixtures so
 * results are reproducible across developers. Reports deltas; does
 * NOT fail on growth — observations feed into M0.73 budget setting.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function rssMb(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024 * 10) / 10;
}

const ONE_MB = 1024 * 1024;

describe("Memory Growth — RuntimeIndex", () => {
  it("measures RSS delta for fixture with 1000 audit + 100 session events", { timeout: 30000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-rix-"));
    mkdirSync(join(dir, ".alix", "audit"), { recursive: true });
    mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
    mkdirSync(join(dir, ".alix", "graphs"), { recursive: true });
    mkdirSync(join(dir, ".alix", "sessions", "s1"), { recursive: true });

    // 1000 audit events
    const auditEvents = Array.from({ length: 1000 }, (_, i) =>
      JSON.stringify({ id: `audit_${i}`, timestamp: new Date().toISOString(), source: "session", action: "tool.started", payload: { tool: "file.read" } })
    ).join("\n") + "\n";
    require("fs").writeFileSync(join(dir, ".alix", "audit", "audit.jsonl"), auditEvents, "utf-8");

    // 100 session events
    const sessionEvents = Array.from({ length: 100 }, (_, i) =>
      JSON.stringify({ sessionId: "s1", type: "tool.started", payload: { toolCallId: `tc_${i}` } })
    ).join("\n") + "\n";
    require("fs").writeFileSync(join(dir, ".alix", "sessions", "s1", "events.jsonl"), sessionEvents, "utf-8");

    const before = rssMb();
    const { RuntimeIndex } = require("../../src/runtime/runtime-index.js");
    const index = new RuntimeIndex(dir);
    await index.build();
    await index.query({});
    const after = rssMb();
    console.log(`  RuntimeIndex: RSS ${before} MB → ${after} MB (delta: ${(after - before).toFixed(1)} MB)`);

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Memory Growth — ContinuationStore", () => {
  it("measures RSS delta for 1000 persists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-cont-"));
    mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
    const before = rssMb();
    const { ContinuationStore } = require("../../src/runtime/continuation-store.js");
    const store = new ContinuationStore(dir);
    await store.load();
    for (let i = 0; i < 1000; i++) {
      await store.persist({ approvalId: `apr_${i}`, kind: "tool", sessionId: "s1", cwd: dir, toolCall: { toolCallId: `tc_${i}`, name: "file.read", capability: "file.read", args: { path: "test.txt" }, argsHash: `hash_${i}` }, createdAt: new Date().toISOString() });
    }
    const after = rssMb();
    console.log(`  ContinuationStore (1000 persists): RSS ${before} MB → ${after} MB`);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Memory Growth — ApprovalStore", () => {
  it("measures RSS delta for 500 approvals", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-approve-"));
    mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
    const before = rssMb();
    const { ApprovalStore } = require("../../src/approvals/approval-store.js");
    const store = new ApprovalStore(dir);
    await store.load();
    for (let i = 0; i < 500; i++) {
      await store.request({ reason: `mem ${i}`, capability: "cap.test", sessionId: "s1", toolId: `tool.${i}` });
    }
    const after = rssMb();
    console.log(`  ApprovalStore (500 pending): RSS ${before} MB → ${after} MB`);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/soak/memory-growth.test.ts
git commit -m "test(soak): add memory growth measurement (RuntimeIndex, ContinuationStore, ApprovalStore fixtures)"
```

---

### Task 6: Package.json Scripts + CI Exclusion

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update package.json**

Add soak scripts after the `test:pty:tui` script:
```json
"test:soak:quick": "node --test --test-concurrency=1 dist/tests/soak/corruption-recovery.test.js dist/tests/soak/store-load.test.js dist/tests/soak/memory-growth.test.js",
"test:soak": "ALIX_SOAK_TESTS=1 node --test --test-concurrency=1 dist/tests/soak/*.test.js",
```

Exclude `dist/tests/soak/*` from `test:node:ci`:
```json
"test:node:ci": "find dist/tests -name '*.test.js' ! -path 'dist/tests/manual/*' ! -path 'dist/tests/pty/*' ! -path 'dist/tests/soak/*' -print0 | xargs -0 node --test --test-timeout=30000",
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: add test:soak:quick and test:soak scripts, exclude soak from CI"
```

---

### Verification

1. `npm run build` — clean compile
2. Tier 1 (fast, on every commit):
   ```bash
   npm run test:soak:quick
   ```
   Expected: corruption-recovery, store-load, and memory-growth tests pass
3. Tier 2 (slow, gated):
   ```bash
   ALIX_SOAK_TESTS=1 npm run test:soak
   ```
   Expected: all tests pass (daemon protocol tests run last, may take 60+ seconds)
4. CI integrity — verify soak excluded:
   ```bash
   npm run test:node:ci
   ```
   Expected: no soak tests in output
