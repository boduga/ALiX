import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lazy } from "../../src/utils/lazy-import.js";

describe("lazy", () => {
  it("does not call loader until accessed", () => {
    let called = 0;
    const m = lazy(() => { called++; return { x: 1 }; });
    assert.equal(called, 0);
    assert.equal(m().x, 1);
    assert.equal(called, 1);
  });

  it("caches result after first load", () => {
    let called = 0;
    const m = lazy(() => { called++; return { x: 1 }; });
    m();
    m();
    m();
    assert.equal(called, 1);
  });

  it("supports async loaders", async () => {
    const m = lazy(async () => ({ x: 42 }));
    const result = await m();
    assert.equal(result.x, 42);
  });
});