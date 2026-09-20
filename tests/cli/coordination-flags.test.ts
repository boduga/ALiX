import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFlag } from "../../src/cli/commands/coordination.js";

describe("coordination readFlag", () => {
  it("parses space-separated form", () => {
    assert.equal(readFlag(["run", "--session-mode", "bypass"], "--session-mode"), "bypass");
  });

  it("parses --flag=value form", () => {
    assert.equal(readFlag(["run", "--session-mode=bypass"], "--session-mode"), "bypass");
    assert.equal(readFlag(["run", "--max-concurrency=2"], "--max-concurrency"), "2");
  });

  it("prefers space-separated form when both present", () => {
    assert.equal(
      readFlag(["--session-mode", "ask", "--session-mode=bypass"], "--session-mode"),
      "ask",
    );
  });

  it("returns undefined when absent or valueless", () => {
    assert.equal(readFlag(["run"], "--session-mode"), undefined);
    assert.equal(readFlag(["run", "--session-mode"], "--session-mode"), undefined);
  });
});
