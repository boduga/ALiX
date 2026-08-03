import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSkillsCommand } from "../../../../src/cli/commands/skills/run-skills.js";

describe("resolveSkillsCommand", () => {
  it('maps ["available"] to { type: "available" }', () => {
    assert.deepEqual(resolveSkillsCommand(["available"]), { type: "available" });
  });

  it('maps ["--available"] (legacy flag) to { type: "available" }', () => {
    assert.deepEqual(resolveSkillsCommand(["--available"]), { type: "available" });
  });

  it('maps ["marketplace"] to marketplace list', () => {
    assert.deepEqual(resolveSkillsCommand(["marketplace"]), {
      type: "marketplace",
      action: "list",
      name: undefined,
      url: undefined,
    });
  });

  it('maps ["marketplace", "add", "acme", url] to marketplace add', () => {
    assert.deepEqual(resolveSkillsCommand(["marketplace", "add", "acme", "https://github.com/acme/skills"]), {
      type: "marketplace",
      action: "add",
      name: "acme",
      url: "https://github.com/acme/skills",
    });
  });

  it('maps ["install", "brand"] to install with name "brand"', () => {
    assert.deepEqual(resolveSkillsCommand(["install", "brand"]), {
      type: "install",
      opts: { available: false, list: false, name: "brand", from: undefined },
    });
  });

  it('maps ["install", "brand", "--from", "./x"] to install with from "./x"', () => {
    assert.deepEqual(resolveSkillsCommand(["install", "brand", "--from", "./x"]), {
      type: "install",
      opts: { available: false, list: false, name: "brand", from: "./x" },
    });
  });

  it('maps ["install", "list"] (bare subcommand) to install with list: true, not a skill named "list"', () => {
    assert.deepEqual(resolveSkillsCommand(["install", "list"]), {
      type: "install",
      opts: { available: false, list: true, name: undefined, from: undefined },
    });
  });

  it('maps ["install", "--list"] to install with list: true', () => {
    assert.deepEqual(resolveSkillsCommand(["install", "--list"]), {
      type: "install",
      opts: { available: false, list: true, name: undefined, from: undefined },
    });
  });

  it('maps ["unknown"] to { type: "help" }', () => {
    assert.deepEqual(resolveSkillsCommand(["unknown"]), { type: "help" });
  });

  it('maps an unknown marketplace action to { type: "help" } instead of force-casting', () => {
    assert.deepEqual(resolveSkillsCommand(["marketplace", "bogus"]), { type: "help" });
  });

  it('maps ["remove", "brand"] to install with remove: true and name "brand"', () => {
    assert.deepEqual(resolveSkillsCommand(["remove", "brand"]), {
      type: "install",
      opts: { remove: true, name: "brand" },
    });
  });

  it("maps empty args to { type: 'help' }", () => {
    assert.deepEqual(resolveSkillsCommand([]), { type: "help" });
  });
});
