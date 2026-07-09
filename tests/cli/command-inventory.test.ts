import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..");
const cliPath = join(repoRoot, "dist", "src", "cli.js");
const sourcePath = join(repoRoot, "src", "cli.ts");

const ROOT_COMMAND_ORDER = [
  "chat",
  "run",
  "submit",
  "session",
  "plan",
  "review",
  "apply",
  "graph",
  "sop",
  "report",
  "metrics",
  "demo",
  "init",
  "serve",
  "inspector",
  "tui",
  "db",
  "config",
  "mcp",
  "extension",
  "skill",
  "skills",
  "agent",
  "memory",
  "registry",
  "doctor",
  "models",
  "benchmark",
  "provider",
  "security",
  "credential",
  "policy",
  "audit",
  "evidence",
  "runtime",
  "daemon",
  "runs",
  "failures",
  "approvals",
  "approval",
  "workflow",
  "reflection",
  "adaptation",
  "decision",
  "learning",
  "explain",
  "governance",
  "executive",
  "baseline",
  "research",
  "issue",
  "coordination",
  "ownership",
  "recovery",
  "observability",
];

function rootHelp(): string {
  return execFileSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
}

function routedCommands(): string[] {
  const source = readFileSync(sourcePath, "utf8");
  const matches = source.matchAll(/if \(command === "([^"]+)"/g);
  const commands = [...matches].map((match) => match[1]).filter((command) => !command.startsWith("-"));
  return [...new Set(commands)];
}

function commandPosition(help: string, command: string): number {
  const match = new RegExp(`\\n\\s+alix ${command}(?:\\s|$)`).exec(help);
  return match?.index ?? -1;
}

describe("CLI command inventory", () => {
  it("root help lists every routed top-level command", () => {
    const help = rootHelp();
    const missing = routedCommands().filter((command) => !help.includes(`alix ${command}`));

    assert.deepEqual(missing, []);
  });

  it("root help keeps top-level commands in canonical order", () => {
    const help = rootHelp();
    const positions = ROOT_COMMAND_ORDER.map((command) => {
      const index = commandPosition(help, command);
      assert.notEqual(index, -1, `missing alix ${command}`);
      return [command, index] as const;
    });

    for (let i = 1; i < positions.length; i++) {
      const [previousCommand, previousIndex] = positions[i - 1];
      const [currentCommand, currentIndex] = positions[i];
      assert.ok(
        previousIndex < currentIndex,
        `expected alix ${previousCommand} before alix ${currentCommand}`,
      );
    }
  });

  it("root help and version commands execute", () => {
    assert.match(rootHelp(), /^ALiX /);
    assert.match(execFileSync(process.execPath, [cliPath, "--version"], { encoding: "utf8" }), /^\d+\.\d+\.\d+/);
  });
});
