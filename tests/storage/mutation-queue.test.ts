import { it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn, setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { serializeStoreMutation, StoreMutationQueueTimeoutError } from "../../src/runtime-state/storage/mutation-queue.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function workspace() { const root = mkdtempSync(join(tmpdir(), "mutation-queue-")); roots.push(root); return root; }

it("admits local writers FIFO with one active mutation", async () => {
  const path = join(workspace(), "future", "state.json");
  const order: number[] = [];
  let active = 0;
  await Promise.all(Array.from({ length: 100 }, (_, i) => serializeStoreMutation(path, async () => {
    assert.equal(++active, 1);
    await nextTurn();
    order.push(i);
    active--;
  })));
  assert.deepEqual(order, Array.from({ length: 100 }, (_, i) => i));
});

it("shares admission across directory aliases while independent resources advance", async () => {
  const root = workspace(), real = join(root, "real"), alias = join(root, "alias");
  mkdirSync(real);
  symlinkSync(real, alias, process.platform === "win32" ? "junction" : "dir");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let aliasRan = false;
  const head = serializeStoreMutation(join(real, "new", "state.json"), () => gate);
  const follower = serializeStoreMutation(join(alias, "new", "state.json"), async () => { aliasRan = true; });
  try {
    await serializeStoreMutation(join(root, "other.json"), async () => {});
    assert.equal(aliasRan, false);
  } finally { release(); await Promise.all([head, follower]); }
  assert.equal(aliasRan, true);
});

it("a failed mutation releases the queue for subsequent writes", async () => {
  const path = join(workspace(), "state.json");
  const failed = serializeStoreMutation(path, async () => { throw new Error("mutation failed"); });
  const next = serializeStoreMutation(path, async () => 42);
  await assert.rejects(failed, /mutation failed/);
  assert.equal(await next, 42);
  assert.equal(await serializeStoreMutation(path, async () => 43), 43);
});

// An idle head expires a queued callback; allow scheduling slack on slow hosts.
it("expired callbacks never execute and the queue recovers when its head finishes", { timeout: 5_000 }, async () => {
  const path = join(workspace(), "state.json");
  let release!: () => void;
  const head = serializeStoreMutation(path, () => new Promise<void>(resolve => { release = resolve; }));
  await nextTurn();
  let ran = false;
  const follower = serializeStoreMutation(path, async () => { ran = true; }, 30);
  try { await assert.rejects(follower, StoreMutationQueueTimeoutError); }
  finally { release(); await head; }
  assert.equal(ran, false);
  assert.equal(await serializeStoreMutation(path, async () => "recovered"), "recovered");
});

// Twelve 30ms operations outlive the 250ms idle window without stalling it.
it("healthy completions refresh idle deadlines for a long backlog", { timeout: 10_000 }, async () => {
  const path = join(workspace(), "state.json");
  const values = await Promise.all(Array.from({ length: 12 }, (_, i) => serializeStoreMutation(path, async () => {
    await delay(30);
    return i;
  }, 250)));
  assert.deepEqual(values, Array.from({ length: 12 }, (_, i) => i));
});

it("delayed timer delivery cannot revive expired work", async t => {
  const path = join(workspace(), "state.json");
  let now = 1_000;
  t.mock.method(performance, "now", () => now);
  let release!: () => void;
  const head = serializeStoreMutation(path, () => new Promise<void>(resolve => { release = resolve; }));
  await nextTurn();
  let ran = false;
  const follower = serializeStoreMutation(path, async () => { ran = true; }, 100);
  const expired = assert.rejects(follower, StoreMutationQueueTimeoutError);
  now += 101;
  release();
  await Promise.all([head, expired]);
  assert.equal(ran, false);
});

it("wall-clock adjustments do not expire healthy queued work", async t => {
  const path = join(workspace(), "state.json");
  let release!: () => void;
  const head = serializeStoreMutation(path, () => new Promise<void>(resolve => { release = resolve; }));
  await nextTurn();
  const follower = serializeStoreMutation(path, async () => "written");
  const jumped = Date.now() + 60_000;
  t.mock.method(Date, "now", () => jumped);
  release();
  await head;
  assert.equal(await follower, "written");
});
