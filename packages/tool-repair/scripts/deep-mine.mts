#!/usr/bin/env npx tsx
/**
 * Deep mine — improved error classification for tool-call failures.
 * Reads Claude Code and ALiX sessions, classifies errors by actual failure pattern.
 */
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { homedir } from "node:os";

interface ToolError {
  toolName: string;
  args: Record<string, unknown>;
  errorOutput: string;
  sessionSource: string;
  model?: string;
}

// ——— Better error classification ———

type ErrorCategory = {
  id: string;
  label: string;
  /** Sample error texts that match this category */
  matches: string[];
  /** Is this fixable with a deterministic repair? */
  fixable: boolean;
  /** What kind of repair would fix it? */
  repairApproach?: string;
};

const ERROR_CATEGORIES: ErrorCategory[] = [
  {
    id: "null_field",
    label: "Null/undefined in optional param",
    matches: ["null", "undefined"],
    fixable: true,
    repairApproach: "remove the null field",
  },
  {
    id: "markdown_in_path",
    label: "Markdown link syntax in file path",
    matches: ["[", "]", "("],
    fixable: true,
    repairApproach: "strip markdown link syntax",
  },
  {
    id: "zod_validation",
    label: "Zod schema validation error",
    matches: ["ZodError", "validation"],
    fixable: false,
  },
  {
    id: "permission_prompt",
    label: "Permission denied / approval needed",
    matches: ["permission", "denied", "approval", "bypass"],
    fixable: false,
  },
  {
    id: "file_not_found",
    label: "File not found (ENOENT)",
    matches: ["ENOENT", "no such file", "not found"],
    fixable: false,
  },
  {
    id: "command_not_found",
    label: "Command not found",
    matches: ["command not found", "not a command"],
    fixable: false,
  },
  {
    id: "timeout",
    label: "Timeout",
    matches: ["timeout", "timed out"],
    fixable: false,
  },
  {
    id: "rate_limit",
    label: "Rate limited / 429",
    matches: ["429", "rate limit"],
    fixable: false,
  },
  {
    id: "empty_arg",
    label: "Empty string or object sent as arg",
    matches: ["empty", "must not be empty"],
    fixable: true,
    repairApproach: "remove or default the empty field",
  },
  {
    id: "type_error_arg",
    label: "TypeError — wrong argument type",
    matches: ["TypeError", "must be", "expected"],
    fixable: true,
    repairApproach: "coerce type or remove bad arg",
  },
  {
    id: "exit_code_other",
    label: "Tool exited with non-zero code",
    matches: ["Exit code"],
    fixable: false,
  },
  {
    id: "unknown",
    label: "Other / uncategorized",
    matches: [],
    fixable: false,
  },
];

function classifyError(toolName: string, errorOutput: string, args: Record<string, unknown>): { category: string; categoryLabel: string; fixable: boolean; repairApproach?: string } {
  const lower = errorOutput.toLowerCase();

  for (const cat of ERROR_CATEGORIES) {
    if (cat.matches.some(m => lower.includes(m.toLowerCase()))) {
      return { category: cat.id, categoryLabel: cat.label, fixable: cat.fixable, repairApproach: cat.repairApproach };
    }
  }

  return { category: "unknown", categoryLabel: "Other / uncategorized", fixable: false };
}

function extractToolName(name: string): string {
  if (!name || name === "unknown") return name;
  // Shorten MCP tool names
  if (name.startsWith("mcp__")) {
    const parts = name.split("__");
    return `mcp.${parts[1]}`;
  }
  return name;
}

// ——— Claude session reader ———

async function parseClaudeSession(filePath: string): Promise<ToolError[]> {
  const errors: ToolError[] = [];
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  let calls = new Map<string, { name: string; args: Record<string, unknown> }>();

  for await (const line of rl) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === "assistant") {
        for (const block of obj.message?.content ?? []) {
          if (block.type === "tool_use") {
            calls.set(block.id, { name: block.name, args: block.input ?? {} });
          }
        }
      } else if (obj.type === "user") {
        for (const block of obj.message?.content ?? []) {
          if (block.type === "tool_result") {
            const content = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
            const call = calls.get(block.tool_use_id);
            errors.push({
              toolName: extractToolName(call?.name ?? "unknown"),
              args: call?.args ?? {},
              errorOutput: content.slice(0, 1000),
              sessionSource: filePath.split("/").pop() ?? "unknown",
            });
          }
        }
      }
    } catch { /* skip */ }
  }
  return errors;
}

