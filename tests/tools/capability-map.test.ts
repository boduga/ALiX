import { describe, it } from "node:test";
import assert from "node:assert";
import { inferCapability, isReadonlyCapability } from "../../src/tools/capability-map.js";

describe("Capability Map", () => {
  it("maps file tools to file.read", () => {
    assert.equal(inferCapability("alix_file_read"), "file.read");
  });

  it("maps shell tools to shell.run", () => {
    assert.equal(inferCapability("alix_shell_run"), "shell.run");
  });

  it("maps unknown tools to tool.invoke", () => {
    assert.equal(inferCapability("unknown_tool"), "tool.invoke");
  });

  it("identifies readonly capabilities", () => {
    assert.ok(isReadonlyCapability("file.read"));
    assert.ok(isReadonlyCapability("shell.readonly"));
    assert.ok(!isReadonlyCapability("shell.run"));
    assert.ok(!isReadonlyCapability("file.write"));
  });
});