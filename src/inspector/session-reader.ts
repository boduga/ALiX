import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AlixEvent, InspectorComparison, InspectorSnapshot } from "../events/types.js";
import { buildInspectorSnapshot, compareInspectorSnapshots } from "./projection.js";

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class InvalidSessionIdError extends Error {
  constructor(readonly sessionId: string) {
    super("Invalid session id");
    this.name = "InvalidSessionIdError";
  }
}

export function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId) && !sessionId.includes("..");
}

export function assertValidSessionId(sessionId: string): string {
  if (!isValidSessionId(sessionId)) throw new InvalidSessionIdError(sessionId);
  return sessionId;
}

export function sessionEventsPath(root: string, sessionId: string): string {
  return join(root, ".alix", "sessions", assertValidSessionId(sessionId), "events.jsonl");
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
