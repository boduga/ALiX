import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { installParentLivenessWatchdog } from "../../src/agents/subagent-cli.js";

function fakeStdin(opts: { isTTY?: boolean } = {}) {
  const emitter = new EventEmitter() as any;
  emitter.isTTY = opts.isTTY;
  emitter.resumed = false;
  emitter.unrefCalled = false;
  emitter.resume = () => { emitter.resumed = true; };
  emitter.unref = () => { emitter.unrefCalled = true; };
  return emitter;
}

describe("installParentLivenessWatchdog", () => {
  it("resumes stdin, unrefs it, and exits on end/close/error", () => {
    for (const event of ["end", "close", "error"]) {
      const stdin = fakeStdin();
      let code: number | undefined;
      installParentLivenessWatchdog(stdin, (c) => { code = c; });
      assert.equal(stdin.resumed, true);
      assert.equal(stdin.unrefCalled, true);
      stdin.emit(event);
      assert.equal(code, 1, `expected exit on ${event}`);
    }
  });

  it("does nothing for an interactive TTY", () => {
    const stdin = fakeStdin({ isTTY: true });
    let exited = false;
    installParentLivenessWatchdog(stdin, () => { exited = true; });
    assert.equal(stdin.resumed, false);
    stdin.emit("end");
    assert.equal(exited, false);
  });
});
