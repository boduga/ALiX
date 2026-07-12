/**
 * Tests A2.4 — Lineage Tracker.
 *
 * @module lineage-tracker
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LineageTracker,
} from "../../../src/evolution/verification/index.js";

describe("LineageTracker", () => {
  it("starts empty", () => {
    const tracker = new LineageTracker();
    assert.strictEqual(tracker.length(), 0);
    assert.deepStrictEqual(tracker.getLineage(), []);
  });

  it("accumulates records in insertion order", () => {
    const tracker = new LineageTracker();
    tracker.addRecord("replay", "ds-001", "replay_dataset", "2026-07-12T10:00:00.000Z");
    tracker.addRecord("proposal", "prop-001", "proposal", "2026-07-12T10:00:01.000Z");
    tracker.addRecord("evaluate", "ver-run-001", "run", "2026-07-12T10:00:02.000Z");

    const lineage = tracker.getLineage();
    assert.strictEqual(lineage.length, 3);
    assert.strictEqual(lineage[0].step, "replay");
    assert.strictEqual(lineage[1].step, "proposal");
    assert.strictEqual(lineage[2].step, "evaluate");
  });

  it("length() returns record count", () => {
    const tracker = new LineageTracker();
    tracker.addRecord("a", "1", "run", "t1");
    tracker.addRecord("b", "2", "run", "t2");
    assert.strictEqual(tracker.length(), 2);
  });

  it("clear() removes all records", () => {
    const tracker = new LineageTracker();
    tracker.addRecord("a", "1", "run", "t1");
    tracker.addRecord("b", "2", "run", "t2");
    tracker.clear();
    assert.strictEqual(tracker.length(), 0);
    assert.deepStrictEqual(tracker.getLineage(), []);
  });

  it("getLineage() returns a copy (not the internal array)", () => {
    const tracker = new LineageTracker();
    tracker.addRecord("a", "1", "run", "t1");
    const lineage1 = tracker.getLineage();
    const lineage2 = tracker.getLineage();
    assert.notStrictEqual(lineage1, lineage2);
  });

  it("addRecord returns this for chaining", () => {
    const tracker = new LineageTracker();
    const result = tracker.addRecord("a", "1", "run", "t1");
    assert.strictEqual(result, tracker);
  });
});
