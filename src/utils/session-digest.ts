import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MemoryStore } from "./memory/store.js";
import { buildMemoryContext } from "./memory/recall.js";

export type ToolEvent = {
  toolName?: string;
  path?: string;
  status?: string;
  error?: string;
};

export type SessionEvent = {
  type: string;
  payload?: Record<string, unknown>;
};

/**
 * Build a digest of all file changes from the session events.jsonl.
 * Returns a [Session Digest] string or null if no events found.
 */
export async function buildSessionDigest(sessionDir: string): Promise<string | null> {
  const eventsPath = resolve(sessionDir, "events.jsonl");

  let content: string;
  try {
    content = await readFile(eventsPath, "utf8");
  } catch {
    return null;
  }

  if (!content.trim()) return null;

  const created = new Set<string>();
  const changed = new Set<string>();
  const deleted = new Set<string>();
  const errors: string[] = [];

  const lines = content.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as SessionEvent;

      if (event.type === "tool.completed" || event.type === "tool.failed") {
        const p = event.payload as Record<string, unknown> | undefined;
        if (!p) continue;

        const toolName = p.toolName as string | undefined;
        const path = p.path as string | undefined;

        if (toolName && path && typeof path === "string") {
          if (toolName === "file.create") created.add(path);
          else if (toolName === "file.delete") deleted.add(path);
          else if (toolName === "patch.apply") changed.add(path);
        }

        const changedFilesFromPayload = (event.payload as Record<string, unknown>).changedFiles as string[] | undefined;
        if (changedFilesFromPayload && Array.isArray(changedFilesFromPayload)) {
          for (const file of changedFilesFromPayload) {
            changed.add(file);
          }
        }

        if (event.type === "tool.failed" && p.error) {
          const err = p.error as string;
          const short = err.length > 80 ? err.slice(0, 80) + "..." : err;
          errors.push(`${toolName ?? "tool"}: ${short}`);
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  if (created.size === 0 && changed.size === 0 && deleted.size === 0 && errors.length === 0) {
    return null;
  }

  const parts: string[] = [];
  if (created.size) parts.push(`Files created: ${[...created].join(", ")}`);
  if (changed.size) parts.push(`Files changed: ${[...changed].join(", ")}`);
  if (deleted.size) parts.push(`Files deleted: ${[...deleted].join(", ")}`);
  if (errors.length) parts.push(`Errors: ${errors.join("; ")}`);

  return `[Session Digest] ${parts.join(". ")}`;
}

/**
 * Build a session digest that includes memory context.
 * Combines session events digest with memory index for comprehensive context.
 */
export async function buildSessionDigestWithMemory(
  sessionDir: string,
  memoryDir: string = ".alix/memory"
): Promise<string | null> {
  // Build existing session digest
  const digest = await buildSessionDigest(sessionDir);

  // Load memory context
  const store = new MemoryStore(memoryDir);
  const memoryContext = await buildMemoryContext(store);

  const parts: string[] = [];
  if (digest) parts.push(digest);
  if (memoryContext) parts.push(`\n# Context\n${memoryContext}`);

  return parts.join("\n") || null;
}