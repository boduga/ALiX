import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handlePolicyCommand } from "../../src/tui/helpers/policy-commands.js";
import type { PolicyConfig } from "../../src/tui/helpers/policy-commands.js";

describe("/policy command", () => {
  it("show default mode returns bypass with warning icon", () => {
    const config: PolicyConfig = {};
    const output = handlePolicyCommand(config, "");
    assert.ok(output.some(l => l.includes("bypass")));
    assert.ok(output.some(l => l.includes("⚠")));
  });

  it("show ask mode returns checkmark", () => {
    const config: PolicyConfig = { permissions: { sessionMode: "ask" } };
    const output = handlePolicyCommand(config, "show");
    assert.ok(output.some(l => l.includes("ask")));
    assert.ok(output.some(l => l.includes("✓")));
  });

  it("show auto mode", () => {
    const config: PolicyConfig = { permissions: { sessionMode: "auto" } };
    const output = handlePolicyCommand(config, "status");
    assert.ok(output.some(l => l.includes("auto")));
    assert.ok(output.some(l => l.includes("●")));
  });

  it("switch to ask updates config and returns confirmation", () => {
    const config: PolicyConfig = { permissions: { sessionMode: "bypass" } };
    const output = handlePolicyCommand(config, "ask");
    assert.equal(config.permissions?.sessionMode, "ask");
    assert.ok(output.some(l => l.includes("changed to: ask")));
    assert.ok(output.some(l => l.includes("approval")));
  });

  it("switch to bypass updates config and returns confirmation", () => {
    const config: PolicyConfig = { permissions: { sessionMode: "ask" } };
    const output = handlePolicyCommand(config, "bypass");
    assert.equal(config.permissions?.sessionMode, "bypass");
    assert.ok(output.some(l => l.includes("changed to: bypass")));
    assert.ok(output.some(l => l.includes("allowed")));
  });

  it("switch to auto updates config and returns confirmation", () => {
    const config: PolicyConfig = {};
    const output = handlePolicyCommand(config, "auto");
    assert.equal(config.permissions?.sessionMode, "auto");
    assert.ok(output.some(l => l.includes("changed to: auto")));
  });

  it("works with undefined permissions (initializes)", () => {
    const config: PolicyConfig = {};
    handlePolicyCommand(config, "ask");
    assert.ok(config.permissions);
    assert.equal(config.permissions?.sessionMode, "ask");
  });

  it("unknown subcommand shows usage", () => {
    const config: PolicyConfig = {};
    const output = handlePolicyCommand(config, "unknown");
    assert.ok(output.some(l => l.includes("Usage")));
    assert.ok(output.some(l => l.includes("ask")));
    assert.ok(output.some(l => l.includes("bypass")));
  });
});
