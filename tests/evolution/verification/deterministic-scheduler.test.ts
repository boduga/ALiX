/**
 * Tests A2.2 — DeterministicScheduler.
 *
 * @module deterministic-scheduler
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LogicalClock,
  DeterministicScheduler,
  type ScheduledTask,
} from "../../../src/evolution/verification/index.js";

function makeTask(
  taskId: string,
  tick: number,
  priority: number,
  log: string[],
): ScheduledTask {
  return {
    taskId,
    tick,
    priority,
    execute: () => {
      log.push(taskId);
    },
  };
}

describe("DeterministicScheduler", () => {
  it("executes tasks at current tick in priority order", async () => {
    const clock = new LogicalClock();
    clock.tick(); // now = 1
    const log: string[] = [];
    const scheduler = new DeterministicScheduler(clock);

    scheduler.schedule(makeTask("low", 1, 1, log));
    scheduler.schedule(makeTask("high", 1, 5, log));
    scheduler.schedule(makeTask("mid", 1, 3, log));

    await scheduler.drain();

    assert.deepStrictEqual(log, ["high", "mid", "low"]);
  });

  it("defers tasks scheduled for future ticks", async () => {
    const clock = new LogicalClock();
    clock.tick(); // now = 1
    const log: string[] = [];
    const scheduler = new DeterministicScheduler(clock);

    scheduler.schedule(makeTask("now", 1, 1, log));
    scheduler.schedule(makeTask("future", 5, 1, log));

    const executed = await scheduler.drain();

    assert.strictEqual(executed, 1);
    assert.deepStrictEqual(log, ["now"]);
    assert.strictEqual(scheduler.pending(), 1);
  });

  it("tie-breaks by taskId when priority and tick are equal", async () => {
    const clock = new LogicalClock();
    clock.tick();
    const log: string[] = [];
    const scheduler = new DeterministicScheduler(clock);

    scheduler.schedule(makeTask("charlie", 1, 1, log));
    scheduler.schedule(makeTask("alpha", 1, 1, log));
    scheduler.schedule(makeTask("bravo", 1, 1, log));

    await scheduler.drain();

    assert.deepStrictEqual(log, ["alpha", "bravo", "charlie"]);
  });

  it("empty drain is a no-op", async () => {
    const clock = new LogicalClock();
    const scheduler = new DeterministicScheduler(clock);
    const executed = await scheduler.drain();
    assert.strictEqual(executed, 0);
    assert.strictEqual(scheduler.pending(), 0);
  });

  it("tickAndDrain advances clock then drains", async () => {
    const clock = new LogicalClock();
    const log: string[] = [];
    const scheduler = new DeterministicScheduler(clock);

    scheduler.schedule(makeTask("t1", 1, 1, log));

    // At tick 0, task scheduled for tick 1 is deferred
    let executed = await scheduler.drain();
    assert.strictEqual(executed, 0);

    // tickAndDrain advances to tick 1, then drains
    executed = await scheduler.tickAndDrain();
    assert.strictEqual(executed, 1);
    assert.deepStrictEqual(log, ["t1"]);
  });

  it("clear() removes all pending tasks", () => {
    const clock = new LogicalClock();
    const scheduler = new DeterministicScheduler(clock);
    scheduler.schedule(makeTask("a", 1, 1, []));
    scheduler.schedule(makeTask("b", 1, 1, []));
    assert.strictEqual(scheduler.pending(), 2);
    scheduler.clear();
    assert.strictEqual(scheduler.pending(), 0);
  });

  it("deterministic: same schedule produces same execution order", async () => {
    const run = async () => {
      const clock = new LogicalClock();
      clock.tick();
      const log: string[] = [];
      const scheduler = new DeterministicScheduler(clock);
      scheduler.schedule(makeTask("c", 1, 2, log));
      scheduler.schedule(makeTask("a", 1, 5, log));
      scheduler.schedule(makeTask("b", 1, 5, log));
      await scheduler.drain();
      return log;
    };

    assert.deepStrictEqual(await run(), await run());
  });
});
