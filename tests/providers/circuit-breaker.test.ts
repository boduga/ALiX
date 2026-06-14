import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker } from "../../src/providers/circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("starts closed", () => {
    assert.equal(new CircuitBreaker().getState(), "closed");
  });

  it("trips to open after failureThreshold failures", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 60000 });
    await assert.rejects(() => cb.call(() => { throw new Error("fail"); }));
    assert.equal(cb.getState(), "closed"); // 1 failure, below threshold
    await assert.rejects(() => cb.call(() => { throw new Error("fail"); }));
    assert.equal(cb.getState(), "open");
  });

  it("throws immediately when open", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 60000 });
    await assert.rejects(() => cb.call(() => { throw new Error("fail"); }));
    await assert.rejects(() => cb.call(() => Promise.resolve("ok")), /Circuit breaker is open/);
  });

  it("half-open probe success transitions to closed", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1 });
    await assert.rejects(() => cb.call(() => { throw new Error("fail"); }));
    assert.equal(cb.getState(), "open");
    await new Promise(r => setTimeout(r, 5));
    const result = await cb.call(() => Promise.resolve("probe ok"));
    assert.equal(result, "probe ok");
    assert.equal(cb.getState(), "closed");
  });

  it("reset restores closed state", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 60000 });
    cb.onFailure();
    assert.equal(cb.getState(), "open");
    cb.reset();
    assert.equal(cb.getState(), "closed");
  });
});
