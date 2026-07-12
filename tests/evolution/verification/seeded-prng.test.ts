/**
 * Tests A2.2 — SeededPRNG.
 *
 * @module seeded-prng
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SeededPRNG } from "../../../src/evolution/verification/index.js";

describe("SeededPRNG", () => {
  it("same seed produces same sequence", () => {
    const prng1 = new SeededPRNG(42);
    const prng2 = new SeededPRNG(42);
    for (let i = 0; i < 100; i++) {
      assert.strictEqual(prng1.next(), prng2.next());
    }
  });

  it("different seeds produce different sequences", () => {
    const prng1 = new SeededPRNG(42);
    const prng2 = new SeededPRNG(43);
    let anyDifferent = false;
    for (let i = 0; i < 100; i++) {
      if (prng1.next() !== prng2.next()) {
        anyDifferent = true;
        break;
      }
    }
    assert.ok(anyDifferent, "different seeds should produce different sequences");
  });

  it("next() returns values in [0, 1)", () => {
    const prng = new SeededPRNG(42);
    for (let i = 0; i < 1000; i++) {
      const v = prng.next();
      assert.ok(v >= 0 && v < 1, `value ${v} out of range [0, 1)`);
    }
  });

  it("nextInt(min, max) returns integers in [min, max]", () => {
    const prng = new SeededPRNG(42);
    for (let i = 0; i < 100; i++) {
      const v = prng.nextInt(5, 10);
      assert.ok(Number.isInteger(v), `${v} should be an integer`);
      assert.ok(v >= 5 && v <= 10, `${v} out of range [5, 10]`);
    }
  });

  it("reset() restores initial state", () => {
    const prng = new SeededPRNG(42);
    const seq1: number[] = [];
    for (let i = 0; i < 10; i++) seq1.push(prng.next());

    prng.reset();
    const seq2: number[] = [];
    for (let i = 0; i < 10; i++) seq2.push(prng.next());

    assert.deepStrictEqual(seq1, seq2);
  });

  it("snapshot/restore round-trips", () => {
    const prng1 = new SeededPRNG(42);
    prng1.next();
    prng1.next();
    const snap = prng1.snapshot();

    const prng2 = new SeededPRNG(42);
    prng2.restore(snap);

    assert.strictEqual(prng1.next(), prng2.next());
  });

  it("getSeed returns the original seed", () => {
    const prng = new SeededPRNG(123);
    assert.strictEqual(prng.getSeed(), 123);
  });

  it("rejects non-finite seed", () => {
    assert.throws(() => new SeededPRNG(NaN));
    assert.throws(() => new SeededPRNG(Infinity));
  });

  it("nextInt() rejects min > max", () => {
    const prng = new SeededPRNG(42);
    assert.throws(() => prng.nextInt(10, 5));
  });
});
