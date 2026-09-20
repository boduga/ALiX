import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { roleForWorker, isWriteWorker } from "../../src/kernel/worker-role.js";

describe("roleForWorker", () => {
  it("routes local-state caps to explorer, never researcher", () => {
    assert.equal(roleForWorker({ requiredCapabilities: ["state.read"] }), "explorer");
    assert.equal(roleForWorker({ requiredCapabilities: ["state.query"] }), "explorer");
    assert.equal(
      roleForWorker({ requiredCapabilities: ["filesystem.read", "state.read"] }),
      "explorer",
    );
    assert.equal(isWriteWorker({ requiredCapabilities: ["state.read"] }), false);
  });

  it("keeps existing routing for web and shell caps", () => {
    assert.equal(roleForWorker({ requiredCapabilities: ["web.search"] }), "researcher");
    assert.equal(roleForWorker({ requiredCapabilities: ["shell.exec"] }), "worker");
    assert.equal(roleForWorker({ requiredCapabilities: [] }), "explorer");
  });
});
