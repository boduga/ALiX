import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AlixEvent, InspectorComparison, InspectorSnapshot } from "../events/types.js";
import { buildInspectorSnapshot, compareInspectorSnapshots } from "./projection.js";

function sessionEventsPath(root: string, sessionId: string): string {
  return join(root, ".alix", "sessions", sessionId, "events.jsonl");
}

export async function readSessionEvents(root: string, sessionId: string): Promise<AlixEvent[]> {
  try {
    const text = await readFile(sessionEventsPath(root, sessionId), "utf8");
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AlixEvent);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function readSessionSnapshot(root: string, sessionId: string): Promise<InspectorSnapshot> {
  return buildInspectorSnapshot(sessionId, await readSessionEvents(root, sessionId));
}

export async function readSessionComparison(root: string, leftSessionId: string, rightSessionId: string): Promise<InspectorComparison> {
  const [left, right] = await Promise.all([
    readSessionSnapshot(root, leftSessionId),
    readSessionSnapshot(root, rightSessionId)
  ]);
  return compareInspectorSnapshots(left, right);
}
