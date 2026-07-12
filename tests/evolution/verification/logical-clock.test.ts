/**
 * Tests A2.2 — LogicalClock.
 *
 * @module logical-clock
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LogicalClock } from "../../../src/evolution/verification/index.js";

describe("LogicalClock", () => {
  it("starts at tick 0", () => {
    const clock = new LogicalClock();
    assert.strictEqual(clock.now(), 0);
  });

  it("tick() advances monotonically", () => {
    const clock = new LogicalClock();
    assert.strictEqual(clock.tick(), 1);
    assert.strictEqual(clock.tick(), 2);
    assert.strictEqual(clock.tick(), 3);
  });

  it("advance(n) advances by N ticks", () => {
    const clock = new LogicalClock();
    assert.strictEqual(clock.advance(5), 5);
    assert.strictEqual(clock.now(), 5);
  });

  it("reset() restores to tick 0", () => {
    const clock = new LogicalClock();
    clock.tick();
    clock.tick();
    clock.reset();
    assert.strictEqual(clock.now(), 0);
  });

  it("reset() produces identical sequence", () => {
    const clock = new LogicalClock();
    const seq1 = [clock.tick(), clock.tick(), clock.tick()];
    clock.reset();
    const seq2 = [clock.tick(), clock.tick(), clock.tick()];
    assert.deepStrictEqual(seq1, seq2);
  });

  it("snapshot/restore round-trips losslessly", () => {
    const clock = new LogicalClock(100);
    clock.tick();
    clock.tick();
    const snap = clock.snapshot();

    const clock2 = new LogicalClock(100);
    clock2.restore(snap);
    assert.strictEqual(clock2.now(), clock.now());
  });

  it("advance() rejects negative steps", () => {
    const clock = new LogicalClock();
    assert.throws(() => clock.advance(-1));
  });

  it("advance() rejects non-finite steps", () => {
    const clock = new LogicalClock();
    assert.throws(() => clock.advance(Infinity));
    assert.throws(() => clock.advance(NaN));
  });

  it("getStartTime returns the anchor", () => {
    const clock = new LogicalClock(42);
    assert.strictEqual(clock.getStartTime(), 42);
  });
});
