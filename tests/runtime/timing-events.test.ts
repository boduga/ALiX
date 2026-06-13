import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AlixEvent } from "../../src/events/types.js";
import { EventLog } from "../../src/events/event-log.js";
import type { TimingEventPayload } from "../../src/runtime/timing-events.js";

describe("measurePhase", () => {
  let dir: string;
  let log: EventLog;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "measure-test-"));
    log = new EventLog(dir);
    await log.init();
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("emits started + completed on success", async () => {
    const { measurePhase } = await import("../../src/runtime/timing-events.js");
    const result = await measurePhase(log, "s1", "test.op", async () => "hello");
    assert.equal(result, "hello", "returns the work result");
    const events = await log.readAll() as AlixEvent<string, TimingEventPayload>[];
    const started = events.filter((e) => e.type === "runtime.phase.started");
    const completed = events.filter((e) => e.type === "runtime.phase.completed");
    assert.equal(started.length, 1);
    assert.equal(completed.length, 1);
    assert.equal(completed[0].payload.outcome, "success");
    assert.ok(completed[0].payload.durationMs !== undefined);
  });

  it("emits completed with failure and rethrows on error", async () => {
    const { measurePhase } = await import("../../src/runtime/timing-events.js");
    await assert.rejects(
      () => measurePhase(log, "s1", "failing.op", async () => { throw new Error("boom"); }),
      /boom/,
    );
    const events = await log.readAll() as AlixEvent<string, TimingEventPayload>[];
    const completed = events.filter((e) => e.type === "runtime.phase.completed");
    assert.equal(completed.length, 1);
    assert.equal(completed[0].payload.outcome, "failure");
    assert.equal(completed[0].payload.error, "boom");
  });

  it("timingId matches between started and completed", async () => {
    const { measurePhase } = await import("../../src/runtime/timing-events.js");
    await measurePhase(log, "s1", "correlated.op", async () => {});
    const events = await log.readAll() as AlixEvent<string, TimingEventPayload>[];
    const started = events.find((e) => e.type === "runtime.phase.started")!;
    const completed = events.find((e) => e.type === "runtime.phase.completed")!;
    assert.equal(completed.payload.timingId, started.payload.timingId);
  });

  it("skips instrumentation when log is undefined", async () => {
    const { measurePhase } = await import("../../src/runtime/timing-events.js");
    const result = await measurePhase(undefined, "s1", "unlogged", async () => 42);
    assert.equal(result, 42);
    const events = await log.readAll();
    const phaseEvents = events.filter((e) => e.type.startsWith("runtime.phase."));
    assert.equal(phaseEvents.length, 0, "no timing events when log undefined");
  });
});
