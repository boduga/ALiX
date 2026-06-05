import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTrigger, buildHook } from "../../src/self-extend/generate-hook.js";

describe("parseTrigger", () => {
  it("detects pre_tool from 'before every tool call'", () => {
    assert.equal(parseTrigger("before every tool call, check permissions"), "on_pre_tool");
  });
  it("detects post_tool from 'after a file is deleted'", () => {
    assert.equal(parseTrigger("after a file is deleted, log it"), "on_post_tool");
  });
  it("detects session end from 'when session ends'", () => {
    assert.equal(parseTrigger("when session ends, save a summary"), "on_session_end");
  });
  it("defaults to on_pre_tool for unknown triggers", () => {
    assert.equal(parseTrigger("do something"), "on_pre_tool");
  });
});

describe("buildHook", () => {
  it("returns a HookFn that can be called", async () => {
    let called = false;
    const { fn } = buildHook("before every tool call", "data._test = true");
    // Wrap the fn to handle the body execution properly
    const result = await fn({ type: "test", data: { _test: false } });
    assert.ok(result && result.handled);
  });
});
