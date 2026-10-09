import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DaemonAgentSession } from "../../src/interfaces/tui/daemon-client.js";

const DIR_ID = "1791220457513";

describe("DaemonAgentSession session identity", () => {
  it("reports the session id supplied by the composition root", () => {
    const session = new DaemonAgentSession("/workspace", null, "auto", DIR_ID);
    assert.equal(session.getSessionId(), DIR_ID);
  });

  it("getState() carries the same identity as getSessionId()", () => {
    const session = new DaemonAgentSession("/workspace", null, "auto", "sess-dir-42");
    assert.equal(session.getState().sessionId, session.getSessionId());
    assert.equal(session.getState().sessionId, "sess-dir-42");
  });

  it("never substitutes a clock-generated id for the supplied one", () => {
    const session = new DaemonAgentSession("/workspace", null, "auto", "not-a-timestamp");
    assert.equal(session.getSessionId(), "not-a-timestamp");
    assert.notEqual(session.getSessionId(), `${Date.now()}`);
  });

  it("keeps identity stable across repeated reads", () => {
    const session = new DaemonAgentSession("/workspace", null, "auto", DIR_ID);
    const first = session.getSessionId();
    assert.equal(session.getSessionId(), first);
    assert.equal(session.getState().sessionId, first);
    assert.equal(first, DIR_ID);
  });
});
