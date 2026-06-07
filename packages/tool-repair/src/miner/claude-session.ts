/**
 * Claude Code session reader.
 * Reads ~/.claude/projects/<project>/<sessionId>.jsonl files
 * and extracts tool-call failure records.
 */
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

export type ToolCallRecord = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  timestamp: string;
};

export type ToolErrorRecord = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  errorOutput: string;
  timestamp: string;
  sessionId: string;
};

export async function parseClaudeSession(filePath: string): Promise<{
  calls: ToolCallRecord[];
  errors: ToolErrorRecord[];
}> {
  const calls: ToolCallRecord[] = [];
  const errors: ToolErrorRecord[] = [];
  const sessionId = filePath.split("/").pop()?.replace(/\.jsonl$/, "") ?? "unknown";

  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    try {
      const obj = JSON.parse(line);

      if (obj.type === "assistant") {
        const blocks = obj.message?.content ?? [];
        for (const block of blocks) {
          if (block.type === "tool_use") {
            calls.push({
              toolCallId: block.id,
              name: block.name,
              args: (block.input as Record<string, unknown>) ?? {},
              timestamp: obj.timestamp ?? "",
            });
          }
        }
      } else if (obj.type === "user") {
        const blocks = obj.message?.content ?? [];
        for (const block of blocks) {
          if (block.type === "tool_result") {
            const content = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
            if (content.includes("Exit code") || content.toLowerCase().includes("error")) {
              const matchedCall = calls.find((c) => c.toolCallId === block.tool_use_id);
              errors.push({
                toolCallId: block.tool_use_id,
                name: matchedCall?.name ?? "unknown",
                args: matchedCall?.args ?? {},
                errorOutput: content.slice(0, 500),
                timestamp: obj.timestamp ?? "",
                sessionId,
              });
            }
          }
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return { calls, errors };
}

export async function findClaudeSessions(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}
