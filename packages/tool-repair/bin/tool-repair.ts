#!/usr/bin/env node
/**
 * @alix/tool-repair CLI
 * Usage:
 *   tool-repair process   < tool-call.json   # For Claude Code hook
 *   tool-repair mine                         # Mine session logs for patterns
 */

import { ToolRepair } from "../src/index.js";
import { readFileSync, existsSync } from "node:fs";
import { readdir, stat as fsStat } from "node:fs/promises";
import { join } from "node:path";
import { parseClaudeSession, findClaudeSessions } from "../src/miner/claude-session.js";
import { findAlixSessions, parseAlixSession } from "../src/miner/alix-session.js";
import { generateCandidates } from "../src/miner/pattern-candidate.js";

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
  const errors: Array<{
    toolName: string;
    args: Record<string, unknown>;
    errorOutput: string;
  }> = [];
  const modelId = process.env.TOOL_REPAIR_MODEL || "deepseek-v4-flash";
  const homedir = process.env.HOME || "/home/babasola";

  // Scan Claude Code sessions
  const claudeDir = join(homedir, ".claude", "projects");
  if (existsSync(claudeDir)) {
    const entries = await readdir(claudeDir);
    for (const entry of entries) {
      const projectDir = join(claudeDir, entry);
      try {
        const stat = await fsStat(projectDir);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }
      const files = await findClaudeSessions(projectDir);
      for (const file of files.slice(0, 10)) { // Limit to 10 files per project
        try {
          const { errors: sessionErrors } = await parseClaudeSession(file);
          errors.push(
            ...sessionErrors.map((e) => ({
              toolName: e.name,
              args: e.args,
              errorOutput: e.errorOutput,
            }))
          );
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  // Scan ALiX sessions in current project
  const cwd = process.cwd();
  const alixFiles = await findAlixSessions(cwd);
  for (const file of alixFiles.slice(0, 50)) { // Limit to 50 sessions
    try {
      const { events } = await parseAlixSession(file);
      for (const ev of events) {
        if (ev.type === "tool.failed") {
          errors.push({
            toolName: (ev.payload.toolName as string) ?? "unknown",
            args: (ev.payload.args as Record<string, unknown>) ?? {},
            errorOutput: (ev.payload.error as string) ?? "",
          });
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  const candidates = generateCandidates(errors, modelId);

  console.log(`Found ${errors.length} tool errors across scanned sessions.`);
  if (candidates.length === 0) {
    console.log("No candidate patterns found.");
    return;
  }
  console.log(`\nTop candidate patterns (by frequency):\n`);
  for (const c of candidates.slice(0, 10)) {
    console.log(`  [${c.frequency}x] ${c.toolName}: ${c.errorSignature}`);
    if (c.sampleArgs.length > 0) {
      console.log(`       Sample args: ${JSON.stringify(c.sampleArgs[0]).slice(0, 120)}`);
    }
    console.log();
  }
}

async function checkCommand() {
  console.log(JSON.stringify({ status: "ok", model: process.env.TOOL_REPAIR_MODEL || "claude-opus-4.8" }));
}
