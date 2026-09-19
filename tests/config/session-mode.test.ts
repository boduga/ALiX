import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSessionMode } from "../../src/config/schema.js";

describe("parseSessionMode", () => {
  it("round-trips every valid mode", () => {
    assert.equal(parseSessionMode("auto"), "auto");
    assert.equal(parseSessionMode("ask"), "ask");
    assert.equal(parseSessionMode("bypass"), "bypass");
  });

  it("falls back to ask by default for anything else", () => {
    assert.equal(parseSessionMode(undefined), "ask");
    assert.equal(parseSessionMode(null), "ask");
    assert.equal(parseSessionMode("AUTO"), "ask");
    assert.equal(parseSessionMode(42), "ask");
    assert.equal(parseSessionMode({}), "ask");
  });

  it("honors an explicit fallback", () => {
    assert.equal(parseSessionMode("nope", "bypass"), "bypass");
    assert.equal(parseSessionMode(undefined, "auto"), "auto");
  });
});
