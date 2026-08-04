import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { resolveSkillsCommand } from "../../../../src/cli/commands/skills/run-skills.js";
import { resolveSkillScriptPath } from "../../../../src/cli/commands/skills/run-skill.js";

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
      opts: { available: false, list: false, name: "brand", from: undefined, force: false },
    });
  });

  it('maps ["install", "brand", "--from", "./x"] to install with from "./x"', () => {
    assert.deepEqual(resolveSkillsCommand(["install", "brand", "--from", "./x"]), {
      type: "install",
      opts: { available: false, list: false, name: "brand", from: "./x", force: false },
    });
  });

  it('maps ["install", "list"] (bare subcommand) to install with list: true, not a skill named "list"', () => {
    assert.deepEqual(resolveSkillsCommand(["install", "list"]), {
      type: "install",
      opts: { available: false, list: true, name: undefined, from: undefined, force: false },
    });
  });

  it('maps ["install", "--list"] to install with list: true', () => {
    assert.deepEqual(resolveSkillsCommand(["install", "--list"]), {
      type: "install",
      opts: { available: false, list: true, name: undefined, from: undefined, force: false },
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

  it("parses 'skills run <skill> <script> [args]'", () => {
    const cmd = resolveSkillsCommand(["run", "xlsx", "recalc.py", "--file", "a.xlsx"]);
    assert.deepEqual(cmd, { type: "run", name: "xlsx", script: "recalc.py", args: ["--file", "a.xlsx"] });
  });

  it("parses 'install --force'", () => {
    const cmd = resolveSkillsCommand(["install", "x", "--from", "/tmp/x", "--force"]);
    assert.ok(cmd.type === "install" && cmd.opts.force === true);
  });
});

describe("resolveSkillScriptPath", () => {
  const skillDir = join("/home", "u", ".alix", "skills", "demo");

  it("resolves a bare script name inside scripts/", () => {
    assert.equal(resolveSkillScriptPath(skillDir, "build.sh"), join(skillDir, "scripts", "build.sh"));
  });

  it("rejects path traversal", () => {
    assert.throws(() => resolveSkillScriptPath(skillDir, "../evil.sh"), /Invalid script name/);
    assert.throws(() => resolveSkillScriptPath(skillDir, "../../etc/passwd"), /Invalid script name/);
  });

  it("rejects absolute and empty names", () => {
    assert.throws(() => resolveSkillScriptPath(skillDir, "/etc/passwd"), /Invalid script name/);
    assert.throws(() => resolveSkillScriptPath(skillDir, ""), /Invalid script name/);
    assert.throws(() => resolveSkillScriptPath(skillDir, ".."), /Invalid script name/);
  });
});
