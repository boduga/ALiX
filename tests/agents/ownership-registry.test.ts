import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OwnershipRegistry } from "../../src/agents/ownership-registry.js";

describe("OwnershipRegistry", () => {
  it("claims ownership of a path", () => {
    const registry = new OwnershipRegistry();
    registry.claim("agent-1", ["src/a.ts", "src/b.ts"]);
    assert.equal(registry.count(), 2);
    assert.ok(registry.isOwner("agent-1", "src/a.ts"));
    assert.ok(registry.isOwner("agent-1", "src/b.ts"));
  });

  it("rejects overlapping ownership by different agent", () => {
    const registry = new OwnershipRegistry();
    registry.claim("agent-1", ["src/shared.ts"]);
    assert.throws(() => {
      registry.claim("agent-2", ["src/shared.ts"]);
    }, /Overlapping ownership/);
  });

  it("allows same agent to claim same path twice", () => {
    const registry = new OwnershipRegistry();
    registry.claim("agent-1", ["src/shared.ts"]);
    registry.claim("agent-1", ["src/shared.ts"]); // no throw
    assert.ok(registry.isOwner("agent-1", "src/shared.ts"));
  });

  it("releases ownership when agent finishes", () => {
    const registry = new OwnershipRegistry();
    registry.claim("agent-1", ["src/a.ts"]);
    registry.release("agent-1");
    assert.equal(registry.count(), 0);
    assert.ok(!registry.isOwner("agent-1", "src/a.ts"));
  });

  it("lists owned paths for an agent", () => {
    const registry = new OwnershipRegistry();
    registry.claim("agent-1", ["src/a.ts", "src/b.ts"]);
    registry.claim("agent-2", ["src/c.ts"]);
    const owned = registry.ownedBy("agent-1");
    assert.deepEqual(owned.sort(), ["src/a.ts", "src/b.ts"]);
  });

  it("count returns total owned paths", () => {
    const registry = new OwnershipRegistry();
    registry.claim("agent-1", ["src/a.ts", "src/b.ts"]);
    registry.claim("agent-2", ["src/c.ts"]);
    assert.equal(registry.count(), 3);
  });
});