// ——— Arg pattern analysis ———

function analyzeArgs(args: Record<string, unknown>): string[] {
  const patterns: string[] = [];
  for (const [key, val] of Object.entries(args)) {
    if (val === null) patterns.push(`null:${key}`);
    else if (val === undefined) patterns.push(`undefined:${key}`);
    else if (typeof val === "string" && val === "") patterns.push(`empty_string:${key}`);
    else if (typeof val === "string" && /^\[.*\]$/.test(val.trim())) patterns.push(`json_string:${key}`);
    else if (typeof val === "string" && /\[.*\]\(.*\)/.test(val)) patterns.push(`markdown_path:${key}`);
    else if (typeof val === "object" && !Array.isArray(val) && val !== null && Object.keys(val).length === 0) patterns.push(`empty_object:${key}`);
    else if (typeof val === "string" && /^"\w/.test(val)) patterns.push(`double_quoted:${key}`);
  }
  return patterns;
}

// ——— Main ———

async function main() {
  const allErrors: ToolError[] = [];
  const model = process.env.TOOL_REPAIR_MODEL || "deepseek-v4-flash";

  // 1. Claude session
  const claudeDir = join(homedir(), ".claude", "projects");
  try {
    const projectDirs = await readdir(claudeDir);
    for (const project of projectDirs) {
      const projectPath = join(claudeDir, project);
      try {
        const files = (await readdir(projectPath)).filter(f => f.endsWith(".jsonl"));
        for (const file of files.slice(0, 3)) {
          const errors = await parseClaudeSession(join(projectPath, file));
          allErrors.push(...errors);
          console.error(`  ${project}/${file}: ${errors.length} tool errors`);
        }
      } catch { /* skip */ }
    }
  } catch { /* no claude sessions */ }

  // 2. ALiX sessions in Monolith
  const sessionsDir = "/home/babasola/Projects/Monolith/.alix/sessions";
  try {
    const sessionDirs = await readdir(sessionsDir);
    let count = 0;
    for (const dir of sessionDirs) {
      if (count >= 100) break; // cap at 100 sessions
      const eventFile = join(sessionsDir, dir, "events.jsonl");
      try {
        const rl = createInterface({ input: createReadStream(eventFile), crlfDelay: Infinity });
        for await (const line of rl) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === "tool.failed" || obj.type?.includes("FAILED")) {
              const payload = obj.payload ?? {};
              allErrors.push({
                toolName: extractToolName(payload.toolName as string ?? payload.tool_name as string ?? "unknown"),
                args: payload.args as Record<string, unknown> ?? {},
                errorOutput: (payload.error as string ?? payload.message as string ?? "").slice(0, 1000),
                sessionSource: `alix:${dir}`,
              });
            }
          } catch { /* skip */ }
        }
        count++;
      } catch { /* skip */ }
    }
  } catch { /* no sessions */ }

  console.error(`\nTotal errors collected: ${allErrors.length}\n`);

  // ——— Analysis ———

  // A) Category breakdown
  const catCounts = new Map<string, { count: number; fixable: number; examples: string[] }>();
  for (const err of allErrors) {
    const cls = classifyError(err.toolName, err.errorOutput, err.args);
    if (!catCounts.has(cls.category)) {
      catCounts.set(cls.category, { count: 0, fixable: 0, examples: [] });
    }
    const entry = catCounts.get(cls.category)!;
    entry.count++;
    if (cls.fixable) entry.fixable++;
    if (entry.examples.length < 3) {
      entry.examples.push(`[${err.toolName}] ${err.errorOutput.slice(0, 150)}`);
    }
  }

  console.log("=== Category Breakdown ===");
  const sorted = [...catCounts.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [cat, data] of sorted) {
    const label = ERROR_CATEGORIES.find(c => c.id === cat)?.label ?? cat;
    const fixablePct = ((data.fixable / data.count) * 100).toFixed(0);
    console.log(`\n  ${label} (${data.count}) — ${data.fixable} fixable (${fixablePct}%)`);
    for (const ex of data.examples) {
      console.log(`    > ${ex}`);
    }
  }

  // B) Arg pattern analysis — what are the models doing wrong?
  console.log(`\n\n=== Arg Pattern Analysis (across all errors) ===`);
  const argPatterns = new Map<string, number>();
  const toolArgPatterns = new Map<string, Map<string, number>>();

  for (const err of allErrors) {
    const patterns = analyzeArgs(err.args);
    for (const p of patterns) {
      argPatterns.set(p, (argPatterns.get(p) ?? 0) + 1);
      if (!toolArgPatterns.has(err.toolName)) toolArgPatterns.set(err.toolName, new Map());
      const toolPats = toolArgPatterns.get(err.toolName)!;
      toolPats.set(p, (toolPats.get(p) ?? 0) + 1);
    }
  }

  console.log("\nTop arg patterns (all tools):");
  for (const [pat, count] of [...argPatterns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  [${count}x] ${pat}`);
  }

  console.log("\nTop arg patterns by tool:");
  for (const [tool, pats] of [...toolArgPatterns.entries()].sort((a, b) => {
    const sumA = [...pats.values()].reduce((s, c) => s + c, 0);
    const sumB = [...toolArgPatterns.get(b[0])!.values()].reduce((s, c) => s + c, 0);
    return sumB - sumA;
  }).slice(0, 10)) {
    const total = [...pats.values()].reduce((s, c) => s + c, 0);
    console.log(`\n  ${tool} (${total} pattern hits):`);
    for (const [pat, count] of [...pats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`    [${count}x] ${pat}`);
    }
  }

  // C) Top error messages — what do models see?
  console.log(`\n\n=== Top Error Message Snippets ===`);
  const msgCounts = new Map<string, number>();
  for (const err of allErrors) {
    const snippet = err.errorOutput.replace(/\n/g, " ").slice(0, 120);
    const key = snippet.slice(0, 80);
    msgCounts.set(key, (msgCounts.get(key) ?? 0) + 1);
  }
  for (const [msg, count] of [...msgCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    const firstExample = allErrors.find(e => e.errorOutput.slice(0, 80) === msg);
    const tool = firstExample?.toolName ?? "?";
    console.log(`  [${count}x] (${tool}) ${msg}`);
  }

  // D) Sample actual null-field args for Bash errors
  console.log(`\n\n=== Sample Bash errors with null fields ===`);
  const bashNull = allErrors.filter(e => e.toolName === "Bash" && Object.values(e.args).some(v => v === null));
  for (const err of bashNull.slice(0, 10)) {
    console.log(`  Args: ${JSON.stringify(err.args)}`);
    console.log(`  Error: ${err.errorOutput.slice(0, 200)}`);
    console.log();
  }

  // E) Sample Read errors
  console.log(`\n=== Sample Read errors ===`);
  const readErrors = allErrors.filter(e => e.toolName === "Read" || e.toolName === "file.read");
  for (const err of readErrors.slice(0, 10)) {
    console.log(`  Args: ${JSON.stringify(err.args)}`);
    console.log(`  Error: ${err.errorOutput.slice(0, 200)}`);
    console.log();
  }

  // F) Sample Edit errors
  console.log(`\n=== Sample Edit errors ===`);
  const editErrors = allErrors.filter(e => e.toolName === "Edit" || e.toolName === "patch.apply");
  for (const err of editErrors.slice(0, 10)) {
    console.log(`  Args: ${JSON.stringify(err.args)}`);
    console.log(`  Error: ${err.errorOutput.slice(0, 200)}`);
    console.log();
  }

  console.log(`\n\n=== SUMMARY ===`);
  const totalFixable = [...catCounts.values()].reduce((s, c) => s + c.fixable, 0);
  const total = allErrors.length;
  console.log(`  Total errors: ${total}`);
  console.log(`  Potentially fixable: ${totalFixable} (${(totalFixable/total*100).toFixed(0)}%)`);
  console.log(`  Estimated wasted retries: ${totalFixable * 5} (avg 5 retries per fixable error per Ahmad's data)`);
}

main().catch(console.error);
