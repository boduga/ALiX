import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OwnershipRegistry } from "../../src/coordination/ownership/ownership-registry.js";
import { createGe04OwnershipAuthority, isTrustedGe04OwnershipAuthority } from "../../src/coordination/ownership/ge04-ownership-authority.js";

test("GE04 ownership port rejects forged registry and structural copies", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge04-ownership-port-"));
  try {
    const registry = new OwnershipRegistry(root);
    const port = createGe04OwnershipAuthority(registry);
    assert.equal(isTrustedGe04OwnershipAuthority(port), true);
    assert.equal(Object.isFrozen(port), true);
    assert.equal(isTrustedGe04OwnershipAuthority({ ...port }), false);
    assert.equal("acquire" in port, false);
    assert.equal("release" in port, false);
    assert.equal("revoke" in port, false);
    assert.throws(() => createGe04OwnershipAuthority({ ...registry } as OwnershipRegistry), /real ownership registry/);
    const target = join(root, "owned", "file.txt");
    const denied = await port.withExclusiveLeaseFence("missing", "worker", target, async () => "mutated");
    assert.deepEqual(denied, { allowed: false });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("GE04 ownership port delegates a real exclusive-write lease fence", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge04-ownership-fence-"));
  try {
    const registry = new OwnershipRegistry(root);
    const port = createGe04OwnershipAuthority(registry);
    const owned = join(root, "owned");
    const grant = await registry.acquire({ agentId: "worker", scope: { kind: "path", root: owned, recursive: true }, mode: "exclusive-write" });
    assert.equal(grant.acquired, true);
    await port.refresh();
    assert.equal(port.get(grant.record!.id)?.agentId, "worker");
    let invoked = false;
    const allowed = await port.withExclusiveLeaseFence(grant.record!.id, "worker", join(owned, "ok"), async () => { invoked = true; return 42; });
    assert.deepEqual(allowed, { allowed: true, value: 42 });
    assert.equal(invoked, true);
    invoked = false;
    const denied = await port.withExclusiveLeaseFence(grant.record!.id, "other", join(owned, "ok"), async () => { invoked = true; });
    assert.deepEqual(denied, { allowed: false });
    assert.equal(invoked, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
