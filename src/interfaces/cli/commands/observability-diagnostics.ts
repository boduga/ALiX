/**
 * observability-diagnostics.ts — CLI command for querying durable diagnostics.
 *
 * Usage:
 *   alix observability diagnostics list                           — all diagnostics
 *   alix observability diagnostics list --type runtime            — runtime only
 *   alix observability diagnostics list --type contract           — contract only
 *   alix observability diagnostics list --boundary timeout        — filter by boundary
 *   alix observability diagnostics list --severity error          — errors only
 *   alix observability diagnostics list --context.runId run-abc   — filter by run
 *   alix observability diagnostics list --context.agentId coder   — filter by agent
 *   alix observability diagnostics list --context.sessionId s-1   — filter by session
 *   alix observability diagnostics list --limit 10                — show 10
 *   alix observability diagnostics list --json                    — JSON output
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExecutionContextFilter {
  runId?: string;
  sessionId?: string;
  agentId?: string;
}

interface DiagnosticEvent {
  id: string;
  timestamp: string;
  type: string;
  domain: string;
  boundary: string;
  operation?: string;
  entityId?: string;
  event: string;
  severity: string;
  error?: string;
  context?: ExecutionContextFilter;
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export async function cmdDiagnostics(cwd: string, args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "list" || !sub) {
    await cmdList(cwd, args.slice(1));
    return;
  }
  throw new Error("Usage: alix observability diagnostics {list}");
}

async function cmdList(cwd: string, args: string[]): Promise<void> {
  const filePath = join(cwd, ".alix", "diagnostics", "events.jsonl");

  if (!existsSync(filePath)) {
    console.log("No diagnostic events found.");
    return;
  }

  // Parse filters
  const typeFilter = parseArg(args, "--type");
  const boundaryFilter = parseArg(args, "--boundary");
  const severityFilter = parseArg(args, "--severity");
  const contextRunId = parseArg(args, "--context.runId");
  const contextAgentId = parseArg(args, "--context.agentId");
  const contextSessionId = parseArg(args, "--context.sessionId");
  const limit = parseInt(parseArg(args, "--limit") ?? "50", 10);
  const jsonMode = args.includes("--json");

  // Read and parse events
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter(Boolean);

  const events: DiagnosticEvent[] = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as DiagnosticEvent;
      if (typeFilter && event.type !== typeFilter) continue;
      if (boundaryFilter && event.boundary !== boundaryFilter) continue;
      if (severityFilter && event.severity !== severityFilter) continue;
      if (contextRunId && event.context?.runId !== contextRunId) continue;
      if (contextAgentId && event.context?.agentId !== contextAgentId) continue;
      if (contextSessionId && event.context?.sessionId !== contextSessionId) continue;
      events.push(event);
    } catch {
      // Skip malformed lines
    }
  }

  // Sort by timestamp descending (newest first)
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Limit
  const displayed = events.slice(0, limit);

  if (jsonMode) {
    console.log(JSON.stringify(displayed, null, 2));
    return;
  }

  if (displayed.length === 0) {
    console.log("No matching diagnostic events found.");
    return;
  }

  // Human-readable output
  console.log(`Diagnostic events (${displayed.length} of ${events.length} matching):\n`);

  for (const event of displayed) {
    const sev = event.severity === "error" ? "❌" : "⚠️";
    const time = event.timestamp.slice(0, 19).replace("T", " ");
    console.log(`${sev} [${event.type}] ${event.boundary}`);
    console.log(`   Time:  ${time}`);
    if (event.operation) console.log(`   Op:    ${event.operation}`);
    if (event.entityId) console.log(`   ID:    ${event.entityId}`);
    if (event.context?.runId) console.log(`   Run:   ${event.context.runId}`);
    if (event.context?.agentId) console.log(`   Agent: ${event.context.agentId}`);
    if (event.context?.sessionId) console.log(`   Session: ${event.context.sessionId}`);
    console.log(`   Event: ${event.event.length > 100 ? event.event.slice(0, 100) + "..." : event.event}`);
    console.log();
  }

  // Summary
  const errors = events.filter((e) => e.severity === "error").length;
  const warnings = events.filter((e) => e.severity === "warning").length;
  console.log(`Total: ${events.length} (${errors} errors, ${warnings} warnings)`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArg(args: string[], key: string): string | undefined {
  const idx = args.indexOf(key);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}
