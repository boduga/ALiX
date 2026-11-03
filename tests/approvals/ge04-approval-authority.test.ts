import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalStore } from "../../src/governance/approvals/approval-store.js";
import { createGe04ApprovalAuthority, isTrustedGe04ApprovalAuthority } from "../../src/governance/approvals/ge04-approval-authority.js";

test("GE04 approval authority rejects forged store and structural port", async () => {
  const root = await mkdtemp(join(tmpdir(), "ge04-approval-authority-"));
  try {
    const store = new ApprovalStore(root);
    const port = createGe04ApprovalAuthority(store);
    assert.equal(isTrustedGe04ApprovalAuthority(port), true);
    assert.equal(Object.isFrozen(port), true);
    assert.equal("resolve" in port, false);
    assert.equal("revoke" in port, false);
    assert.equal("request" in port, false);
    assert.equal(isTrustedGe04ApprovalAuthority({ ...port }), false);
    assert.throws(() => createGe04ApprovalAuthority({ ...store } as ApprovalStore), /real approval store/);
    await port.load();
    assert.deepEqual(port.listUncertainConsumptions(), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
