import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventLog } from "../../src/events/event-log.js";
import type { AlixEvent, EventMeta } from "../../src/events/types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("EventMeta", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "alix-event-meta-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("event without meta is backward compatible (meta is undefined)", () => {
    const log = new EventLog(dir);
    // Verify the AlixEvent type allows omitting meta
    const event: AlixEvent = {
      id: "test-id",
      seq: 1,
      version: 1,
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      type: "test.event",
      actor: "system",
      payload: {},
    };
    assert.equal(event.meta, undefined);
  });

  it("event with meta containing workflowId", async () => {
    const log = new EventLog(dir);
    await log.init();

    const event = await log.append({
      sessionId: "s1",
      type: "workflow.started",
      actor: "system",
      payload: {},
      meta: { workflowId: "wf-123" },
    });

    assert.ok(event.meta !== undefined);
    assert.equal(event.meta.workflowId, "wf-123");
  });

  it("reads meta from persisted events", async () => {
    const log = new EventLog(dir);
    await log.init();

    await log.append({
      sessionId: "s1",
      type: "workflow.started",
      actor: "system",
      payload: {},
      meta: { workflowId: "wf-456", graphId: "g-789" },
    });

    const events = await log.readAll();
    assert.equal(events.length, 1);
    assert.ok(events[0].meta !== undefined);
    assert.equal(events[0].meta!.workflowId, "wf-456");
    assert.equal(events[0].meta!.graphId, "g-789");
  });

  it("supports traceId and spanId", async () => {
    const log = new EventLog(dir);
    await log.init();

    const event = await log.append({
      sessionId: "s1",
      type: "workflow.started",
      actor: "system",
      payload: {},
      meta: { traceId: "trace-abc", spanId: "span-123" },
    });

    assert.ok(event.meta !== undefined);
    assert.equal(event.meta.traceId, "trace-abc");
    assert.equal(event.meta.spanId, "span-123");
  });

  it("all meta fields simultaneously", async () => {
    const log = new EventLog(dir);
    await log.init();

    const fullMeta: EventMeta = {
      workflowId: "wf-001",
      graphId: "g-002",
      nodeId: "n-003",
      traceId: "trace-004",
      spanId: "span-005",
    };

    const event = await log.append({
      sessionId: "s1",
      type: "workflow.started",
      actor: "system",
      payload: {},
      meta: fullMeta,
    });

    assert.deepEqual(event.meta, fullMeta);

    // Verify persistence round-trip
    const events = await log.readAll();
    assert.deepEqual(events[0].meta, fullMeta);
  });
});
