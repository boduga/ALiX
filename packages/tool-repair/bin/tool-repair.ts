#!/usr/bin/env node
/**
 * @alix/tool-repair CLI
 * Usage:
 *   tool-repair process   < tool-call.json   # For Claude Code hook
 *   tool-repair mine                         # Mine session logs for patterns
 */

import { ToolRepair } from "../src/index.js";
import { readFileSync } from "node:fs";

const command = process.argv[2];

if (command === "process") {
  await processCommand();
} else if (command === "mine") {
  await mineCommand();
} else if (command === "check") {
  await checkCommand();
} else {
  console.log(JSON.stringify({ error: "Usage: tool-repair <process|mine|check>" }));
}

async function processCommand() {
  const model = process.env.TOOL_REPAIR_MODEL || "claude-opus-4.8";
  const stdin = readFileSync(process.stdin.fd, "utf-8").trim();
  if (!stdin) {
    console.log(JSON.stringify({ repaired: false }));
    return;
  }

  let data;
  try {
    data = JSON.parse(stdin);
  } catch {
    console.log(JSON.stringify({ repaired: false }));
    return;
  }

  // Claude Code passes tool calls as { name, tool_input: { ... } }
  const toolName = data.name || data.tool_name || "";
  const args = data.tool_input || data.args || {};

  const repair = new ToolRepair(model);
  const result = repair.process(toolName, args);

  if (!result.repaired) {
    console.log(JSON.stringify({ repaired: false }));
    return;
  }

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: `[Tool Repair Hint] ${result.hint}`,
    },
  }));
}

async function mineCommand() {
  // Placeholder — will be implemented in Task 8
  console.log(JSON.stringify({ message: "Mine command coming in Task 8" }));
}

async function checkCommand() {
  console.log(JSON.stringify({ status: "ok", model: process.env.TOOL_REPAIR_MODEL || "claude-opus-4.8" }));
}
