/**
 * Tests A2.2 — DeterministicEventMerge.
 *
 * @module deterministic-event-merge
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeEvents,
  compareEvents,
  type DeterministicEvent,
} from "../../../src/evolution/verification/index.js";

function makeEvent(
  sourceId: string,
  tick: number,
  sequenceNumber: number,
  payload: unknown = null,
): DeterministicEvent {
  return { sourceId, tick, sequenceNumber, payload };
}

describe("mergeEvents", () => {
  it("merges a single stream unchanged", () => {
    const stream = [
      makeEvent("a", 1, 1),
      makeEvent("a", 2, 1),
    ];
    const merged = mergeEvents([stream]);
    assert.strictEqual(merged.length, 2);
    assert.strictEqual(merged[0].tick, 1);
    assert.strictEqual(merged[1].tick, 2);
  });

  it("orders by tick ascending", () => {
    const s1 = [makeEvent("a", 3, 1)];
    const s2 = [makeEvent("b", 1, 1)];
    const merged = mergeEvents([s1, s2]);
    assert.strictEqual(merged[0].tick, 1);
    assert.strictEqual(merged[1].tick, 3);
  });

  it("tie-breaks by sourceId lexicographic", () => {
    const s1 = [makeEvent("bbb", 1, 1)];
    const s2 = [makeEvent("aaa", 1, 1)];
    const merged = mergeEvents([s1, s2]);
    assert.strictEqual(merged[0].sourceId, "aaa");
    assert.strictEqual(merged[1].sourceId, "bbb");
  });

  it("tie-breaks by sequenceNumber ascending", () => {
    const s1 = [makeEvent("a", 1, 5)];
    const s2 = [makeEvent("a", 1, 1)];
    const merged = mergeEvents([s1, s2]);
    assert.strictEqual(merged[0].sequenceNumber, 1);
    assert.strictEqual(merged[1].sequenceNumber, 5);
  });

  it("handles empty streams", () => {
    assert.deepStrictEqual(mergeEvents([]), []);
    assert.deepStrictEqual(mergeEvents([[]]), []);
  });

  it("deterministic: same input always produces same output", () => {
    const s1 = [makeEvent("a", 2, 1), makeEvent("a", 1, 1)];
    const s2 = [makeEvent("b", 1, 2), makeEvent("b", 2, 1)];
    const r1 = mergeEvents([s1, s2]);
    const r2 = mergeEvents([s1, s2]);
    assert.deepStrictEqual(r1, r2);
  });

  it("does not mutate input events (copies payload)", () => {
    const event = makeEvent("a", 1, 1, { x: 1 });
    const merged = mergeEvents([[event]]);
    assert.notStrictEqual(merged[0], event);
  });
});

describe("compareEvents", () => {
  it("returns negative when a.tick < b.tick", () => {
    assert.ok(compareEvents(makeEvent("a", 1, 1), makeEvent("a", 2, 1)) < 0);
  });

  it("returns positive when a.tick > b.tick", () => {
    assert.ok(compareEvents(makeEvent("a", 2, 1), makeEvent("a", 1, 1)) > 0);
  });
});
