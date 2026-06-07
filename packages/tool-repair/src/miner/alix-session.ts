/**
 * ALiX session reader.
 * Reads .alix/sessions/<sessionId>/events.jsonl files.
 */
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

export type AlixEvent = {
  sessionId: string;
  actor: string;
  type: string;
  payload: Record<string, unknown>;
};

export type AlixToolFailure = {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  error: string;
};

export async function parseAlixSession(filePath: string): Promise<{
  events: AlixEvent[];
  failures: AlixToolFailure[];
}> {
  const events: AlixEvent[] = [];
  const failures: AlixToolFailure[] = [];
  const sessionId = filePath.split("/sessions/")[1]?.split("/")[0] ?? "unknown";

  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    try {
      const obj = JSON.parse(line);
      events.push({
        sessionId: obj.sessionId ?? sessionId,
        actor: obj.actor ?? "",
        type: obj.type ?? "",
        payload: obj.payload ?? {},
      });
    } catch {
      // Skip malformed lines
    }
  }

  return { events, failures };
}

export async function findAlixSessions(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const sessionsDir = join(rootDir, ".alix", "sessions");
  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const eventFile = join(sessionsDir, entry.name, "events.jsonl");
        files.push(eventFile);
      }
    }
  } catch {
    // No sessions directory
  }
  return files;
}
