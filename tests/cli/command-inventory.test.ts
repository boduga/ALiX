import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..");
const cliPath = join(repoRoot, "dist", "src", "cli.js");

const ROOT_COMMAND_ORDER = [
  "run",
  "tui",
  "submit",
  "session",
  "plan",
  "review",
  "apply",
  "security",
  "credential",
  "policy",
  "audit",
  "evidence",
  "reflection",
  "adaptation",
  "decision",
  "workflow",
  "runtime",
  "baseline",
  "daemon",
  "runs",
  "failures",
  "approvals",
  "schedule",
];

function rootHelp(): string {
  return execFileSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
}

function commandPosition(help: string, command: string): number {
  const match = new RegExp(`\\n\\s+alix ${command}(?:\\s|$)`).exec(help);
  return match?.index ?? -1;
}

describe("CLI command inventory", () => {
  it("every root-help command is in the canonical order list", () => {
    const help = rootHelp();
    const inHelp = [...new Set([...help.matchAll(/\n\s+alix (\w+)/g)].map((m) => m[1]))];
    const notInOrder = inHelp.filter((c) => !ROOT_COMMAND_ORDER.includes(c));
    assert.ok(
      notInOrder.length === 0,
      `Commands in help but not in ROOT_COMMAND_ORDER: ${notInOrder.join(", ")}`,
    );
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
