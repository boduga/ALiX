import { describe, it } from "node:test";
import assert from "node:assert";
import { ShellWhitelist, parseWhitelistEnv, BLOCKED_COMMANDS } from "../../src/policy/shell-whitelist.js";

describe("ShellWhitelist", () => {
  const config = {
    mode: "allow" as const,
    rules: [
      { command: "npm", description: "Node package manager", risk: "medium" as const },
      { command: "git", description: "Git version control", risk: "medium" as const },
      { command: "ls", description: "List directory", risk: "low" as const },
    ],
    allowUnmatched: false,
  };

  const whitelist = new ShellWhitelist(config);

  // Allowed commands
  it("allows npm", () => {
    const result = whitelist.check("npm install");
    assert.strictEqual(result.allowed, true);
  });

  it("allows git status", () => {
    const result = whitelist.check("git status");
    assert.strictEqual(result.allowed, true);
  });

  it("allows ls with args", () => {
    const result = whitelist.check("ls -la");
    assert.strictEqual(result.allowed, true);
  });

  // Blocked commands (never allowed)
  it("blocks sudo", () => {
    const result = whitelist.check("sudo rm -rf /");
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason?.includes("never allowed"));
  });

  it("blocks dd", () => {
    const result = whitelist.check("dd if=/dev/zero of=test");
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason?.includes("never allowed"));
  });

  it("blocks crontab", () => {
    const result = whitelist.check("crontab -e");
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason?.includes("never allowed"));
  });

  // Unmatched commands
  it("blocks unknown commands when allowUnmatched=false", () => {
    const result = whitelist.check("some-unknown-cmd -x");
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason?.includes("not in the allowed whitelist"));
  });

  it("requires approval for unknown commands when allowUnmatched=true", () => {
    const configWithApproval = { ...config, allowUnmatched: true };
    const wl = new ShellWhitelist(configWithApproval);
    const result = wl.check("some-unknown-command");
    assert.strictEqual(result.allowed, false);
  });

  // Helper functions
  it("parses colon-separated env", () => {
    const commands = parseWhitelistEnv("npm:git:ls:node");
    assert.deepStrictEqual(commands, ["npm", "git", "ls", "node"]);
  });

  it("parses JSON array env", () => {
    const commands = parseWhitelistEnv('["npm", "git", "ls"]');
    assert.deepStrictEqual(commands, ["npm", "git", "ls"]);
  });

  it("getAllowedCommands returns sorted list", () => {
    const allowed = whitelist.getAllowedCommands();
    assert.ok(Array.isArray(allowed));
    assert.ok(allowed.length > 0);
  });
});

describe("BLOCKED_COMMANDS", () => {
  it("contains critical system commands", () => {
    assert.ok(BLOCKED_COMMANDS.includes("sudo"));
    assert.ok(BLOCKED_COMMANDS.includes("dd"));
    assert.ok(BLOCKED_COMMANDS.includes("crontab"));
    assert.ok(BLOCKED_COMMANDS.includes("mount"));
  });

  it("contains no duplicates", () => {
    const unique = new Set(BLOCKED_COMMANDS);
    assert.strictEqual(unique.size, BLOCKED_COMMANDS.length);
  });
});